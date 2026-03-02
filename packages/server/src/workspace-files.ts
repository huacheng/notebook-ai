/**
 * Utility helpers for workspace file operations (list / path-validate).
 * Used by the /api/notebooks/:sessionId/files routes.
 */

import { readdir, lstat, realpath } from 'fs/promises';
import { resolve, basename } from 'path';

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
  /** D6-4: Optional fields for project file listings */
  isNotebook?: boolean;
  worktreePath?: string;
}

export interface ListResult {
  dirPath: string;
  files: FileEntry[];
  truncated: boolean;
}

const MAX_ENTRIES = 1000;
const BATCH_SIZE = 50;

/**
 * List files/dirs in `baseDir/subPath`. Dirs come first, then alpha-sort.
 * Throws if subPath escapes baseDir.
 */
export async function listWorkspaceFiles(
  baseDir: string,
  subPath = '.',
): Promise<ListResult> {
  const target = resolve(baseDir, subPath);

  // Security: verify the resolved target is inside baseDir.
  const realBase = await realpath(baseDir);
  const realTarget = await realpath(target);
  if (realTarget !== realBase && !realTarget.startsWith(realBase + '/')) {
    throw new Error('Path outside workspace');
  }

  const entries = await readdir(target, { withFileTypes: true });
  const results: FileEntry[] = [];

  for (let i = 0; i < Math.min(entries.length, MAX_ENTRIES); i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (entry) => {
        const s = await lstat(resolve(target, entry.name));
        return {
          name: entry.name,
          type: (entry.isDirectory() ? 'directory' : 'file') as 'directory' | 'file',
          size: s.size,
          modifiedAt: s.mtime.toISOString(),
        };
      }),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
  }

  // Directories first, then alphabetical.
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    dirPath: realTarget,
    files: results,
    truncated: entries.length > MAX_ENTRIES,
  };
}

/**
 * Resolve `requested` against `baseDir` and verify it stays inside.
 * Returns the absolute path, throws on escape attempt.
 */
export async function validateWorkspacePath(
  requested: string,
  baseDir: string,
): Promise<string> {
  const realBase = await realpath(baseDir);
  const resolved = resolve(baseDir, requested);

  // The resolved path may not exist yet (upload destination), so we
  // validate the directory part only.
  const parent = resolve(resolved, '..');
  let realParent: string;
  try {
    realParent = await realpath(parent);
  } catch {
    realParent = parent; // parent doesn't exist — still check prefix
  }

  if (realParent !== realBase && !realParent.startsWith(realBase + '/')) {
    throw new Error('Path outside workspace');
  }
  return resolved;
}

export { basename };
