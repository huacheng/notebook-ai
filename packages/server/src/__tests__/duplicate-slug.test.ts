/**
 * Duplicate title tests — both creations should succeed.
 *
 * With ASCII slug architecture, each creation generates a unique random slug
 * (proj-{8hex} or nb-{8hex}), so duplicate titles are allowed.
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
      notebook: { version: 1, metadata: {}, cells: [], slide: { generated: false, sections: [] }, annotations: [], assets: { intermediate_files: [] } },
    })),
    executeCell: vi.fn(async () => {}),
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

describe('duplicate project title succeeds (unique random slugs)', () => {
  it('creates two projects with the same title, each with a different slug', async () => {
    const res1 = await request(app)
      .post('/projects')
      .send({ title: '测试项目' })
      .expect(200);

    const res2 = await request(app)
      .post('/projects')
      .send({ title: '测试项目' })
      .expect(200);

    expect(res1.body.title).toBe('测试项目');
    expect(res2.body.title).toBe('测试项目');
    expect(res1.body.slug).not.toBe(res2.body.slug);
    expect(res1.body.slug).toMatch(/^proj-[0-9a-f]{8}$/);
    expect(res2.body.slug).toMatch(/^proj-[0-9a-f]{8}$/);
  });
});

describe('duplicate notebook title rejected (409) per project uniqueness', () => {
  it('rejects second notebook with the same title under the same project', async () => {
    // Set up project directory with git
    const projectSlug = 'proj-11223344';
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

    // First notebook with title succeeds
    await request(app)
      .post('/projects/proj-1/notebooks')
      .send({ title: '我的笔记' })
      .expect(200);

    // Second notebook with the same title is rejected with 409
    const res = await request(app)
      .post('/projects/proj-1/notebooks')
      .send({ title: '我的笔记' })
      .expect(409);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/already exists/i);

    // Only one notebook should be in DB
    const nbs = db.notebooks.filter((n) => n.project_id === 'proj-1');
    expect(nbs).toHaveLength(1);
    expect(nbs[0].title).toBe('我的笔记');
    expect(nbs[0].slug).toMatch(/^nb-[0-9a-f]{8}$/);
  });
});
