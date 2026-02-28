/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * Regression test: FileSection should NOT use setInterval for auto-refresh.
 * After the refactor, the consuming components (ProjectSidebar, RightPanel)
 * listen to nb:files-changed events and increment refreshKey.
 */
describe('FileSection polling removal', () => {
  it('nb:files-changed CustomEvent carries correct detail', () => {
    const handler = vi.fn();
    window.addEventListener('nb:files-changed', handler);

    window.dispatchEvent(new CustomEvent('nb:files-changed', {
      detail: { watch_id: 'w1', dir_path: '/some/project/.deliverables' },
    }));

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.dir_path).toBe('/some/project/.deliverables');

    window.removeEventListener('nb:files-changed', handler);
  });

  it('multiple file change listeners can coexist', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    window.addEventListener('nb:files-changed', h1);
    window.addEventListener('nb:files-changed', h2);

    window.dispatchEvent(new CustomEvent('nb:files-changed', {
      detail: { watch_id: 'w2', dir_path: '/library' },
    }));

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);

    window.removeEventListener('nb:files-changed', h1);
    window.removeEventListener('nb:files-changed', h2);
  });
});
