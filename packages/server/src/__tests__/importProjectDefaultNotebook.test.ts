/**
 * Integration tests: POST /projects/import
 *
 * 1. Injects default notebook when archive has no root-level notebook.json
 * 2. Uses existing root notebook.json as default without duplicating
 * 3. Preserves user-authored .MEMORY.md when importing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { NotebookDb } from '../db.js';
import { createProjectsRouter } from '../routes/projects.js';
import { NotebookStore } from '../notebook-store.js';

const execFileAsync = promisify(execFile);

let tmpDir: string;
let srcDir: string;
let app: ReturnType<typeof express>;
let db: NotebookDb;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nb-test-import-default-'));
  srcDir = path.join(tmpDir, 'src');
  await mkdir(srcDir, { recursive: true });

  db = new NotebookDb(path.join(tmpDir, 'test.db'));
  const notebookStore = new NotebookStore();
  const sessionManager = {} as any;
  const workspacesRoot = path.join(tmpDir, 'workspaces');
  await mkdir(workspacesRoot, { recursive: true });
  const router = createProjectsRouter(db, sessionManager, notebookStore, workspacesRoot);
  app = express();
  app.use(express.json());
  app.use('/api/projects', router);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

/** Helper: create a tar.gz from srcDir contents */
async function makeTar(srcDir: string, tarName: string): Promise<string> {
  const tarPath = path.join(tmpDir, tarName);
  await execFileAsync('tar', ['czf', tarPath, '-C', srcDir, '.']);
  return tarPath;
}

describe('POST /api/projects/import — default notebook injection', () => {
  it('injects default notebook when archive has no root-level notebook.json', async () => {
    // Source has only a README.md
    await writeFile(path.join(srcDir, 'README.md'), '# Hello', 'utf-8');
    const tarPath = await makeTar(srcDir, 'myproject.tar.gz');

    const res = await request(app)
      .post('/api/projects/import')
      .attach('archive', tarPath)
      .expect(200);

    const projectId: string = res.body.id;

    const nbRes = await request(app)
      .get(`/api/projects/${projectId}/notebooks`)
      .expect(200);

    const notebooks: any[] = nbRes.body.notebooks;
    expect(notebooks).toHaveLength(1);
    expect(notebooks[0].is_default).toBe(true);
  });

  it('uses existing root notebook.json as default without duplicating', async () => {
    // Source has a root-level notebook.json with valid content
    const notebookContent = JSON.stringify({
      version: 1,
      metadata: { title: 'existing', worktree_path: undefined },
      cells: [],
    });
    await writeFile(path.join(srcDir, 'existing.notebook.json'), notebookContent, 'utf-8');
    const tarPath = await makeTar(srcDir, 'existing.tar.gz');

    const res = await request(app)
      .post('/api/projects/import')
      .attach('archive', tarPath)
      .expect(200);

    const projectId: string = res.body.id;

    const nbRes = await request(app)
      .get(`/api/projects/${projectId}/notebooks`)
      .expect(200);

    const notebooks: any[] = nbRes.body.notebooks;
    // Exactly 1 notebook, and it is default
    expect(notebooks).toHaveLength(1);
    expect(notebooks[0].is_default).toBe(true);
    expect(notebooks[0].name).toBe('existing');
  });

  it('preserves user-authored .MEMORY.md when importing', async () => {
    const customMemory = '# My Custom Memory\n\nDo not overwrite me!';
    await writeFile(path.join(srcDir, '.MEMORY.md'), customMemory, 'utf-8');
    await writeFile(path.join(srcDir, 'README.md'), '# Project', 'utf-8');
    const tarPath = await makeTar(srcDir, 'withMemory.tar.gz');

    const res = await request(app)
      .post('/api/projects/import')
      .attach('archive', tarPath)
      .expect(200);

    const projectPath: string = res.body.path;
    const memoryContent = await readFile(path.join(projectPath, '.MEMORY.md'), 'utf-8');
    expect(memoryContent).toBe(customMemory);
  });
});
