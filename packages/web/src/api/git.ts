export interface CommitFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface RefInfo {
  type: 'head' | 'branch' | 'remote' | 'tag';
  name: string;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: RefInfo[];
  message: string;
  author: string;
  date: string;
  files: CommitFile[];
}

export interface GitLogResponse {
  commits: CommitInfo[];
  hasMore: boolean;
  error?: string;
}

interface GitDiffResponse {
  diff: string;
}

interface GitBranchesResponse {
  current: string;
  branches: string[];
}

function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = {};
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function fetchGitLog(
  projectId: string,
  token: string | null,
  opts: { page?: number; limit?: number; file?: string; all?: boolean; branch?: string; stats?: boolean } = {},
): Promise<GitLogResponse> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.file) params.set('file', opts.file);
  if (opts.all) params.set('all', 'true');
  if (opts.branch) params.set('branch', opts.branch);
  if (opts.stats) params.set('stats', 'true');

  const qs = params.toString();
  const url = `/api/projects/${projectId}/git-log${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Git log failed: ${res.status}`);
  return res.json();
}

export async function fetchGitCommitFiles(
  projectId: string,
  token: string | null,
  commit: string,
): Promise<CommitFile[]> {
  const url = `/api/projects/${projectId}/git-commit-files?commit=${encodeURIComponent(commit)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Git commit files failed: ${res.status}`);
  const data: { files: CommitFile[] } = await res.json();
  return data.files;
}

export async function fetchGitDiff(
  projectId: string,
  token: string | null,
  commit: string,
  file?: string,
): Promise<string> {
  const params = new URLSearchParams({ commit });
  if (file) params.set('file', file);

  const url = `/api/projects/${projectId}/git-diff?${params}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Git diff failed: ${res.status}`);
  const data: GitDiffResponse = await res.json();
  return data.diff;
}

export async function fetchGitBranches(
  projectId: string,
  token: string | null,
): Promise<GitBranchesResponse> {
  const url = `/api/projects/${projectId}/git-branches`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Git branches failed: ${res.status}`);
  return res.json();
}
