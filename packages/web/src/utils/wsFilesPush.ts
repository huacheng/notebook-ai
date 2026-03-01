/**
 * Handle WS-pushed file list data → localStorage cache.
 * Called from wsSlice when a files_changed message includes cache_key + files.
 */

import { cacheSet, cacheGet, TTL } from './localCache';

const WS_FRESH_THRESHOLD = 2000; // 2 seconds

interface FileEntry { name: string; type: string; size: number; modifiedAt: string; [k: string]: unknown }

interface FilesPushPayload {
  cache_key?: string;
  files?: {
    dirPath: string;
    files: FileEntry[];
    truncated: boolean;
  };
}

/**
 * Write WS-pushed file listing to localStorage cache.
 * Returns relative paths of deleted entries (directories and files) compared to the old cache.
 */
export function handleFilesPush(payload: FilesPushPayload): string[] {
  if (!payload.cache_key || !payload.files) return [];

  // Read old cache before overwriting
  const oldData = cacheGet<{ files: FileEntry[] }>(payload.cache_key, TTL.FILE_LIST);
  const oldNames = new Set(oldData?.files?.map(f => f.name) ?? []);
  const newNames = new Set(payload.files.files.map(f => f.name));

  // Compute deleted entries
  const deleted: string[] = [];
  for (const name of oldNames) {
    if (!newNames.has(name)) deleted.push(name);
  }

  cacheSet(payload.cache_key, payload.files);
  return deleted;
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
