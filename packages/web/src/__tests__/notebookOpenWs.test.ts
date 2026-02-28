/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * Task A4: wsSlice dispatches CustomEvents for notebook_opened / notebook_open_error
 */
describe('wsSlice notebook open events', () => {
  it('dispatches nb:notebook-opened on notebook_opened message', async () => {
    const handler = vi.fn();
    window.addEventListener('nb:notebook-opened', handler);

    const detail = {
      type: 'notebook_opened',
      request_id: 'req-1',
      notebook_id: 'nb-1',
      notebook: {},
      session_id: 'sess-1',
      workspace_dir: '/tmp',
    };
    window.dispatchEvent(new CustomEvent('nb:notebook-opened', { detail }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual(detail);
    window.removeEventListener('nb:notebook-opened', handler);
  });

  it('dispatches nb:notebook-open-error on notebook_open_error message', async () => {
    const handler = vi.fn();
    window.addEventListener('nb:notebook-open-error', handler);

    const detail = {
      type: 'notebook_open_error',
      request_id: 'req-1',
      error: 'Not found',
    };
    window.dispatchEvent(new CustomEvent('nb:notebook-open-error', { detail }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.error).toBe('Not found');
    window.removeEventListener('nb:notebook-open-error', handler);
  });
});
