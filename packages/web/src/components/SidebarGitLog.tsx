import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchGitLog, fetchGitDiff, fetchLibraryGitLog, fetchLibraryGitDiff } from '../api/git';
import type { CommitInfo } from '../api/git';
import { useT } from '../i18n';

interface SidebarGitLogProps {
  /** 'project' uses project git API, 'library' uses library git API */
  source: 'project' | 'library';
  projectId?: string;
}

/** Compact relative time */
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export function SidebarGitLog({ source, projectId }: SidebarGitLogProps) {
  const t = useT();

  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const loadCommits = useCallback(async (pageNum: number, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = source === 'library'
        ? await fetchLibraryGitLog({ page: pageNum, limit: 30 })
        : projectId
          ? await fetchGitLog(projectId, { page: pageNum, limit: 30 })
          : null;

      if (res) {
        setCommits(prev => append ? [...prev, ...res.commits] : res.commits);
        setHasMore(res.hasMore);
        setPage(pageNum);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load git log');
    } finally {
      setLoading(false);
    }
  }, [source, projectId]);

  useEffect(() => {
    loadCommits(1);
  }, [loadCommits]);

  const handleCommitClick = useCallback(async (hash: string) => {
    if (selectedHash === hash) {
      setSelectedHash(null);
      setDiff(null);
      return;
    }

    setSelectedHash(hash);
    setDiffLoading(true);
    try {
      const d = source === 'library'
        ? await fetchLibraryGitDiff(hash)
        : projectId
          ? await fetchGitDiff(projectId, hash)
          : '';
      setDiff(d);
    } catch {
      setDiff('// Failed to load diff');
    } finally {
      setDiffLoading(false);
    }
  }, [source, projectId, selectedHash]);

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      loadCommits(page + 1, true);
    }
  };

  if (error && commits.length === 0) {
    return (
      <div className="sidebar-git-log sidebar-git-log--empty">
        <span className="sidebar-git-empty-msg">{error}</span>
      </div>
    );
  }

  if (!loading && commits.length === 0) {
    return (
      <div className="sidebar-git-log sidebar-git-log--empty">
        <span className="sidebar-git-empty-msg">{t('git.noCommits')}</span>
      </div>
    );
  }

  return (
    <div className="sidebar-git-log" ref={scrollRef}>
      {commits.map((c) => (
        <div key={c.hash} className="sidebar-git-commit-wrap">
          <div
            className={`sidebar-git-commit${selectedHash === c.hash ? ' sidebar-git-commit--selected' : ''}`}
            onClick={() => handleCommitClick(c.hash)}
          >
            <div className="sidebar-git-commit-header">
              <span className="sidebar-git-hash">{c.shortHash}</span>
              <span className="sidebar-git-time">{relTime(c.date)}</span>
            </div>
            <div className="sidebar-git-message">{c.message}</div>
            <div className="sidebar-git-author">{c.author}</div>
          </div>
          {selectedHash === c.hash && (
            <div className="sidebar-git-diff">
              {diffLoading ? (
                <div className="sidebar-git-diff-loading">Loading...</div>
              ) : (
                <pre className="sidebar-git-diff-content">{diff || '// No diff'}</pre>
              )}
            </div>
          )}
        </div>
      ))}
      {loading && <div className="sidebar-git-loading">Loading...</div>}
      {hasMore && !loading && (
        <button className="sidebar-git-load-more" onClick={handleLoadMore}>
          {t('git.loadMore')}
        </button>
      )}
    </div>
  );
}
