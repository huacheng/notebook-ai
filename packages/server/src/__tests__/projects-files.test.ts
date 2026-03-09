/**
 * Phase 0: Project file CRUD routes — TDD tests
 *
 * Tests the 6 new CRUD routes + dotfile filter update + GET refactor.
 * Uses supertest with a minimal Express app and a mock db.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import { createProjectsRouter } from '../routes/projects.js';

// ── Minimal mock db ────────────────────────────────────────────────────────

function createMockDb(project: { id: string; path: string; title: string }) {
  const notebooks: any[] = [];
  return {
    getProject: (id: string) => (id === project.id ? { ...project, slug: 'test', status: 'active' } : null),
    listProjects: () => [project],
    createProject: (p: any) => p,
    deleteProject: () => {},
    updateProject: () => {},
    listProjectNotebooks: () => [],
    getActiveSession: () => null,
    createNotebook: (nb: any) => { notebooks.push(nb); return nb; },
    updateNotebook: () => {},
    getNotebookByPath: (p: string) => notebooks.find((n: any) => n.notebook_path === p) || null,
    deleteNotebook: (id: string) => { const idx = notebooks.findIndex((n: any) => n.id === id); if (idx >= 0) notebooks.splice(idx, 1); },
    _notebooks: notebooks,
  } as any;
}

const mockSessionManager = {} as any;
const mockNotebookStore = {} as any;

// ── Test setup ─────────────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;
let app: ReturnType<typeof express>;
const PROJECT_ID = 'test-project-1';

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nb-test-projects-'));
  projectDir = path.join(tmpDir, 'my-project');
  await mkdir(projectDir, { recursive: true });

  // Create standard project directory structure
  await mkdir(path.join(projectDir, '.deliverables'), { recursive: true });
  await mkdir(path.join(projectDir, '.git'), { recursive: true });
  await mkdir(path.join(projectDir, '.working'), { recursive: true });
  await mkdir(path.join(projectDir, 'docs'), { recursive: true });
  await writeFile(path.join(projectDir, '.status.json'), '{}');

  const db = createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test Project' });
  const router = createProjectsRouter(db, mockSessionManager, mockNotebookStore, tmpDir);
  app = express();
  app.use(express.json());
  app.use('/api/projects', router);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── 0. Notebook directory detection ──────────────────────────────────────

describe('GET /:projectId/files — notebook directory marking', () => {
  it('marks a directory as isNotebook when it contains {name}.notebook.json', async () => {
    const nbDir = path.join(projectDir, 'my-task');
    await mkdir(nbDir, { recursive: true });
    await writeFile(path.join(nbDir, 'my-task.notebook.json'), '{}');

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const entry = res.body.files.find((f: any) => f.name === 'my-task');
    expect(entry).toBeDefined();
    expect(entry.type).toBe('directory');
    expect(entry.isNotebook).toBe(true);
  });

  it('does NOT mark a regular directory as isNotebook', async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const entry = res.body.files.find((f: any) => f.name === 'docs');
    expect(entry).toBeDefined();
    expect(entry.isNotebook).toBeUndefined();
  });
});

describe('GET /:projectId/files — worktree notebook injection', () => {
  it('injects worktree notebooks as isNotebook entries in top-level listing', async () => {
    // Create worktree-style notebook: .worktrees/task-my-nb/my-nb.notebook.json
    const wtDir = path.join(projectDir, '.worktrees', 'task-my-nb');
    await mkdir(wtDir, { recursive: true });
    await writeFile(path.join(wtDir, 'my-nb.notebook.json'), '{}');

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const names = res.body.files.map((f: any) => f.name);
    // .worktrees itself should still be hidden
    expect(names).not.toContain('.worktrees');
    // But the notebook should appear as a virtual entry
    const nb = res.body.files.find((f: any) => f.isNotebook && f.name === 'task-my-nb');
    expect(nb).toBeDefined();
    expect(nb.type).toBe('directory');
    expect(nb.worktreePath).toBe('.worktrees/task-my-nb');
  });

  it('does not inject worktree dirs that have no .notebook.json', async () => {
    const wtDir = path.join(projectDir, '.worktrees', 'task-orphan');
    await mkdir(wtDir, { recursive: true });
    await writeFile(path.join(wtDir, 'random.txt'), 'not a notebook');

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const entry = res.body.files.find((f: any) => f.name === 'task-orphan');
    expect(entry).toBeUndefined();
  });
});

// ── 1. Dotfile filter ────────────────────────────────────────────────────

describe('GET /:projectId/files — dotfile filter', () => {
  it('hides .deliverables directory (shown via right panel)', async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const names = res.body.files.map((f: any) => f.name);
    expect(names).not.toContain('.deliverables');
  });

  it('shows .status.json in project root listing', async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const names = res.body.files.map((f: any) => f.name);
    expect(names).toContain('.status.json');
  });

  it('hides .git directory', async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const names = res.body.files.map((f: any) => f.name);
    expect(names).not.toContain('.git');
  });

  it('shows .notebook.json files', async () => {
    await writeFile(path.join(projectDir, 'test.notebook.json'), '{}');
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const names = res.body.files.map((f: any) => f.name);
    expect(names).toContain('test.notebook.json');
  });

  it('hides .working and .claude directories', async () => {
    await mkdir(path.join(projectDir, '.claude'), { recursive: true });
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const names = res.body.files.map((f: any) => f.name);
    expect(names).not.toContain('.working');
    expect(names).not.toContain('.claude');
  });

  it('shows non-dot files normally', async () => {
    await writeFile(path.join(projectDir, 'readme.md'), 'hello');
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const names = res.body.files.map((f: any) => f.name);
    expect(names).toContain('readme.md');
  });
});

// ── 2. GET response schema (RG-0) ─────────────────────────────────────────

describe('GET /:projectId/files — response schema', () => {
  it('returns { dirPath, files, truncated } matching existing schema', async () => {
    await writeFile(path.join(projectDir, 'readme.md'), 'hello');
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    expect(res.body).toHaveProperty('dirPath');
    expect(res.body).toHaveProperty('files');
    expect(res.body).toHaveProperty('truncated');
    expect(typeof res.body.truncated).toBe('boolean');
  });

  it('file entries have name, type, size, modifiedAt fields', async () => {
    await writeFile(path.join(projectDir, 'hello.txt'), 'world');
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const txtFile = res.body.files.find((f: any) => f.name === 'hello.txt');
    expect(txtFile).toBeDefined();
    expect(txtFile).toHaveProperty('name', 'hello.txt');
    expect(txtFile).toHaveProperty('type', 'file');
    expect(txtFile).toHaveProperty('size');
    expect(txtFile).toHaveProperty('modifiedAt');
    expect(typeof txtFile.size).toBe('number');
    expect(typeof txtFile.modifiedAt).toBe('string');
  });

  it('directories sorted before files', async () => {
    await mkdir(path.join(projectDir, 'zeta-dir'));
    await writeFile(path.join(projectDir, 'alpha-file.txt'), 'a');
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files`)
      .expect(200);

    const nonDot = res.body.files.filter((f: any) => !f.name.startsWith('.'));
    const dirs = nonDot.filter((f: any) => f.type === 'directory');
    const files = nonDot.filter((f: any) => f.type === 'file');
    expect(dirs.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
    // All directories come before all files
    const lastDirIdx = nonDot.findLastIndex((f: any) => f.type === 'directory');
    const firstFileIdx = nonDot.findIndex((f: any) => f.type === 'file');
    expect(lastDirIdx).toBeLessThan(firstFileIdx);
  });
});

// ── 3. Path traversal prevention (S1) ──────────────────────────────────────

describe('GET /:projectId/files — path security', () => {
  it('rejects path traversal via ../', async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files?path=../../etc`);

    expect([400, 403]).toContain(res.status);
  });

  it('returns 404 for non-existent project', async () => {
    const res = await request(app)
      .get('/api/projects/nonexistent/files');

    expect(res.status).toBe(404);
  });

  it('lists subdirectory contents via path param', async () => {
    await writeFile(path.join(projectDir, 'docs', 'task.md'), 'task');
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files?path=docs`)
      .expect(200);

    const names = res.body.files.map((f: any) => f.name);
    expect(names).toContain('task.md');
  });
});

// ── 4. POST /files — upload ────────────────────────────────────────────────

describe('POST /:projectId/files — upload', () => {
  it('uploads a file to the project', async () => {
    const testContent = 'hello upload';
    const tmpFile = path.join(tmpDir, 'upload.txt');
    await writeFile(tmpFile, testContent);

    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/files?path=docs`)
      .attach('files', tmpFile);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uploaded');
    expect(res.body.uploaded).toContain('upload.txt');

    // Verify file actually written
    const content = await readFile(path.join(projectDir, 'docs', 'upload.txt'), 'utf-8');
    expect(content).toBe(testContent);
  });

  it('rejects upload with no files', async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/files?path=docs`);

    expect(res.status).toBe(400);
  });

  it('rejects upload with path traversal', async () => {
    const tmpFile = path.join(tmpDir, 'evil.txt');
    await writeFile(tmpFile, 'evil');

    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/files?path=../../etc`)
      .attach('files', tmpFile);

    expect([400, 403]).toContain(res.status);
  });
});

// ── 5. POST /files/new-file — create empty file ───────────────────────────

describe('POST /:projectId/files/new-file', () => {
  it('creates an empty file', async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/new-file?path=docs&name=notes.txt`)
      .expect(200);

    expect(res.body).toEqual({ ok: true });

    const content = await readFile(path.join(projectDir, 'docs', 'notes.txt'), 'utf-8');
    expect(content).toBe('');
  });

  it('rejects invalid file names', async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/new-file?path=docs&name=../evil.txt`);

    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/new-file?path=docs&name=`);

    expect(res.status).toBe(400);
  });
});

// ── 6. POST /files/mkdir — create directory ────────────────────────────────

describe('POST /:projectId/files/mkdir', () => {
  it('creates a new directory', async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/mkdir?path=docs&name=subdir`)
      .expect(200);

    expect(res.body).toEqual({ ok: true });

    // Verify directory exists by listing it
    const listing = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files?path=docs/subdir`)
      .expect(200);

    expect(listing.body.files).toEqual([]);
  });

  it('rejects invalid directory names', async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/mkdir?path=docs&name=..`);

    expect(res.status).toBe(400);
  });
});

// ── 7. DELETE /files — delete file/directory ───────────────────────────────

describe('DELETE /:projectId/files', () => {
  it('deletes a file', async () => {
    await writeFile(path.join(projectDir, 'docs', 'to-delete.txt'), 'bye');

    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/files?path=docs/to-delete.txt`)
      .expect(200);

    expect(res.body).toEqual({ ok: true });

    // Verify file no longer listed
    const listing = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files?path=docs`)
      .expect(200);

    const names = listing.body.files.map((f: any) => f.name);
    expect(names).not.toContain('to-delete.txt');
  });

  it('deletes a directory recursively', async () => {
    await mkdir(path.join(projectDir, 'docs', 'subdir'));
    await writeFile(path.join(projectDir, 'docs', 'subdir', 'inner.txt'), 'x');

    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/files?path=docs/subdir`)
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('rejects deleting project root', async () => {
    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/files?path=`);

    expect(res.status).toBe(400);
  });

  it('rejects path traversal', async () => {
    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/files?path=../../etc/passwd`);

    expect([400, 403]).toContain(res.status);
  });
});

// ── 8. GET /files/download — download single file ──────────────────────────

describe('GET /:projectId/files/download', () => {
  it('downloads a file with correct headers', async () => {
    await writeFile(path.join(projectDir, 'docs', 'report.txt'), 'report content');

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files/download?path=docs/report.txt`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/octet-stream/);
    expect(res.headers['content-disposition']).toContain('report.txt');
    expect(Buffer.isBuffer(res.body) ? res.body.toString() : res.text).toBe('report content');
  });

  it('rejects downloading a directory', async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files/download?path=docs`);

    expect(res.status).toBe(400);
  });

  it('rejects path traversal', async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files/download?path=../../etc/passwd`);

    expect([400, 403]).toContain(res.status);
  });
});

// ── 9. GET /files/zip — download all as tar.gz ─────────────────────────────

describe('GET /:projectId/files/zip', () => {
  it('returns a tar.gz archive', async () => {
    await writeFile(path.join(projectDir, 'test.txt'), 'archive me');

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files/zip`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/gzip/);
    expect(res.headers['content-disposition']).toMatch(/\.tar\.gz/);
    // Verify non-empty binary response
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('returns 404 for non-existent project', async () => {
    const res = await request(app)
      .get('/api/projects/nonexistent/files/zip');

    expect(res.status).toBe(404);
  });

  it('exports a subdirectory as tar.gz when path is provided', async () => {
    const subDir = path.join(projectDir, 'my-task');
    await mkdir(subDir, { recursive: true });
    await writeFile(path.join(subDir, 'task.notebook.json'), '{"cells":[]}');
    await writeFile(path.join(subDir, 'notes.md'), 'hello');

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files/zip?path=my-task`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/gzip/);
    expect(res.headers['content-disposition']).toMatch(/my-task\.tar\.gz/);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('rejects path traversal in zip path param', async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/files/zip?path=../../etc`);

    expect([400, 403]).toContain(res.status);
  });
});

// ── 10. POST /import — import project from tar.gz ──────────────────────────

describe('POST /import — import project from tar.gz', () => {
  let archivePath: string;

  beforeEach(async () => {
    // Create a fake project directory to export, then tar.gz it
    const srcDir = path.join(tmpDir, 'export-src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(path.join(srcDir, '.status.json'), JSON.stringify({
      id: 'old-id', title: 'Exported Project', status: 'active',
    }));
    await writeFile(path.join(srcDir, 'readme.md'), 'hello from export');
    await mkdir(path.join(srcDir, 'docs'));
    await writeFile(path.join(srcDir, 'docs', 'task.md'), 'task content');

    // Create tar.gz
    archivePath = path.join(tmpDir, 'project.tar.gz');
    execSync(`tar czf "${archivePath}" -C "${srcDir}" .`);
  });

  it('imports a tar.gz and returns new project info', async () => {
    const created: any[] = [];
    const db = {
      ...createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test Project' }),
      createProject: (p: any) => { created.push(p); return p; },
      createNotebook: () => {},
    };
    const router = createProjectsRouter(db, mockSessionManager, mockNotebookStore, tmpDir);
    const importApp = express();
    importApp.use(express.json());
    importApp.use('/api/projects', router);

    const res = await request(importApp)
      .post('/api/projects/import')
      .attach('archive', archivePath);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('title', 'Exported Project');
    expect(res.body).toHaveProperty('slug');
    expect(created.length).toBe(1);
  });

  it('falls back to filename when .status.json has no title', async () => {
    // Create archive without title in .status.json
    const srcDir2 = path.join(tmpDir, 'export-src2');
    await mkdir(srcDir2, { recursive: true });
    await writeFile(path.join(srcDir2, '.status.json'), JSON.stringify({ id: 'x' }));
    const archivePath2 = path.join(tmpDir, 'my-cool-project.tar.gz');
    execSync(`tar czf "${archivePath2}" -C "${srcDir2}" .`);

    const created: any[] = [];
    const db = {
      ...createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test Project' }),
      createProject: (p: any) => { created.push(p); return p; },
    };
    const router = createProjectsRouter(db, mockSessionManager, mockNotebookStore, tmpDir);
    const importApp = express();
    importApp.use(express.json());
    importApp.use('/api/projects', router);

    const res = await request(importApp)
      .post('/api/projects/import')
      .attach('archive', archivePath2);

    expect(res.status).toBe(200);
    // Title should be derived from filename
    expect(res.body.title).toBe('my-cool-project');
  });

  it('rejects request with no file', async () => {
    const res = await request(app)
      .post('/api/projects/import');

    expect(res.status).toBe(400);
  });

  it('copies files from archive to new project directory', async () => {
    let createdPath = '';
    const db = {
      ...createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test Project' }),
      createProject: (p: any) => { createdPath = p.path; return p; },
      createNotebook: () => {},
    };
    const router = createProjectsRouter(db, mockSessionManager, mockNotebookStore, tmpDir);
    const importApp = express();
    importApp.use(express.json());
    importApp.use('/api/projects', router);

    await request(importApp)
      .post('/api/projects/import')
      .attach('archive', archivePath)
      .expect(200);

    // Verify extracted files exist in the new project directory
    const readme = await readFile(path.join(createdPath, 'readme.md'), 'utf-8');
    expect(readme).toBe('hello from export');

    const task = await readFile(path.join(createdPath, 'docs', 'task.md'), 'utf-8');
    expect(task).toBe('task content');
  });
});

// ── 11. DELETE /:projectId/notebooks/by-path — delete notebook by file path ──

describe('DELETE /:projectId/notebooks/by-path', () => {
  it('deletes a notebook by its relative file path', async () => {
    // Register a notebook in the mock DB
    const nbPath = path.join(projectDir, 'my-task', 'my-task.notebook.json');
    await mkdir(path.join(projectDir, 'my-task'), { recursive: true });
    await writeFile(nbPath, '{}');

    const db = createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test Project' });
    db.createNotebook({
      id: 'nb-1', user_id: null, title: 'My Task', slug: 'my-task',
      workspace_dir: projectDir, notebook_path: nbPath,
      project_id: PROJECT_ID, status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const mockSM = { closeSession: async () => {} } as any;
    const router = createProjectsRouter(db, mockSM, mockNotebookStore, tmpDir);
    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/projects', router);

    const res = await request(testApp)
      .delete(`/api/projects/${PROJECT_ID}/notebooks/by-path?path=${encodeURIComponent('my-task/my-task.notebook.json')}`)
      .expect(204);

    // Verify notebook removed from DB
    expect(db._notebooks.length).toBe(0);
  });

  it('resolves directory path to notebook file path (e.g. "my-task" → "my-task/my-task.notebook.json")', async () => {
    // This is how the frontend actually calls: path=my-task (directory name only)
    const nbPath = path.join(projectDir, 'my-task', 'my-task.notebook.json');
    await mkdir(path.join(projectDir, 'my-task'), { recursive: true });
    await writeFile(nbPath, '{}');

    const db = createMockDb({ id: PROJECT_ID, path: projectDir, title: 'Test Project' });
    db.createNotebook({
      id: 'nb-2', user_id: null, title: 'My Task', slug: 'my-task',
      workspace_dir: projectDir, notebook_path: nbPath,
      project_id: PROJECT_ID, status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const mockSM = { closeSession: async () => {} } as any;
    const router = createProjectsRouter(db, mockSM, mockNotebookStore, tmpDir);
    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/projects', router);

    // Frontend sends just the directory name, not the full .notebook.json path
    const res = await request(testApp)
      .delete(`/api/projects/${PROJECT_ID}/notebooks/by-path?path=${encodeURIComponent('my-task')}`)
      .expect(204);

    expect(db._notebooks.length).toBe(0);
  });

  it('deletes notebook directory from disk even when not registered in DB', async () => {
    // Notebook dir exists on disk but has no DB record (e.g. created outside the API)
    const nbDir = path.join(projectDir, 'orphan-task');
    await mkdir(nbDir, { recursive: true });
    await writeFile(path.join(nbDir, 'orphan-task.notebook.json'), '{}');
    await writeFile(path.join(nbDir, 'notes.md'), 'hello');

    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/notebooks/by-path?path=${encodeURIComponent('orphan-task')}`)
      .expect(204);

    // Verify directory removed from disk
    const { existsSync } = await import('fs');
    expect(existsSync(nbDir)).toBe(false);
  });

  it('returns 404 when path does not exist on disk or in DB', async () => {
    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/notebooks/by-path?path=${encodeURIComponent('nonexistent')}`)
      .expect(404);
  });

  it('returns 400 when no path provided', async () => {
    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/notebooks/by-path`);

    expect(res.status).toBe(400);
  });
});
