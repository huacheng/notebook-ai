/**
 * Integration test: backend enforces title uniqueness per project (409)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import { createProjectsRouter } from '../routes/projects.js';

// ── Mock helpers ───────────────────────────────────────────────────────────

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

// ── Setup ──────────────────────────────────────────────────────────────────

let tmpRoot: string;
let app: express.Express;
let db: ReturnType<typeof createMockDb>;

async function setupProject(projectId: string, projectTitle: string) {
  const projectSlug = `proj-${projectId}`;
  const projectPath = path.join(tmpRoot, projectSlug);
  await mkdir(path.join(projectPath, '.deliverables'), { recursive: true });
  execSync('git init && git add -A && git commit -m "init" --allow-empty', {
    cwd: projectPath,
    stdio: 'ignore',
  });

  const project = {
    id: projectId,
    title: projectTitle,
    slug: projectSlug,
    path: projectPath,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.projects.push(project);
  return project;
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'nb-test-title-unique-'));
  db = createMockDb();

  const sm = createMockSessionManager();
  const ns = createMockNotebookStore();

  const router = createProjectsRouter(db as any, sm as any, ns as any, tmpRoot);
  app = express();
  app.use(express.json());
  app.use('/api/projects', router);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('POST /:projectId/notebooks — title uniqueness', () => {
  it('rejects new worktree notebook with same title as default', async () => {
    // Set up project with a default notebook already registered (same title 'Proj')
    const project = await setupProject('proj-1', 'Proj');

    // Manually insert a default notebook row with title 'Proj' to simulate Task 7 behavior
    db.notebooks.push({
      id: 'nb-default',
      project_id: 'proj-1',
      title: 'Proj',
      slug: 'proj-default',
      workspace_dir: project.path,
      notebook_path: path.join(project.path, 'proj-default.notebook.json'),
      is_default: true,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Creating a worktree notebook with the same title 'Proj' should 409
    const res = await request(app)
      .post(`/api/projects/proj-1/notebooks`)
      .send({ title: 'Proj' })
      .expect(409);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('rejects two worktree notebooks with identical titles', async () => {
    await setupProject('proj-2', 'P2');

    // First worktree notebook with title 'NB1' → 200
    await request(app)
      .post(`/api/projects/proj-2/notebooks`)
      .send({ title: 'NB1' })
      .expect(200);

    // Second worktree notebook with same title → 409
    const res = await request(app)
      .post(`/api/projects/proj-2/notebooks`)
      .send({ title: 'NB1' })
      .expect(409);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('case-sensitive uniqueness: Alpha vs alpha are distinct', async () => {
    await setupProject('proj-3', 'P3');

    // 'Alpha' → 200
    await request(app)
      .post(`/api/projects/proj-3/notebooks`)
      .send({ title: 'Alpha' })
      .expect(200);

    // 'alpha' (different case) → also 200
    await request(app)
      .post(`/api/projects/proj-3/notebooks`)
      .send({ title: 'alpha' })
      .expect(200);
  });
});
