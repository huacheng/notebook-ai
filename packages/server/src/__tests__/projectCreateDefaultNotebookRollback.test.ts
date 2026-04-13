/**
 * POST /projects — rollback when default notebook creation fails AFTER db.createProject.
 *
 * Regression: prior to the default-notebook-on-main refactor, project creation only
 * wrote to DB once. The refactor inserts a second step (createDefaultNotebook +
 * db.createNotebook) after the project row exists. If that step throws, the catch
 * block must also roll back the project row — otherwise the DB contains an orphan
 * pointing to a deleted directory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { NotebookDb } from '../db.js';
import { NotebookStore } from '../notebook-store.js';
import { createProjectsRouter } from '../routes/projects.js';

describe('POST /projects rollback when default notebook creation fails', () => {
  let tmp: string;
  let app: express.Express;
  let db: NotebookDb;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'proj-rb-def-'));
    db = new NotebookDb(path.join(tmp, 'test.db'));
    const router = createProjectsRouter(db, {} as never, new NotebookStore(), tmp);
    app = express();
    app.use(express.json());
    app.use('/api/projects', router);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('removes project DB row when createDefaultNotebook throws after db.createProject', async () => {
    // Force createDefaultNotebook to fail by making initTaskWorkingDir throw
    const taskInit = await import('../task-init.js');
    vi.spyOn(taskInit, 'initTaskWorkingDir').mockRejectedValueOnce(
      new Error('simulated init failure')
    );

    const res = await request(app).post('/api/projects').send({ title: 'Rollback' });
    expect(res.status).toBe(500);

    const projects = db.listProjects();
    expect(projects.length).toBe(0);
  });
});
