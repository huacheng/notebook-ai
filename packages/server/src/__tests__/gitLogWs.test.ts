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
});
