import { describe, it, expect } from 'vitest';

/**
 * Task B: Git-log WS schema tests
 */
describe('GitLog WS schemas', () => {
  it('GitLogRequestSchema accepts a valid request', async () => {
    const { GitLogRequestSchema } = await import('@notebook-ai/shared');
    const msg = {
      type: 'git_log_request',
      request_id: 'req-123',
      project_id: 'proj-1',
      page: 1,
      limit: 5,
    };
    const result = GitLogRequestSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('GitLogResponseSchema accepts a valid response', async () => {
    const { GitLogResponseSchema } = await import('@notebook-ai/shared');
    const msg = {
      type: 'git_log_response',
      request_id: 'req-123',
      commits: [{ hash: 'abc', shortHash: 'abc', message: 'test' }],
      total: 1,
      page: 1,
      limit: 5,
    };
    const result = GitLogResponseSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('GitCommitFilesRequestSchema accepts a valid request', async () => {
    const { GitCommitFilesRequestSchema } = await import('@notebook-ai/shared');
    const msg = {
      type: 'git_commit_files_request',
      request_id: 'req-456',
      project_id: 'proj-1',
      commit: 'abc1234',
    };
    const result = GitCommitFilesRequestSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('GitCommitFilesResponseSchema accepts a valid response', async () => {
    const { GitCommitFilesResponseSchema } = await import('@notebook-ai/shared');
    const msg = {
      type: 'git_commit_files_response',
      request_id: 'req-456',
      files: [{ path: 'README.md', additions: 10, deletions: 2 }],
    };
    const result = GitCommitFilesResponseSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('GitDiffRequestSchema accepts a valid request', async () => {
    const { GitDiffRequestSchema } = await import('@notebook-ai/shared');
    const msg = {
      type: 'git_diff_request',
      request_id: 'req-789',
      project_id: 'proj-1',
      commit: 'abc1234',
      file: 'src/index.ts',
    };
    const result = GitDiffRequestSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('GitDiffResponseSchema accepts a valid response', async () => {
    const { GitDiffResponseSchema } = await import('@notebook-ai/shared');
    const msg = {
      type: 'git_diff_response',
      request_id: 'req-789',
      diff: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new',
    };
    const result = GitDiffResponseSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });
});
