/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cacheSet, cacheGet, TTL } from '../utils/localCache';

/**
 * Tests that file viewer scroll positions are cached per file path
 * and restored when switching back to a previously viewed file.
 *
 * The actual hook integration is in FileViewerRender.tsx — these tests
 * validate the caching contract: key format and TTL.
 */

const SCROLL_KEY_PREFIX = 'fv-scroll-';

function scrollKey(filePath: string): string {
  return `${SCROLL_KEY_PREFIX}${filePath}`;
}

describe('FileViewer scroll position caching', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and restores scroll position for a file path', () => {
    const filePath = 'src/main.ts';
    cacheSet(scrollKey(filePath), 350);

    const restored = cacheGet<number>(scrollKey(filePath), TTL.SCROLL);
    expect(restored).toBe(350);
  });

  it('returns null for a file with no saved scroll', () => {
    const restored = cacheGet<number>(scrollKey('unknown.ts'), TTL.SCROLL);
    expect(restored).toBeNull();
  });

  it('maintains separate scroll positions per file', () => {
    cacheSet(scrollKey('a.ts'), 100);
    cacheSet(scrollKey('b.ts'), 200);
    cacheSet(scrollKey('c.ts'), 300);

    expect(cacheGet<number>(scrollKey('a.ts'), TTL.SCROLL)).toBe(100);
    expect(cacheGet<number>(scrollKey('b.ts'), TTL.SCROLL)).toBe(200);
    expect(cacheGet<number>(scrollKey('c.ts'), TTL.SCROLL)).toBe(300);
  });

  it('overwrites previous scroll position on re-save', () => {
    const filePath = 'src/app.tsx';
    cacheSet(scrollKey(filePath), 100);
    cacheSet(scrollKey(filePath), 500);

    expect(cacheGet<number>(scrollKey(filePath), TTL.SCROLL)).toBe(500);
  });
});
