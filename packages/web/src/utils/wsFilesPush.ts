/**
 * Handle WS-pushed file list data → localStorage cache.
 * Called from wsSlice when a files_changed message includes cache_key + files.
 */

import { cacheSet } from './localCache';

const WS_FRESH_THRESHOLD = 2000; // 2 seconds

interface FilesPushPayload {
  cache_key?: string;
  files?: {
    dirPath: string;
    files: Array<{ name: string; type: string; size: number; modifiedAt: string; [k: string]: unknown }>;
    truncated: boolean;
  };
}

/**
 * Write WS-pushed file listing to localStorage cache.
 * No-op if cache_key or files are missing.
 */
export function handleFilesPush(payload: FilesPushPayload): void {
  if (!payload.cache_key || !payload.files) return;
  cacheSet(payload.cache_key, payload.files);
}

/**
 * Check if a cache entry is "WS-fresh" — written by a WS push within the last 2s.
 * If fresh, the silent refresh in FileSection can skip the REST call.
 */
export function isWsFresh(cacheKey: string): boolean {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return false;
    const entry = JSON.parse(raw) as { ts?: number };
    if (typeof entry.ts !== 'number') return false;
    return Date.now() - entry.ts < WS_FRESH_THRESHOLD;
  } catch {
    return false;
  }
}
