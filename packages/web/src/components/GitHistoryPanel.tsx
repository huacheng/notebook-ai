import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useStore } from '../store';
import { fetchGitLog, fetchGitDiff, fetchGitBranches, fetchGitCommitFiles } from '../api/git';
import type { GitLogResponse } from '../api/git';
import type { CommitInfo, CommitFile, RefInfo } from '../api/git';
import { computeLanes, LANE_COLORS } from '../utils/gitGraph';
import type { LaneNode, Connection } from '../utils/gitGraph';
import { cacheSet, cacheGet, TTL } from '../utils/localCache';
import { GIT_DEFAULT_ALL_BRANCHES } from '../utils/gitDefaults';
import { useWatcher } from '../hooks/useWatcher';

// ---------------------------------------------------------------------------
// localStorage cache for git history
// ---------------------------------------------------------------------------

interface GitCache {
  commits: CommitInfo[];
  hasMore: boolean;
  branches: string[];
  currentBranch: string;
  latestHash: string;
}

function gitCacheKey(projectId: string): string {
  return `nb-git-${projectId}`;
}

function loadGitCache(projectId: string): GitCache | null {
  return cacheGet<GitCache>(gitCacheKey(projectId), TTL.GIT_HISTORY);
}

function saveGitCache(projectId: string, cache: GitCache): void {
  cacheSet(gitCacheKey(projectId), cache);
}

/** Format ISO date to compact relative time */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

// ---------------------------------------------------------------------------
// GraphCell
// ---------------------------------------------------------------------------

const LANE_WIDTH = 20;
const ROW_HEIGHT = 32;
const NODE_R = 4;
const MERGE_R = 5;
const CY = ROW_HEIGHT / 2;

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function colorOf(idx: number): string {
  return LANE_COLORS[idx % LANE_COLORS.length];
}

function connectionPath(conn: Connection): string {
  if (conn.type === 'branch-out') {
    const x1 = laneX(conn.fromLane);
    const x2 = laneX(conn.toLane);
    if (x1 === x2) return `M ${x1} ${CY} L ${x1} ${ROW_HEIGHT}`;
    const d = (ROW_HEIGHT - CY) * 0.8;
    return `M ${x1} ${CY} C ${x1} ${CY + d}, ${x2} ${ROW_HEIGHT - d}, ${x2} ${ROW_HEIGHT}`;
  } else {
    const x1 = laneX(conn.fromLane);
    const x2 = laneX(conn.toLane);
    if (x1 === x2) return `M ${x1} 0 L ${x1} ${CY}`;
    const d = CY * 0.8;
    return `M ${x1} 0 C ${x1} ${d}, ${x2} ${CY - d}, ${x2} ${CY}`;
  }
}

const GraphCell = memo(function GraphCell({ laneNode, maxLanes }: { laneNode: LaneNode; maxLanes: number }) {
  const width = maxLanes * LANE_WIDTH;
  const newSet = laneNode.newLanes;

  return (
    <svg width={width} height={ROW_HEIGHT} style={{ flexShrink: 0, display: 'block' }}>
      {laneNode.activeLanes.map((al) => {
        if (newSet.includes(al.lane)) return null;
        return (
          <line
            key={`active-${al.lane}`}
            x1={laneX(al.lane)} y1={0}
            x2={laneX(al.lane)} y2={ROW_HEIGHT}
            stroke={colorOf(al.colorIndex)}
            strokeWidth={2} strokeLinecap="round"
          />
        );
      })}

      {laneNode.connections.map((conn, i) => (
        <path
          key={`conn-${i}`}
          d={connectionPath(conn)}
          stroke={colorOf(conn.colorIndex)}
          strokeWidth={2} fill="none" strokeLinecap="round"
        />
      ))}

      {laneNode.wasExpected &&
       !laneNode.activeLanes.some(al => al.lane === laneNode.lane) &&
       !newSet.includes(laneNode.lane) && (
        <line
          x1={laneX(laneNode.lane)} y1={0}
          x2={laneX(laneNode.lane)} y2={CY}
          stroke={colorOf(laneNode.colorIndex)}
          strokeWidth={2} strokeLinecap="round"
        />
      )}

      {laneNode.isMerge ? (
        <circle
          cx={laneX(laneNode.lane)} cy={CY} r={MERGE_R}
          fill="var(--bg-page)"
          stroke={colorOf(laneNode.colorIndex)} strokeWidth={2}
        />
      ) : (
        <circle
          cx={laneX(laneNode.lane)} cy={CY} r={NODE_R}
          fill={colorOf(laneNode.colorIndex)}
        />
      )}
    </svg>
  );
});

// ---------------------------------------------------------------------------
// ContinuationLines — draws active lane lines in the expanded file area
// ---------------------------------------------------------------------------

export const ContinuationLines = memo(function ContinuationLines({
  laneNode,
  maxLanes,
}: {
  laneNode: LaneNode | undefined;
  maxLanes: number;
}) {
  if (!laneNode || maxLanes <= 0) return null;
  return (
    <svg
      width={maxLanes * LANE_WIDTH}
      className="git-graph-continuation"
    >
      {laneNode.activeLanes.map((al) => (
        <line
          key={al.lane}
          x1={laneX(al.lane)} y1={0}
          x2={laneX(al.lane)} y2="100%"
          stroke={colorOf(al.colorIndex)}
          strokeWidth={2} strokeLinecap="round"
        />
      ))}
    </svg>
  );
});

// ---------------------------------------------------------------------------
// RefBadges
// ---------------------------------------------------------------------------

function RefBadges({ refs }: { refs: RefInfo[] }) {
  if (refs.length === 0) return null;
  return (
    <>
      {refs.map((ref, i) => (
        <span key={i} className={`git-ref-badge git-ref-badge--${ref.type}`}>
          {ref.type === 'head' && ref.name !== 'HEAD' ? `HEAD \u2192 ${ref.name}` : ref.name}
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// DiffView
// ---------------------------------------------------------------------------

interface DiffLine {
  type: string;
  text: string;
  oldNum: number | null;
  newNum: number | null;
}

function parseHunkHeader(header: string): [number, number] {
  const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [1, 1];
}

const DiffView = memo(function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <div className="git-diff-empty">No diff available</div>;
  }

  const hunks: { header: string; lines: DiffLine[] }[] = [];
  let currentHunk: (typeof hunks)[0] | null = null;
  let oldLine = 1;
  let newLine = 1;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) {
      const [o, n] = parseHunkHeader(raw);
      oldLine = o;
      newLine = n;
      currentHunk = { header: raw, lines: [] };
      hunks.push(currentHunk);
    } else if (raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('---') || raw.startsWith('+++')) {
      // skip diff headers
    } else if (currentHunk) {
      if (raw.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', text: raw, oldNum: null, newNum: newLine++ });
      } else if (raw.startsWith('-')) {
        currentHunk.lines.push({ type: 'del', text: raw, oldNum: oldLine++, newNum: null });
      } else {
        currentHunk.lines.push({ type: 'context', text: raw, oldNum: oldLine++, newNum: newLine++ });
      }
    }
  }

  return (
    <div className="git-diff-view">
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          <div className="git-diff-hunk-header">{hunk.header}</div>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              className={`git-diff-line git-diff-line--${line.type}`}
            >
              <span className="git-diff-ln">{line.oldNum ?? ''}</span>
              <span className="git-diff-ln git-diff-ln--new">{line.newNum ?? ''}</span>
              <span className={`git-diff-text git-diff-text--${line.type}`}>{line.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// CommitItem
// ---------------------------------------------------------------------------

const CommitItem = memo(function CommitItem({
  commit, projectId, token, laneNode, maxLanes,
}: {
  commit: CommitInfo;
  projectId: string;
  token: string | null;
  laneNode: LaneNode | undefined;
  maxLanes: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<CommitFile[]>(commit.files);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string>('');
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [copied, setCopied] = useState(false);
  const diffFileRef = useRef(diffFile);
  diffFileRef.current = diffFile;
  const filesLoadedRef = useRef(commit.files.length > 0);

  // On-demand: load file list when first expanded (if not already loaded from stats)
  const handleToggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && !filesLoadedRef.current) {
        filesLoadedRef.current = true;
        setLoadingFiles(true);
        fetchGitCommitFiles(projectId, token, commit.hash)
          .then((f) => setFiles(f))
          .catch(() => setFiles([]))
          .finally(() => setLoadingFiles(false));
      }
      return next;
    });
  }, [projectId, token, commit.hash]);

  const handleFileClick = useCallback(async (filePath: string) => {
    if (diffFileRef.current === filePath) {
      setDiffFile(null);
      return;
    }
    setDiffFile(filePath);
    setLoadingDiff(true);
    try {
      const d = await fetchGitDiff(projectId, token, commit.hash, filePath);
      setDiffContent(d);
    } catch {
      setDiffContent('Failed to load diff');
    } finally {
      setLoadingDiff(false);
    }
  }, [projectId, token, commit.hash]);

  return (
    <div>
      <div
        onClick={handleToggle}
        className="git-commit-row"
      >
        {laneNode && maxLanes > 0 && (
          <GraphCell laneNode={laneNode} maxLanes={maxLanes} />
        )}

        <div className="git-commit-info">
          <RefBadges refs={commit.refs} />
          <span className="git-commit-message">{commit.message}</span>
          <span className="git-commit-meta">
            {commit.author.split(' ')[0]} · {relativeTime(commit.date)}
          </span>
          <span
            title="Click to copy full hash"
            className={`git-commit-hash${copied ? ' git-commit-hash--copied' : ''}`}
            onClick={e => {
              e.stopPropagation();
              navigator.clipboard.writeText(commit.hash).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? 'Copied' : commit.shortHash}
          </span>
          <span className="git-commit-arrow">{expanded ? '\u25BC' : '\u25B6'}</span>
        </div>
      </div>

      {expanded && (
        <div className="git-commit-expanded">
          <ContinuationLines laneNode={laneNode} maxLanes={maxLanes} />
          <div className="git-commit-files">
            {loadingFiles ? (
              <div className="git-diff-loading">Loading files...</div>
            ) : files.length === 0 ? (
              <div className="git-commit-files-empty">No files changed</div>
            ) : (
              files.map((f) => (
                <div key={f.path}>
                  <div
                    onClick={() => handleFileClick(f.path)}
                    className="git-file-row"
                  >
                    <span className="git-file-additions">+{f.additions}</span>
                    <span className="git-file-deletions">-{f.deletions}</span>
                    <span className={`git-file-path${diffFile === f.path ? ' git-file-path--active' : ''}`}>
                      {f.path}
                    </span>
                  </div>
                  {diffFile === f.path && (
                    <div className="git-file-diff-container">
                      {loadingDiff ? (
                        <div className="git-diff-loading">Loading...</div>
                      ) : (
                        <DiffView diff={diffContent} />
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// GitHistoryPanel — main component
// ---------------------------------------------------------------------------

export function GitHistoryPanel({ projectId }: { projectId: string }) {
  const authToken = useStore((s) => s.authToken);

  // Hydrate from localStorage cache
  const cached = useMemo(() => loadGitCache(projectId), [projectId]);

  const [commits, setCommits] = useState<CommitInfo[]>(cached?.commits ?? []);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [allBranches, setAllBranches] = useState(GIT_DEFAULT_ALL_BRANCHES);
  const [branches, setBranches] = useState<string[]>(cached?.branches ?? []);
  const [currentBranch, setCurrentBranch] = useState(cached?.currentBranch ?? '');
  const [selectedBranch, setSelectedBranch] = useState('');
  const debounceRef = useRef<number>(0);
  // scrollRef removed — IntersectionObserver replaces scroll handler

  useEffect(() => {
    fetchGitBranches(projectId, authToken)
      .then(({ current, branches: list }) => {
        setCurrentBranch(current);
        setBranches(list);
      })
      .catch(() => {});
  }, [projectId, authToken]);

  // Persist to cache whenever commits or branches change
  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  const persistCache = useCallback((newCommits: CommitInfo[], newHasMore: boolean) => {
    saveGitCache(projectId, {
      commits: newCommits.slice(0, 5), // only cache first page
      hasMore: newHasMore,
      branches,
      currentBranch,
      latestHash: newCommits[0]?.hash ?? '',
    });
  }, [projectId, branches, currentBranch]);

  const loadPage = useCallback(async (p: number, file: string, append: boolean, all: boolean, branch: string) => {
    // If we already have cached commits, don't show loading indicator (silent refresh)
    if (commitsRef.current.length === 0) setLoading(true);
    setError(null);
    try {
      let resp: GitLogResponse;

      // Try WS for simple queries (no file/branch filter) — avoids HTTP overhead
      const ws = useStore.getState().ws;
      if (!file && !branch && ws && ws.readyState === WebSocket.OPEN) {
        try {
          resp = await new Promise<GitLogResponse>((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const timeout = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 10_000);
            function onResponse(e: Event) {
              const d = (e as CustomEvent).detail;
              if (d.request_id === requestId) {
                cleanup();
                const hasMore = d.commits.length > 0;
                resolve({ commits: d.commits, hasMore, error: undefined });
              }
            }
            function onError(e: Event) {
              const d = (e as CustomEvent).detail;
              if (d.request_id === requestId) {
                cleanup();
                resolve({ commits: [], hasMore: false, error: d.error });
              }
            }
            function cleanup() {
              clearTimeout(timeout);
              window.removeEventListener('nb:git-log-response', onResponse);
              window.removeEventListener('nb:git-log-error', onError);
            }
            window.addEventListener('nb:git-log-response', onResponse);
            window.addEventListener('nb:git-log-error', onError);
            ws.send(JSON.stringify({
              type: 'git_log_request',
              request_id: requestId,
              project_id: projectId,
              page: p,
              limit: 5,
              all: all || undefined,
              stats: undefined,
            }));
          });
        } catch {
          // WS failed — fallback to REST
          resp = await fetchGitLog(projectId, authToken, {
            page: p,
            all: all || undefined,
          });
        }
      } else {
        resp = await fetchGitLog(projectId, authToken, {
          page: p,
          file: file || undefined,
          all: all || undefined,
          branch: branch || undefined,
        });
      }

      if (resp.error) setError(resp.error);
      const newCommits = append ? [...commitsRef.current, ...resp.commits] : resp.commits;
      setCommits(newCommits);
      setHasMore(resp.hasMore);
      setPage(p);
      // Cache first-page default-branch results (no filter)
      if (p === 1 && !file && !all && !branch) {
        persistCache(resp.commits, resp.hasMore);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [projectId, authToken, persistCache]);

  useEffect(() => {
    loadPage(1, search, false, allBranches, selectedBranch);
  }, [search, allBranches, selectedBranch, loadPage]);

  // WebSocket-based change detection (replaces 3s HTTP polling)
  useWatcher('git', { projectId });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.project_id !== projectId) return;

      // If server pushed commits and no filters are active, use directly
      if (detail.commits && !search && !allBranches && !selectedBranch) {
        const pushed = detail.commits as CommitInfo[];
        setCommits(pushed);
        setHasMore(pushed.length >= (detail.limit ?? 5));
        setPage(1);
        persistCache(pushed, pushed.length >= (detail.limit ?? 5));
        return;
      }
      // Filters active or no commits in push — request fresh data
      loadPage(1, search, false, allBranches, selectedBranch);
    };
    window.addEventListener('nb:git-changed', handler);
    return () => window.removeEventListener('nb:git-changed', handler);
  }, [projectId, search, allBranches, selectedBranch, loadPage, persistCache]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setSearch(val), 300);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!loading && hasMore) loadPage(page + 1, search, true, allBranches, selectedBranch);
  }, [loading, hasMore, page, search, allBranches, selectedBranch, loadPage]);

  // IntersectionObserver: auto-load more commits when sentinel becomes visible
  const gitSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = gitSentinelRef.current;
    if (!el || loading || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) handleLoadMore(); },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, hasMore, handleLoadMore]);

  // Lane computation
  const laneMap = useMemo(() => computeLanes(commits), [commits]);
  const maxLanes = useMemo(() => {
    let max = 0;
    for (const node of laneMap.values()) {
      let nodeLanes = node.lane + 1;
      for (let i = 0; i < node.activeLanes.length; i++) {
        const v = node.activeLanes[i].lane + 1;
        if (v > nodeLanes) nodeLanes = v;
      }
      if (nodeLanes > max) max = nodeLanes;
    }
    return Math.min(max, 15);
  }, [laneMap]);

  return (
    <div className="git-history-panel">
      {/* Header */}
      <div className="git-history-header">
        <select
          value={allBranches ? '__all__' : selectedBranch}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__all__') {
              setAllBranches(true);
              setSelectedBranch('');
            } else {
              setAllBranches(false);
              setSelectedBranch(v);
            }
          }}
          className="git-branch-select"
          title="Select branch"
        >
          <option value="">{currentBranch || 'HEAD'}</option>
          {branches
            .filter((b) => b !== currentBranch)
            .map((b) => <option key={b} value={b}>{b}</option>)}
          <option value="__all__">-- All branches --</option>
        </select>
        <input
          type="text"
          value={searchInput}
          onChange={handleSearchChange}
          placeholder="Filter by file..."
          className="git-search-input"
        />
      </div>

      {/* Error */}
      {error && <div className="git-history-error">{error}</div>}

      {/* Commit list */}
      <div className="git-commit-list">
        {commits.map((c) => (
          <CommitItem
            key={c.hash}
            commit={c}
            projectId={projectId}
            token={authToken}
            laneNode={laneMap.get(c.hash)}
            maxLanes={maxLanes}
          />
        ))}

        {loading && (
          <div className="git-loading">Loading...</div>
        )}

        {!loading && commits.length === 0 && !error && (
          <div className="git-empty">No commits found</div>
        )}

        {!loading && hasMore && (
          <div ref={gitSentinelRef} className="git-load-more">Loading...</div>
        )}
      </div>
    </div>
  );
}
