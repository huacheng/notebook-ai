/**
 * Integration tests: DELETE /projects/:projectId/notebooks/by-path
 * — when the target is the default notebook, it resets (not removes).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { NotebookDb } from '../db.js';
import { createProjectsRouter } from '../routes/projects.js';
import { NotebookStore } from '../notebook-store.js';

let tmpDir: string;
let app: ReturnType<typeof express>;
let db: NotebookDb;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nb-test-default-reset-'));
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

/** Helper: create a project and return { projectId, projectPath, nbPath, relPath } */
async function createProjectAndGetDefaultNb(title: string) {
  const createRes = await request(app)
    .post('/api/projects')
    .send({ title })
    .expect(200);

  const projectId: string = createRes.body.id;
  const projectPath: string = createRes.body.path;

  const nbRes = await request(app)
    .get(`/api/projects/${projectId}/notebooks`)
    .expect(200);

  const nb = nbRes.body.notebooks[0];
  const nbPath: string = nb.path;
  const relPath = path.relative(projectPath, nbPath);

  return { projectId, projectPath, nbPath, relPath };
}

describe('DELETE default notebook — reset behaviour', () => {
  it('overwrites file with empty cells but preserves title and created', async () => {
    const { projectId, nbPath, relPath } = await createProjectAndGetDefaultNb('Reset');

    // Read original notebook and capture created timestamp
    const originalContent = await readFile(nbPath, 'utf-8');
    const original = JSON.parse(originalContent);
    const originalCreated: string = original.metadata.created;

    // Mutate the file — add a valid cell
    original.cells = [{ id: 'c1', type: 'markdown', source: 'hi' }];
    await writeFile(nbPath, JSON.stringify(original, null, 2) + '\n', 'utf-8');

    // DELETE via by-path
    await request(app)
      .delete(`/api/projects/${projectId}/notebooks/by-path?path=${encodeURIComponent(relPath)}`)
      .expect(204);

    // Re-read and verify
    const afterContent = await readFile(nbPath, 'utf-8');
    const after = JSON.parse(afterContent);

    // v2 format: no cells array on disk; cell_ids is the canonical list
    expect(after.cell_ids).toEqual([]);
    expect(after.metadata.title).toBe('Reset');
    expect(after.metadata.created).toBe(originalCreated);
  });

  it('does not remove .working or .deliverables', async () => {
    const { projectId, projectPath, relPath } = await createProjectAndGetDefaultNb('KeepDirs');

    await request(app)
      .delete(`/api/projects/${projectId}/notebooks/by-path?path=${encodeURIComponent(relPath)}`)
      .expect(204);

    expect(existsSync(path.join(projectPath, '.working'))).toBe(true);
    expect(existsSync(path.join(projectPath, '.deliverables'))).toBe(true);
  });

  it('keeps DB record with cell_count === 0 after reset', async () => {
    const { projectId, nbPath, relPath } = await createProjectAndGetDefaultNb('KeepRow');

    await request(app)
      .delete(`/api/projects/${projectId}/notebooks/by-path?path=${encodeURIComponent(relPath)}`)
      .expect(204);

    const row = db.getNotebookByPath(nbPath);
    expect(row).toBeDefined();
    expect(row!.cell_count).toBe(0);
  });
});
