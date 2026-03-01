/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { cacheGet, TTL } from '../utils/localCache';

describe('WS files push → localStorage cache', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleFiles = {
    dirPath: '/workspace/project',
    files: [
      { name: 'readme.md', type: 'file' as const, size: 100, modifiedAt: '2026-01-01T00:00:00.000Z' },
      { name: 'src', type: 'directory' as const, size: 0, modifiedAt: '2026-01-01T00:00:00.000Z' },
    ],
    truncated: false,
  };

  it('writes to localStorage with correct cache key', async () => {
    const { handleFilesPush } = await import('../utils/wsFilesPush');
    handleFilesPush({
      cache_key: 'nb-filelist-/api/projects/abc-.',
      files: sampleFiles,
    });

    const cached = cacheGet(
      'nb-filelist-/api/projects/abc-.',
      TTL.FILE_LIST,
    );
    expect(cached).toEqual(sampleFiles);
  });

  it('does NOT write when no cache_key', async () => {
    const { handleFilesPush } = await import('../utils/wsFilesPush');
    handleFilesPush({ files: sampleFiles });

    expect(localStorage.length).toBe(0);
  });

  it('does NOT write when no files', async () => {
    const { handleFilesPush } = await import('../utils/wsFilesPush');
    handleFilesPush({ cache_key: 'nb-filelist-/api/projects/abc-.' });

    expect(localStorage.length).toBe(0);
  });

  it('overrides stale cache with fresh push', async () => {
    const { handleFilesPush } = await import('../utils/wsFilesPush');

    handleFilesPush({
      cache_key: 'nb-filelist-/api/projects/abc-.',
      files: { dirPath: '/old', files: [], truncated: false },
    });

    handleFilesPush({
      cache_key: 'nb-filelist-/api/projects/abc-.',
      files: sampleFiles,
    });

    const cached = cacheGet(
      'nb-filelist-/api/projects/abc-.',
      TTL.FILE_LIST,
    );
    expect(cached).toEqual(sampleFiles);
  });

  it('cache <2s is WS-fresh', async () => {
    const { handleFilesPush, isWsFresh } = await import('../utils/wsFilesPush');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    handleFilesPush({
      cache_key: 'nb-filelist-/api/projects/abc-.',
      files: sampleFiles,
    });

    vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
    expect(isWsFresh('nb-filelist-/api/projects/abc-.')).toBe(true);
  });

  it('cache >2s is NOT WS-fresh', async () => {
    const { handleFilesPush, isWsFresh } = await import('../utils/wsFilesPush');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    handleFilesPush({
      cache_key: 'nb-filelist-/api/projects/abc-.',
      files: sampleFiles,
    });

    vi.spyOn(Date, 'now').mockReturnValue(now + 3000);
    expect(isWsFresh('nb-filelist-/api/projects/abc-.')).toBe(false);
  });
});
