/**
 * Tests for DELETE /api/projects/:id/notebooks/by-path with merge parameter.
 *
 * merge=true uses mergeDeliverables (selective: only .deliverables/ is merged).
 * merge=false deletes without merging.
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
  await mkdir(path.join(projectDir, '.deliverables'), { recursive: true });

  const git = simpleGit(projectDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');

  // Initial commit
  await writeFile(path.join(projectDir, '.deliverables', '.keep'), '', 'utf-8');
  await writeFile(path.join(projectDir, '.gitignore'), '.worktrees/\n', 'utf-8');
  await git.add('-A');
  await git.commit('init');

  // Create worktree branch
  await git.branch(['task/my-notebook']);

  // Add worktree
  const worktreeDir = path.join(projectDir, '.worktrees', 'task-my-notebook');
  await git.raw(['worktree', 'add', worktreeDir, 'task/my-notebook']);

  // Add work in the worktree: deliverables + notebook artifacts
  const wtGit = simpleGit(worktreeDir);
  await mkdir(path.join(worktreeDir, '.deliverables', 'output'), { recursive: true });
  await mkdir(path.join(worktreeDir, '.working'), { recursive: true });
  await mkdir(path.join(worktreeDir, '.claude'), { recursive: true });
  await writeFile(path.join(worktreeDir, '.deliverables', 'output', 'report.pdf'), 'report', 'utf-8');
  await writeFile(path.join(worktreeDir, '.working', '.status.json'), '{}', 'utf-8');
  await writeFile(path.join(worktreeDir, '.claude', 'settings.json'), '{}', 'utf-8');
  await writeFile(path.join(worktreeDir, '.MEMORY.md'), '# NB Memory', 'utf-8');
  await writeFile(path.join(worktreeDir, 'my-notebook.notebook.json'), '{"cells":[]}', 'utf-8');
  await wtGit.add('-A');
  await wtGit.commit('add task work');

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
  it('?merge=true merges only .deliverables/ to master, not notebook artifacts', async () => {
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

    // Verify .deliverables/ content is merged
    expect(existsSync(path.join(projectDir, '.deliverables', 'output', 'report.pdf'))).toBe(true);

    // Verify notebook artifacts are NOT on master
    expect(existsSync(path.join(projectDir, '.working'))).toBe(false);
    expect(existsSync(path.join(projectDir, '.claude'))).toBe(false);
    expect(existsSync(path.join(projectDir, 'my-notebook.notebook.json'))).toBe(false);

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

    // .deliverables/output should NOT exist (not merged)
    expect(existsSync(path.join(projectDir, '.deliverables', 'output'))).toBe(false);
  });

  it('merge=true with no deliverables still succeeds', async () => {
    // Setup a worktree with no .deliverables/ changes
    const projectDir = path.join(tmpRoot, 'proj2');
    await mkdir(path.join(projectDir, '.deliverables'), { recursive: true });

    const git = simpleGit(projectDir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await writeFile(path.join(projectDir, '.deliverables', '.keep'), '', 'utf-8');
    await git.add('-A');
    await git.commit('init');

    await git.branch(['task/empty-nb']);
    const worktreeDir = path.join(projectDir, '.worktrees', 'task-empty-nb');
    await git.raw(['worktree', 'add', worktreeDir, 'task/empty-nb']);

    // Only notebook artifact, no deliverables
    const wtGit = simpleGit(worktreeDir);
    await writeFile(path.join(worktreeDir, 'empty-nb.notebook.json'), '{}', 'utf-8');
    await wtGit.add('-A');
    await wtGit.commit('notebook only');

    const PROJECT_ID = 'test-project-2';
    const db = createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test2' });
    const notebookPath = path.join(worktreeDir, 'empty-nb.notebook.json');
    db.createNotebook({
      userId: 'test-user',
      title: 'Empty NB',
      workspaceDir: worktreeDir,
      notebookPath,
    });

    const app = createTestApp(db);

    const relPath = '.worktrees/task-empty-nb';
    await request(app)
      .delete(`/api/projects/${PROJECT_ID}/notebooks/by-path?path=${encodeURIComponent(relPath)}&merge=true`)
      .expect(204);

    expect(existsSync(worktreeDir)).toBe(false);
  });
});
