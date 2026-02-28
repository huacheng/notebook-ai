/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * Task B3: wsSlice dispatches nb:git-log-response CustomEvent
 */
describe('wsSlice git log events', () => {
  it('dispatches nb:git-log-response with correct detail', () => {
    const handler = vi.fn();
    window.addEventListener('nb:git-log-response', handler);

    const detail = {
      type: 'git_log_response',
      request_id: 'req-1',
      commits: [{ hash: 'abc', message: 'test' }],
      total: 1,
      page: 1,
      limit: 5,
    };
    window.dispatchEvent(new CustomEvent('nb:git-log-response', { detail }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.commits).toHaveLength(1);
    window.removeEventListener('nb:git-log-response', handler);
  });
});
