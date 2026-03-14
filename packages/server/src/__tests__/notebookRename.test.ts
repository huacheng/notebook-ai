/**
 * Notebook rename — TDD tests
 *
 * With ASCII slug architecture, rename only updates:
 * 1. The title in the DB notebook record
 * 2. The metadata.title INSIDE the .notebook.json file
 *
 * No directory renames, no file renames, no branch renames, no slug changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import { createProjectsRouter } from '../routes/projects.js';

// ── Minimal mock db ──────────────────────────────────────────────────────

function createMockDb(project: { id: string; path: string; title: string; slug: string }) {
  let projectData = { ...project, status: 'active', notebook_count: 1 };
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

const mockSessionManager = {
  getSession: vi.fn().mockReturnValue(null),
  restartSession: vi.fn(),
} as any;
const mockNotebookStore = {} as any;

// ── Test setup ──────────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;
let worktreeDir: string;
let notebookFilePath: string;
let app: ReturnType<typeof express>;
let db: ReturnType<typeof createMockDb>;
const PROJECT_ID = 'proj-nb-rename-1';
const OLD_TITLE = 'My Notebook';
const OLD_SLUG = 'nb-aabbccdd';

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nb-test-nb-rename-'));
  projectDir = path.join(tmpDir, 'test-project');
  const worktreesBase = path.join(projectDir, '.worktrees');
  worktreeDir = path.join(worktreesBase, `task-${OLD_SLUG}`);

  // Init a git repo with initial commit
  mkdirSync(projectDir, { recursive: true });
  execSync('git init', { cwd: projectDir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: projectDir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: projectDir, stdio: 'ignore' });
  execSync('git commit --allow-empty -m "init"', { cwd: projectDir, stdio: 'ignore' });

  // Create .worktrees directory
  mkdirSync(worktreesBase, { recursive: true });

  // Create a proper git worktree
  execSync(`git worktree add -b task/${OLD_SLUG} "${worktreeDir}"`, { cwd: projectDir, stdio: 'ignore' });

  // Create the .notebook.json file with metadata.title
  notebookFilePath = path.join(worktreeDir, `${OLD_SLUG}.notebook.json`);
  const notebookContent = {
    metadata: {
      title: OLD_TITLE,
      created_at: new Date().toISOString(),
    },
    cells: [],
  };
  await writeFile(notebookFilePath, JSON.stringify(notebookContent, null, 2));

  db = createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test Project', slug: 'test-project' });
  db._notebooks.push({
    id: 'nb-1',
    project_id: PROJECT_ID,
    title: OLD_TITLE,
    slug: OLD_SLUG,
    workspace_dir: worktreeDir,
    notebook_path: notebookFilePath,
  });

  const router = createProjectsRouter(db, mockSessionManager, mockNotebookStore, tmpDir);
  app = express();
  app.use(express.json());
  app.use('/api/projects', router);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('PATCH /api/projects/:projectId/notebooks/rename', () => {
  it('updates metadata.title inside .notebook.json file', async () => {
    const newTitle = 'Renamed Notebook';

    await request(app)
      .patch(`/api/projects/${PROJECT_ID}/notebooks/rename`)
      .send({ notebookPath: worktreeDir, title: newTitle })
      .expect(200);

    // File stays at the SAME path (no rename)
    const content = await readFile(notebookFilePath, 'utf-8');
    const notebook = JSON.parse(content);
    expect(notebook.metadata.title).toBe(newTitle);
  });

  it('updates db notebook title only (slug and paths unchanged)', async () => {
    const newTitle = 'Renamed Notebook';

    await request(app)
      .patch(`/api/projects/${PROJECT_ID}/notebooks/rename`)
      .send({ notebookPath: worktreeDir, title: newTitle })
      .expect(200);

    const nb = db._notebooks[0];
    expect(nb.title).toBe(newTitle);
    // Slug and paths remain unchanged
    expect(nb.slug).toBe(OLD_SLUG);
    expect(nb.workspace_dir).toBe(worktreeDir);
    expect(nb.notebook_path).toBe(notebookFilePath);
  });

  it('preserves other metadata fields when updating title', async () => {
    // Add extra metadata to the notebook
    const originalContent = JSON.parse(await readFile(notebookFilePath, 'utf-8'));
    originalContent.metadata.model = 'opus';
    originalContent.metadata.custom_field = 'custom_value';
    originalContent.cells = [{ id: 'cell-1', type: 'prompt', source: 'hello' }];
    await writeFile(notebookFilePath, JSON.stringify(originalContent, null, 2));

    const newTitle = 'Renamed Notebook';

    await request(app)
      .patch(`/api/projects/${PROJECT_ID}/notebooks/rename`)
      .send({ notebookPath: worktreeDir, title: newTitle })
      .expect(200);

    // File stays at the SAME path
    const content = await readFile(notebookFilePath, 'utf-8');
    const notebook = JSON.parse(content);

    expect(notebook.metadata.title).toBe(newTitle);
    expect(notebook.metadata.model).toBe('opus');
    expect(notebook.metadata.custom_field).toBe('custom_value');
    expect(notebook.cells).toHaveLength(1);
    expect(notebook.cells[0].source).toBe('hello');
  });

  it('returns 400 when notebookPath is missing', async () => {
    await request(app)
      .patch(`/api/projects/${PROJECT_ID}/notebooks/rename`)
      .send({ title: 'New Title' })
      .expect(400);
  });

  it('returns 400 when title is missing', async () => {
    await request(app)
      .patch(`/api/projects/${PROJECT_ID}/notebooks/rename`)
      .send({ notebookPath: worktreeDir })
      .expect(400);
  });

  it('returns 400 when path is outside project', async () => {
    await request(app)
      .patch(`/api/projects/${PROJECT_ID}/notebooks/rename`)
      .send({ notebookPath: '/nonexistent/path', title: 'New Title' })
      .expect(400);
  });

  it('returns 404 when path does not exist within project', async () => {
    await request(app)
      .patch(`/api/projects/${PROJECT_ID}/notebooks/rename`)
      .send({ notebookPath: path.join(projectDir, 'nonexistent'), title: 'New Title' })
      .expect(404);
  });
});
