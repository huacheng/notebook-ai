/**
 * Notebook path relocation tests (Step 3).
 *
 * After creating a notebook, verify:
 * 1. notebook.json exists at worktreePath/{slug}.notebook.json (not project/{slug}/)
 * 2. project/{slug}/ directory does NOT exist
 * 3. worktreePath/.deliverables/ directory exists
 * 4. worktreePath/.working/.index.json exists
 * 5. DB notebook_path points to worktree path
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import { createProjectsRouter } from '../routes/projects.js';

// ── Mock db that tracks notebook records ───────────────────────────────────

function createMockDb() {
  const projects: any[] = [];
  const notebooks: any[] = [];
  return {
    projects,
    notebooks,
    getProject: (id: string) => projects.find((p) => p.id === id) ?? null,
    listProjects: () => projects,
    createProject: (p: any) => { projects.push(p); return p; },
    deleteProject: () => {},
    updateProject: () => {},
    listProjectNotebooks: (pid: string) => notebooks.filter((n) => n.project_id === pid),
    getActiveSession: () => null,
    createNotebook: (nb: any) => { notebooks.push(nb); return nb; },
    updateNotebook: () => {},
    deleteNotebook: () => {},
    getNotebook: () => null,
    getNotebookCount: () => ({ total: 0, active: 0 }),
    listNotebooks: () => [],
  };
}

function createMockSessionManager() {
  return {
    createSession: vi.fn(async (notebookPath: string, cwd: string) => ({
      id: `nb-${Date.now()}`,
      notebookPath,
      cwd,
      notebook: { version: 1, metadata: {}, cells: [], slide: { generated: false, sections: [] }, annotations: [], assets: { intermediate_files: [] } },
    })),
    getSession: () => null,
    deleteSession: () => {},
  };
}

function createMockNotebookStore() {
  return {
    createNew: (title: string, _cwd: string) => ({
      version: 1,
      metadata: { title, created: new Date().toISOString(), agent: 'claude', git_repo: false },
      cells: [],
      slide: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    }),
    save: vi.fn(async () => {}),
    load: vi.fn(async () => null),
  };
}

// ── Test suite ─────────────────────────────────────────────────────────────

let tmpRoot: string;
let app: express.Express;
let db: ReturnType<typeof createMockDb>;
let sm: ReturnType<typeof createMockSessionManager>;
let ns: ReturnType<typeof createMockNotebookStore>;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'nb-path-test-'));
  db = createMockDb();
  sm = createMockSessionManager();
  ns = createMockNotebookStore();

  const router = createProjectsRouter(db as any, sm as any, ns as any, tmpRoot);
  app = express();
  app.use(express.json());
  app.use('/projects', router);

  // Set up a project with git
  const projectSlug = 'test-proj';
  const projectPath = path.join(tmpRoot, projectSlug);
  await mkdir(path.join(projectPath, '.deliverables'), { recursive: true });
  execSync('git init && git add -A && git commit -m "init" --allow-empty', {
    cwd: projectPath,
    stdio: 'ignore',
  });

  db.projects.push({
    id: 'proj-1',
    title: 'Test Project',
    slug: projectSlug,
    path: projectPath,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('notebook path in worktree (Step 3)', () => {
  it('notebook.json is saved at worktreePath/{slug}.notebook.json', async () => {
    const res = await request(app)
      .post('/projects/proj-1/notebooks')
      .send({ title: 'My Task' })
      .expect(200);

    const projectPath = db.projects[0].path;
    const worktreePath = path.join(projectPath, '.worktrees', 'task-my-task');
    const expectedNbPath = path.join(worktreePath, 'my-task.notebook.json');

    // notebookStore.save should have been called with the worktree path
    expect(ns.save).toHaveBeenCalledWith(expectedNbPath, expect.anything());
  });

  it('project/{slug}/ directory does NOT exist after creation', async () => {
    const res = await request(app)
      .post('/projects/proj-1/notebooks')
      .send({ title: 'My Task' })
      .expect(200);

    const projectPath = db.projects[0].path;
    const oldNbDir = path.join(projectPath, 'my-task');

    expect(existsSync(oldNbDir)).toBe(false);
  });

  it('worktreePath/.deliverables/ directory exists', async () => {
    const res = await request(app)
      .post('/projects/proj-1/notebooks')
      .send({ title: 'My Task' })
      .expect(200);

    const projectPath = db.projects[0].path;
    const worktreePath = path.join(projectPath, '.worktrees', 'task-my-task');

    expect(existsSync(path.join(worktreePath, '.deliverables'))).toBe(true);
  });

  it('worktreePath/.working/.index.json exists', async () => {
    const res = await request(app)
      .post('/projects/proj-1/notebooks')
      .send({ title: 'My Task' })
      .expect(200);

    const projectPath = db.projects[0].path;
    const worktreePath = path.join(projectPath, '.worktrees', 'task-my-task');

    expect(existsSync(path.join(worktreePath, '.working', '.index.json'))).toBe(true);
  });

  it('DB notebook_path points to worktree path', async () => {
    const res = await request(app)
      .post('/projects/proj-1/notebooks')
      .send({ title: 'My Task' })
      .expect(200);

    const projectPath = db.projects[0].path;
    const worktreePath = path.join(projectPath, '.worktrees', 'task-my-task');
    const expectedNbPath = path.join(worktreePath, 'my-task.notebook.json');

    expect(db.notebooks).toHaveLength(1);
    expect(db.notebooks[0].notebook_path).toBe(expectedNbPath);
  });
});
