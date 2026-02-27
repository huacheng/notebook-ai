import path from 'path';
import { rename, rm } from 'fs/promises';
import { existsSync } from 'fs';
import type { NotebookDb } from './db.js';

/**
 * Migrates notebook_path from old layout (project/{slug}/{slug}.notebook.json)
 * to new layout (worktree/{slug}.notebook.json).
 *
 * Only affects project notebooks (project_id != null) where the notebook file
 * is not already at the expected worktree location.
 *
 * Idempotent: skips already-migrated notebooks.
 */
export async function migrateNotebookPaths(db: NotebookDb): Promise<void> {
  const notebooks = db.listNotebooks();

  for (const row of notebooks) {
    if (!row.project_id) continue; // standalone notebooks — skip

    const slug = path.basename(row.notebook_path, '.notebook.json');
    const worktreePath = row.workspace_dir; // already points to worktree
    const newNbPath = path.join(worktreePath, `${slug}.notebook.json`);

    if (row.notebook_path === newNbPath) continue; // already migrated

    // Move file if old location exists
    if (existsSync(row.notebook_path)) {
      await rename(row.notebook_path, newNbPath);
    }

    // Update DB
    db.updateNotebook(row.id, { notebook_path: newNbPath });

    // Clean up old empty directory
    const oldDir = path.dirname(row.notebook_path);
    try {
      await rm(oldDir, { recursive: true, force: true });
    } catch { /* ignore if dir not empty or already gone */ }

    console.log(`[migration] ${row.id}: ${row.notebook_path} → ${newNbPath}`);
  }
}
