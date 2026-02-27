/**
 * Duplicate slug rejection tests (409 Conflict).
 *
 * RED if:
 * - POST /projects with duplicate title still succeeds (no 409)
 * - POST /projects/:id/notebooks with duplicate title still appends UUID suffix (no 409)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import { createProjectsRouter } from '../routes/projects.js';

// ── Mock db ────────────────────────────────────────────────────────────────

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

// ── Mock session manager & notebook store ──────────────────────────────────

function createMockSessionManager() {
  return {
    createSession: vi.fn(async (notebookPath: string, cwd: string) => ({
      id: `nb-${Date.now()}`,
      notebookPath,
      cwd,
      notebook: { version: 1, metadata: {}, cells: [], slice: { generated: false, sections: [] }, annotations: [], assets: { intermediate_files: [] } },
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
      slice: { generated: false, sections: [] },
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

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'dup-slug-test-'));
  db = createMockDb();

  const sm = createMockSessionManager();
  const ns = createMockNotebookStore();

  const router = createProjectsRouter(db as any, sm as any, ns as any, tmpRoot);
  app = express();
  app.use(express.json());
  app.use('/projects', router);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('duplicate project name → 409', () => {
  it('rejects creating a project with a slug that already exists as a directory', async () => {
    // First creation should succeed
    const res1 = await request(app)
      .post('/projects')
      .send({ title: '测试项目' })
      .expect(200);

    expect(res1.body.title).toBe('测试项目');

    // Second creation with same title should return 409
    const res2 = await request(app)
      .post('/projects')
      .send({ title: '测试项目' });

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/exist|duplicate|conflict/i);
  });
});

describe('duplicate notebook name → 409', () => {
  it('rejects creating a notebook with same slug under the same project', async () => {
    // Set up project directory with git
    const projectSlug = 'test-proj';
    const projectPath = path.join(tmpRoot, projectSlug);
    await mkdir(path.join(projectPath, '.deliverables'), { recursive: true });
    execSync('git init && git add -A && git commit -m "init" --allow-empty', {
      cwd: projectPath,
      stdio: 'ignore',
    });

    const project = {
      id: 'proj-1',
      title: 'Test Project',
      slug: projectSlug,
      path: projectPath,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.projects.push(project);

    // First notebook creation should succeed
    const res1 = await request(app)
      .post('/projects/proj-1/notebooks')
      .send({ title: '我的笔记' });

    // The current code appends UUID suffix on collision — it should NOT
    // But for the first one, it should just succeed
    expect(res1.status).toBe(200);

    // Second notebook with same title should return 409 (not append UUID)
    const res2 = await request(app)
      .post('/projects/proj-1/notebooks')
      .send({ title: '我的笔记' });

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/exist|duplicate|conflict/i);
  });
});
