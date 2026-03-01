/**
 * Extracted helpers for project file listing + cache key computation.
 * Used by both REST routes and WS push.
 */

import path from 'path';
import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { listWorkspaceFiles, type ListResult } from './workspace-files.js';

export interface CacheKeyContext {
  dirPath?: string;
  projectId?: string;
}

/**
 * Compute the localStorage cache key that the frontend uses for a file listing.
 * Returns null if context is insufficient.
 */
export function computeFileCacheKey(ctx: CacheKeyContext): string | null {
  if (ctx.dirPath === '__library__') {
    return 'nb-filelist-/api/library-.';
  }
  if (ctx.projectId) {
    const sub = ctx.dirPath && ctx.dirPath !== '__library__' ? ctx.dirPath : '.';
    return `nb-filelist-/api/projects/${ctx.projectId}-${sub}`;
  }
  return null;
}

// Dotfile visibility — mirrors projects.ts constants
const DOTFILE_HIDDEN = new Set([
  '.tmp-annotations.json',
  '.auto-signal',
  '.auto-signal.tmp',
  '.auto-stop',
  '.lock',
  '.library-state.json',
  '.gitignore',
]);
const HIDDEN_TOPDIRS = new Set(['.worktrees', '.git', '.deliverables']);
const ALWAYS_HIDDEN_DIRS = new Set(['.deliverables', '.git']);

export function isVisibleEntry(name: string, isTopLevel: boolean): boolean {
  if (!name.startsWith('.')) return true;
  if (name.endsWith('.notebook.json')) return true;
  if (ALWAYS_HIDDEN_DIRS.has(name)) return false;
  if (isTopLevel && HIDDEN_TOPDIRS.has(name)) return false;
  if (DOTFILE_HIDDEN.has(name)) return false;
  if (name.startsWith('.lock.stale.')) return false;
  return true;
}

/**
 * Compute a project file listing with filtering, notebook marking, and worktree injection.
 * Extracted from the GET /:projectId/files route for reuse in WS push.
 */
export async function computeProjectFileList(
  projectPath: string,
  subPath: string,
): Promise<ListResult> {
  const result = await listWorkspaceFiles(projectPath, subPath);
  const isTopLevel = subPath === '.' || subPath === '';
  result.files = result.files.filter(f => isVisibleEntry(f.name, isTopLevel));

  // Mark directories containing {name}.notebook.json as notebook dirs
  const dirTarget = path.resolve(projectPath, subPath);
  for (const f of result.files) {
    if (f.type === 'directory') {
      const nbFile = path.join(dirTarget, f.name, `${f.name}.notebook.json`);
      if (existsSync(nbFile)) {
        (f as any).isNotebook = true;
      }
    }
  }

  // Inject worktree notebooks into top-level listing
  if (isTopLevel) {
    const wtRoot = path.join(projectPath, '.worktrees');
    if (existsSync(wtRoot)) {
      try {
        const wtEntries = await readdir(wtRoot, { withFileTypes: true });
        for (const wt of wtEntries) {
          if (!wt.isDirectory()) continue;
          const wtPath = path.join(wtRoot, wt.name);
          const wtFiles = await readdir(wtPath).catch(() => [] as string[]);
          const hasNb = wtFiles.some(f => f.endsWith('.notebook.json'));
          if (hasNb) {
            const s = await stat(wtPath).catch(() => null);
            result.files.push({
              name: wt.name,
              type: 'directory',
              size: 0,
              modifiedAt: s?.mtime.toISOString() ?? new Date().toISOString(),
              isNotebook: true,
              worktreePath: `.worktrees/${wt.name}`,
            } as any);
          }
        }
        result.files.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } catch { /* ignore .worktrees scan errors */ }
    }
  }

  return result;
}
