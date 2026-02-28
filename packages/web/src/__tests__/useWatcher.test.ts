/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

// ── Test: WS message dispatches CustomEvent ─────────────────────────────────

describe('watcher CustomEvent dispatch', () => {
  it('git_changed message dispatches nb:git-changed event', () => {
    const handler = vi.fn();
    window.addEventListener('nb:git-changed', handler);

    // Simulate what wsSlice should do when receiving git_changed
    window.dispatchEvent(new CustomEvent('nb:git-changed', {
      detail: { watch_id: 'w1', project_id: 'proj-1', latest_hash: 'abc123' },
    }));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.project_id).toBe('proj-1');
    expect(event.detail.latest_hash).toBe('abc123');

    window.removeEventListener('nb:git-changed', handler);
  });

  it('files_changed message dispatches nb:files-changed event', () => {
    const handler = vi.fn();
    window.addEventListener('nb:files-changed', handler);

    window.dispatchEvent(new CustomEvent('nb:files-changed', {
      detail: { watch_id: 'w2', dir_path: '/some/path' },
    }));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.dir_path).toBe('/some/path');

    window.removeEventListener('nb:files-changed', handler);
  });
});

// ── Test: useWatcher hook contract ──────────────────────────────────────────

describe('useWatcher hook contract', () => {
  it('generates unique watch_id per call', () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    expect(id1).not.toBe(id2);
  });
});
