import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { NotebookDb } from '../db.js';
import { NotebookStore } from '../notebook-store.js';
import { createProjectsRouter } from '../routes/projects.js';

describe('default notebook session cwd', () => {
  let tmp: string;
  let app: express.Express;
  let db: NotebookDb;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'def-sess-'));
    db = new NotebookDb(path.join(tmp, 'test.db'));
    const router = createProjectsRouter(db, {} as never, new NotebookStore(), tmp);
    app = express();
    app.use(express.json());
    app.use('/api/projects', router);
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('default notebook DB row uses project path as workspace_dir (no fallback ambiguity)', async () => {
    const p = await request(app).post('/api/projects').send({ title: 'S' }).expect(200);
    const rows = db.listProjectNotebooks(p.body.id);
    expect(rows.length).toBe(1);
    expect(rows[0]!.workspace_dir).toBe(p.body.path);
  });
});
