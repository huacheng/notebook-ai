/**
 * Tests for DELETE /api/projects/:id/notebooks/by-path with merge parameter.
 *
 * Tests:
 * 1. ?merge=true merges worktree branch to main before deletion
 * 2. ?merge=false or absent deletes without merging
 * 3. Merge conflict returns 409
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import express from 'express';
import request from 'supertest';
import { createProjectsRouter } from '../routes/projects.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'notebook-delete-merge-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function createMockDb(project: { id: string; path: string; title: string }) {
  const notebooks: any[] = [];
  return {
    getProject: (id: string) => (id === project.id ? { ...project, slug: 'test', status: 'active' } : null),
    listProjects: () => [project],
    createProject: () => project.id,
    deleteProject: () => {},
    updateProject: () => {},
    listProjectNotebooks: () => notebooks,
    getActiveSession: () => null,
    createNotebook: (nb: any) => {
      const id = `nb-${notebooks.length}`;
      notebooks.push({ ...nb, id, notebook_path: nb.notebookPath, workspace_dir: nb.workspaceDir });
      return id;
    },
    updateNotebook: () => {},
    getNotebookByPath: (p: string) => notebooks.find((n: any) => n.notebook_path === p) || null,
    deleteNotebook: (id: string) => {
      const idx = notebooks.findIndex((n: any) => n.id === id);
      if (idx >= 0) notebooks.splice(idx, 1);
    },
    _notebooks: notebooks,
  } as any;
}

const mockSessionManager = {
  closeSession: async () => {},
} as any;

async function setupProjectWithWorktree() {
  const projectDir = path.join(tmpRoot, 'myproject');
  await mkdir(projectDir, { recursive: true });

  const git = simpleGit(projectDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');

  // Initial commit
  await writeFile(path.join(projectDir, 'readme.txt'), 'initial', 'utf-8');
  await git.add('-A');
  await git.commit('init');

  // Create worktree branch
  await git.branch(['task/my-notebook']);

  // Add worktree
  const worktreeDir = path.join(projectDir, '.worktrees', 'task-my-notebook');
  await git.raw(['worktree', 'add', worktreeDir, 'task/my-notebook']);

  // Add some work in the worktree
  const wtGit = simpleGit(worktreeDir);
  await writeFile(path.join(worktreeDir, 'feature.txt'), 'feature content', 'utf-8');
  await writeFile(path.join(worktreeDir, 'my-notebook.notebook.json'), '{"cells":[]}', 'utf-8');
  await wtGit.add('-A');
  await wtGit.commit('add feature');

  return { projectDir, worktreeDir, git };
}

function createTestApp(db: any) {
  const router = createProjectsRouter(db, mockSessionManager, {} as any, tmpRoot);
  const app = express();
  app.use(express.json());
  app.use('/api/projects', router);
  return app;
}

describe('DELETE /api/projects/:id/notebooks/by-path with merge', () => {
  it('?merge=true merges worktree branch to main before deletion', async () => {
    const { projectDir, worktreeDir, git } = await setupProjectWithWorktree();
    const notebookPath = path.join(worktreeDir, 'my-notebook.notebook.json');
    const PROJECT_ID = 'test-project';

    const db = createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test' });
    db.createNotebook({
      userId: 'test-user',
      title: 'Test Notebook',
      workspaceDir: worktreeDir,
      notebookPath: notebookPath,
    });

    const app = createTestApp(db);

    const relPath = '.worktrees/task-my-notebook';
    await request(app)
      .delete(`/api/projects/${PROJECT_ID}/notebooks/by-path?path=${encodeURIComponent(relPath)}&merge=true`)
      .expect(204);

    // Verify worktree is deleted
    expect(existsSync(worktreeDir)).toBe(false);

    // Verify feature.txt is now on master (merged)
    const featureContent = await readFile(path.join(projectDir, 'feature.txt'), 'utf-8');
    expect(featureContent).toBe('feature content');

    // Verify branch is deleted
    const branches = await git.branch(['-l']);
    expect(branches.all).not.toContain('task/my-notebook');
  });

  it('?merge=false deletes without merging', async () => {
    const { projectDir, worktreeDir } = await setupProjectWithWorktree();
    const notebookPath = path.join(worktreeDir, 'my-notebook.notebook.json');
    const PROJECT_ID = 'test-project';

    const db = createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test' });
    db.createNotebook({
      userId: 'test-user',
      title: 'Test Notebook',
      workspaceDir: worktreeDir,
      notebookPath: notebookPath,
    });

    const app = createTestApp(db);

    const relPath = '.worktrees/task-my-notebook';
    await request(app)
      .delete(`/api/projects/${PROJECT_ID}/notebooks/by-path?path=${encodeURIComponent(relPath)}&merge=false`)
      .expect(204);

    // Verify worktree is deleted
    expect(existsSync(worktreeDir)).toBe(false);

    // feature.txt should NOT exist on master (not merged)
    expect(existsSync(path.join(projectDir, 'feature.txt'))).toBe(false);
  });

  it('merge conflict returns 409', async () => {
    const { projectDir, worktreeDir, git } = await setupProjectWithWorktree();
    const notebookPath = path.join(worktreeDir, 'my-notebook.notebook.json');
    const PROJECT_ID = 'test-project';

    // Create conflict: modify same file on master
    await writeFile(path.join(projectDir, 'feature.txt'), 'main version', 'utf-8');
    await git.add('-A');
    await git.commit('conflicting change on main');

    const db = createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test' });
    db.createNotebook({
      userId: 'test-user',
      title: 'Test Notebook',
      workspaceDir: worktreeDir,
      notebookPath: notebookPath,
    });

    const app = createTestApp(db);

    const relPath = '.worktrees/task-my-notebook';
    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/notebooks/by-path?path=${encodeURIComponent(relPath)}&merge=true`)
      .expect(409);

    expect(res.body.error).toMatch(/conflict/i);

    // Worktree should still exist
    expect(existsSync(worktreeDir)).toBe(true);
  });
});
