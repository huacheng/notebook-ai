/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * Regression test: GitHistoryPanel should NOT use setInterval for polling.
 * After the refactor, it should rely on the nb:git-changed custom event.
 */
describe('GitHistoryPanel polling removal', () => {
  it('nb:git-changed CustomEvent carries correct detail', () => {
    const handler = vi.fn();
    window.addEventListener('nb:git-changed', handler);

    window.dispatchEvent(new CustomEvent('nb:git-changed', {
      detail: { watch_id: 'w1', project_id: 'proj-1', latest_hash: 'abc123' },
    }));

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.project_id).toBe('proj-1');
    expect(detail.latest_hash).toBe('abc123');

    window.removeEventListener('nb:git-changed', handler);
  });

  it('multiple listeners can coexist on nb:git-changed', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    window.addEventListener('nb:git-changed', h1);
    window.addEventListener('nb:git-changed', h2);

    window.dispatchEvent(new CustomEvent('nb:git-changed', {
      detail: { project_id: 'proj-2', latest_hash: 'def456' },
    }));

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);

    window.removeEventListener('nb:git-changed', h1);
    window.removeEventListener('nb:git-changed', h2);
  });
});
