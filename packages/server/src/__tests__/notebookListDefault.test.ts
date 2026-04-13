/**
 * Task 6: List endpoint — is_default field + stray file filter
 *
 * Tests that GET /:projectId/notebooks correctly:
 *  1. Puts the default (root-level) notebook first with is_default=true
 *  2. Ignores .notebook.json.bak files and directories named *.notebook.json
 *  3. Picks the slug-ascending-first notebook when multiple root-level files exist
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { NotebookDb } from '../db.js';
import { createProjectsRouter } from '../routes/projects.js';
import { NotebookStore } from '../notebook-store.js';

let tmpDir: string;
let app: ReturnType<typeof express>;
let db: NotebookDb;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nb-test-list-default-'));
  db = new NotebookDb(path.join(tmpDir, 'test.db'));
  const notebookStore = new NotebookStore();
  const sessionManager = {} as any;
  const router = createProjectsRouter(db, sessionManager, notebookStore, tmpDir);
  app = express();
  app.use(express.json());
  app.use('/api/projects', router);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('GET /:projectId/notebooks — is_default field', () => {
  it('puts default notebook first with is_default=true', async () => {
    // Create a project (auto-creates a default notebook)
    const createRes = await request(app)
      .post('/api/projects')
      .send({ title: 'Test Project' })
      .expect(200);

    const projectId: string = createRes.body.id;

    // GET notebooks — default notebook should be first with is_default=true
    const nbRes = await request(app)
      .get(`/api/projects/${projectId}/notebooks`)
      .expect(200);

    const notebooks: any[] = nbRes.body.notebooks;
    expect(notebooks.length).toBeGreaterThanOrEqual(1);
    expect(notebooks[0].is_default).toBe(true);
  });
});

describe('GET /:projectId/notebooks — stray file filter', () => {
  it('ignores .notebook.json.bak files and directories named *.notebook.json', async () => {
    // Create a project
    const createRes = await request(app)
      .post('/api/projects')
      .send({ title: 'Stray Filter Project' })
      .expect(200);

    const projectId: string = createRes.body.id;
    const projectPath: string = createRes.body.path;

    // Drop a stray .bak file at project root
    await writeFile(
      path.join(projectPath, 'stray.notebook.json.bak'),
      '{"stray": true}',
    );

    // Create a directory named dir.notebook.json at project root
    await mkdir(path.join(projectPath, 'dir.notebook.json'));

    // GET notebooks — stray files should not appear
    const nbRes = await request(app)
      .get(`/api/projects/${projectId}/notebooks`)
      .expect(200);

    const notebooks: any[] = nbRes.body.notebooks;

    // No notebook should have .bak in its name
    for (const nb of notebooks) {
      expect(nb.name).not.toContain('.bak');
    }

    // No notebook should be named 'dir' (from the directory 'dir.notebook.json')
    // (the directory check ensures it's filtered via isFile())
    const names = notebooks.map((nb: any) => nb.name);
    expect(names).not.toContain('dir');
  });
});

describe('GET /:projectId/notebooks — slug-ascending ordering', () => {
  it('picks slug-ascending first when multiple root-level notebook.json exist', async () => {
    // Create a project (auto-creates nb-<hex>.notebook.json)
    const createRes = await request(app)
      .post('/api/projects')
      .send({ title: 'Multi Notebook Project' })
      .expect(200);

    const projectId: string = createRes.body.id;
    const projectPath: string = createRes.body.path;

    // Drop a second valid notebook at root with a slug that sorts before any nb-<hex>
    const aaNotebookContent = JSON.stringify({
      version: 1,
      metadata: {
        title: 'AA',
        created: new Date().toISOString(),
        git_repo: false,
        agent: 'claude',
      },
      cells: [],
      slide: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    });
    await writeFile(path.join(projectPath, 'aa.notebook.json'), aaNotebookContent);

    // GET notebooks — 'aa' should be first (sorts before 'nb-...')
    const nbRes = await request(app)
      .get(`/api/projects/${projectId}/notebooks`)
      .expect(200);

    const notebooks: any[] = nbRes.body.notebooks;

    // First notebook should be 'aa'
    expect(notebooks[0].name).toBe('aa');

    // Exactly 1 entry should have is_default=true
    const defaultNotebooks = notebooks.filter((nb: any) => nb.is_default === true);
    expect(defaultNotebooks).toHaveLength(1);
  });
});
