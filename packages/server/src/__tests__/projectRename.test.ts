/**
 * Project rename — TDD tests
 *
 * With ASCII slug architecture, rename only updates:
 * 1. The title in the DB project record
 *
 * No directory renames, no path/slug changes, no notebook path updates,
 * no settings.json regeneration, no .MEMORY.md rewriting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import { mkdirSync } from 'fs';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import { createProjectsRouter } from '../routes/projects.js';

// ── Minimal mock db ──────────────────────────────────────────────────────

function createMockDb(project: { id: string; path: string; title: string; slug: string }) {
  let projectData = { ...project, status: 'active', notebook_count: 0 };
  const notebooks: any[] = [];
  return {
    getProject: (id: string) => (id === projectData.id ? { ...projectData } : null),
    listProjects: () => [projectData],
    createProject: (p: any) => p,
    deleteProject: () => {},
    updateProject: (id: string, updates: any) => {
      if (id !== projectData.id) return undefined;
      Object.assign(projectData, updates);
      return { ...projectData };
    },
    listProjectNotebooks: (projectId: string) =>
      notebooks.filter((n: any) => n.project_id === projectId)
        .map((n: any) => ({ id: n.id, workspace_dir: n.workspace_dir })),
    getActiveSession: () => null,
    createNotebook: (nb: any) => { notebooks.push(nb); return nb; },
    updateNotebook: (id: string, updates: any) => {
      const nb = notebooks.find((n: any) => n.id === id);
      if (nb) Object.assign(nb, updates);
      return nb;
    },
    getNotebookByPath: (p: string) => notebooks.find((n: any) => n.notebook_path === p) || null,
    deleteNotebook: () => {},
    pruneOrphanedNotebooks: async () => {},
    _notebooks: notebooks,
    _project: projectData,
  } as any;
}

const mockSessionManager = { restartSession: vi.fn() } as any;
const mockNotebookStore = {} as any;

// ── Test setup ──────────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;
let app: ReturnType<typeof express>;
let db: ReturnType<typeof createMockDb>;
const PROJECT_ID = 'proj-rename-1';
const OLD_SLUG = 'proj-aabbccdd';

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nb-test-proj-rename-'));
  projectDir = path.join(tmpDir, OLD_SLUG);

  // Init a bare git repo to support worktree operations
  execSync(`git init --bare ${path.join(projectDir, '.git')}`, { stdio: 'ignore' });
  mkdirSync(projectDir, { recursive: true });

  db = createMockDb({ id: PROJECT_ID, path: projectDir, title: 'My Project', slug: OLD_SLUG });
  const router = createProjectsRouter(db, mockSessionManager, mockNotebookStore, tmpDir);
  app = express();
  app.use(express.json());
  app.use('/api/projects', router);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('PATCH /api/projects/:projectId (rename)', () => {
  it('updates db project title (path and slug unchanged)', async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({ title: 'Renamed Project' })
      .expect(200);

    const project = db.getProject(PROJECT_ID);
    expect(project.title).toBe('Renamed Project');
    // Path and slug remain unchanged
    expect(project.path).toBe(projectDir);
    expect(project.slug).toBe(OLD_SLUG);
    expect(res.body.title).toBe('Renamed Project');
  });

  it('returns 400 when title is missing', async () => {
    await request(app)
      .patch(`/api/projects/${PROJECT_ID}`)
      .send({})
      .expect(400);
  });

  it('returns 404 when project does not exist', async () => {
    await request(app)
      .patch('/api/projects/nonexistent')
      .send({ title: 'New Title' })
      .expect(404);
  });
});
