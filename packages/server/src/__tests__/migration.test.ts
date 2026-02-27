/**
 * DB hard migration tests (Step 5).
 *
 * Tests:
 * 1. Migration moves notebook.json from project/{slug}/ to worktree/{slug}.notebook.json
 * 2. DB notebook_path is updated after migration
 * 3. Old empty project/{slug}/ directory is cleaned up
 * 4. Standalone notebooks (no project_id) are not affected
 * 5. Idempotent: already-migrated notebooks are skipped
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { NotebookDb } from '../db.js';

let tmpRoot: string;
let db: NotebookDb;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'migration-test-'));
  db = new NotebookDb(path.join(tmpRoot, 'test.db'));
});

afterEach(async () => {
  db.close();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('migrateNotebookPaths', () => {
  it('moves notebook.json from old path to worktree path', async () => {
    const { migrateNotebookPaths } = await import('../migration.js');

    // Set up old-style paths
    const projectPath = path.join(tmpRoot, 'my-project');
    const oldNbDir = path.join(projectPath, 'my-task');
    const worktreePath = path.join(projectPath, '.worktrees', 'task-my-task');
    const oldNbPath = path.join(oldNbDir, 'my-task.notebook.json');
    const newNbPath = path.join(worktreePath, 'my-task.notebook.json');

    await mkdir(oldNbDir, { recursive: true });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(oldNbPath, JSON.stringify({ metadata: { title: 'Test' } }), 'utf-8');

    // Create DB record pointing to old path
    db.createProject({
      id: 'proj-1', title: 'My Project', slug: 'my-project',
      path: projectPath, status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    db.createNotebook({
      id: 'nb-1', user_id: null, title: 'My Task', slug: 'my-task',
      workspace_dir: worktreePath, notebook_path: oldNbPath,
      project_id: 'proj-1', status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    await migrateNotebookPaths(db);

    // File should be at new location
    expect(existsSync(newNbPath)).toBe(true);
    expect(existsSync(oldNbPath)).toBe(false);

    // Content should be preserved
    const content = JSON.parse(await readFile(newNbPath, 'utf-8'));
    expect(content.metadata.title).toBe('Test');
  });

  it('updates DB notebook_path after migration', async () => {
    const { migrateNotebookPaths } = await import('../migration.js');

    const projectPath = path.join(tmpRoot, 'proj2');
    const oldNbDir = path.join(projectPath, 'task-a');
    const worktreePath = path.join(projectPath, '.worktrees', 'task-task-a');
    const oldNbPath = path.join(oldNbDir, 'task-a.notebook.json');
    const newNbPath = path.join(worktreePath, 'task-a.notebook.json');

    await mkdir(oldNbDir, { recursive: true });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(oldNbPath, '{}', 'utf-8');

    db.createProject({
      id: 'proj-2', title: 'Proj 2', slug: 'proj2',
      path: projectPath, status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    db.createNotebook({
      id: 'nb-2', user_id: null, title: 'Task A', slug: 'task-a',
      workspace_dir: worktreePath, notebook_path: oldNbPath,
      project_id: 'proj-2', status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    await migrateNotebookPaths(db);

    const row = db.getNotebook('nb-2');
    expect(row!.notebook_path).toBe(newNbPath);
  });

  it('cleans up old empty directory', async () => {
    const { migrateNotebookPaths } = await import('../migration.js');

    const projectPath = path.join(tmpRoot, 'proj3');
    const oldNbDir = path.join(projectPath, 'cleanup');
    const worktreePath = path.join(projectPath, '.worktrees', 'task-cleanup');
    const oldNbPath = path.join(oldNbDir, 'cleanup.notebook.json');

    await mkdir(oldNbDir, { recursive: true });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(oldNbPath, '{}', 'utf-8');

    db.createProject({
      id: 'proj-3', title: 'Proj 3', slug: 'proj3',
      path: projectPath, status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    db.createNotebook({
      id: 'nb-3', user_id: null, title: 'Cleanup', slug: 'cleanup',
      workspace_dir: worktreePath, notebook_path: oldNbPath,
      project_id: 'proj-3', status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    await migrateNotebookPaths(db);

    expect(existsSync(oldNbDir)).toBe(false);
  });

  it('does not affect standalone notebooks (no project_id)', async () => {
    const { migrateNotebookPaths } = await import('../migration.js');

    const standaloneDir = path.join(tmpRoot, 'standalone');
    const nbPath = path.join(standaloneDir, 'solo.notebook.json');
    await mkdir(standaloneDir, { recursive: true });
    await writeFile(nbPath, '{}', 'utf-8');

    db.createNotebook({
      id: 'nb-solo', user_id: null, title: 'Solo', slug: 'solo',
      workspace_dir: standaloneDir, notebook_path: nbPath,
      status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    await migrateNotebookPaths(db);

    // Path should not change
    const row = db.getNotebook('nb-solo');
    expect(row!.notebook_path).toBe(nbPath);
    expect(existsSync(nbPath)).toBe(true);
  });

  it('is idempotent — already-migrated notebooks are skipped', async () => {
    const { migrateNotebookPaths } = await import('../migration.js');

    const projectPath = path.join(tmpRoot, 'proj4');
    const worktreePath = path.join(projectPath, '.worktrees', 'task-done');
    const nbPath = path.join(worktreePath, 'done.notebook.json');

    await mkdir(worktreePath, { recursive: true });
    await writeFile(nbPath, '{}', 'utf-8');

    db.createProject({
      id: 'proj-4', title: 'Proj 4', slug: 'proj4',
      path: projectPath, status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    db.createNotebook({
      id: 'nb-done', user_id: null, title: 'Done', slug: 'done',
      workspace_dir: worktreePath, notebook_path: nbPath,
      project_id: 'proj-4', status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    // Should not throw
    await migrateNotebookPaths(db);

    const row = db.getNotebook('nb-done');
    expect(row!.notebook_path).toBe(nbPath);
    expect(existsSync(nbPath)).toBe(true);
  });
});
