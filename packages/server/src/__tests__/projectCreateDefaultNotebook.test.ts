/**
 * Integration test: POST /projects auto-creates a default notebook,
 * and GET /:projectId/notebooks exposes is_default flag.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { NotebookDb } from '../db.js';
import { createProjectsRouter } from '../routes/projects.js';
import { NotebookStore } from '../notebook-store.js';

let tmpDir: string;
let app: ReturnType<typeof express>;
let db: NotebookDb;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nb-test-default-nb-'));
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

describe('POST /api/projects — auto-creates default notebook', () => {
  it('returns 200 with {id, path} and creates exactly 1 notebook', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ title: 'Demo' })
      .expect(200);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('path');
    const projectId: string = res.body.id;
    const projectPath: string = res.body.path;

    // GET notebooks should return exactly 1
    const nbRes = await request(app)
      .get(`/api/projects/${projectId}/notebooks`)
      .expect(200);

    const notebooks: any[] = nbRes.body.notebooks;
    expect(notebooks).toHaveLength(1);

    // The notebook should be marked as default
    const nb = notebooks[0];
    expect(nb.is_default).toBe(true);

    // dirname of notebook path should equal projectPath
    expect(path.dirname(nb.path)).toBe(projectPath);
  });

  it('notebook file has metadata.title matching the project title', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ title: 'Demo' })
      .expect(200);

    const projectId: string = res.body.id;

    const nbRes = await request(app)
      .get(`/api/projects/${projectId}/notebooks`)
      .expect(200);

    const nb = nbRes.body.notebooks[0];
    // Read the notebook file and check metadata.title
    const { readFile } = await import('fs/promises');
    const content = await readFile(nb.path, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.metadata?.title).toBe('Demo');
  });
});

describe('POST /api/projects — DB registration', () => {
  it('registers the default notebook in the DB with correct notebook_path', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ title: 'Demo' })
      .expect(200);

    const projectId: string = res.body.id;
    const projectPath: string = res.body.path;

    // Query DB directly
    const dbNb = db.getNotebookByPath(
      // We don't know the slug; look up via project notebooks list
      (() => {
        // getNotebookByPath requires full path — use listNotebooks approach
        return null;
      })()!
    );

    // Instead: use the notebooks list endpoint to get the path, then verify DB record
    const nbRes = await request(app)
      .get(`/api/projects/${projectId}/notebooks`)
      .expect(200);

    const nb = nbRes.body.notebooks[0];
    const dbRecord = db.getNotebookByPath(nb.path);
    expect(dbRecord).toBeDefined();
    expect(dbRecord!.project_id).toBe(projectId);
    expect(path.dirname(dbRecord!.notebook_path)).toBe(projectPath);
  });
});

describe('POST /api/projects — directory invariants', () => {
  it('creates .working/ and .deliverables/ at project root', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ title: 'Demo' })
      .expect(200);

    const projectPath: string = res.body.path;

    const workingStat = await stat(path.join(projectPath, '.working'));
    expect(workingStat.isDirectory()).toBe(true);

    const deliverablesStat = await stat(path.join(projectPath, '.deliverables'));
    expect(deliverablesStat.isDirectory()).toBe(true);
  });
});
