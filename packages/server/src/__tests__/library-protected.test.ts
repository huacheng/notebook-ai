/**
 * Library system file protection — TDD tests
 *
 * System-predefined files/directories under .library/ must not be deletable via API.
 * Protected: dot-prefixed entries at root, MEMORY.md, everything under .memory/.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { createLibraryRouter } from '../routes/library.js';

let tmpDir: string;
let app: ReturnType<typeof express>;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nb-test-library-'));
  // Point library to our temp dir
  process.env['NB_WORKSPACE_DIR'] = tmpDir;

  // Create .library structure
  const libDir = path.join(tmpDir, '.library');
  await mkdir(path.join(libDir, '.memory', '.references'), { recursive: true });
  await mkdir(path.join(libDir, '.memory', '.experiences'), { recursive: true });
  await mkdir(path.join(libDir, 'user-docs'), { recursive: true });
  await writeFile(path.join(libDir, 'MEMORY.md'), '# Memory');
  await writeFile(path.join(libDir, '.master-index.md'), '# Index');
  await writeFile(path.join(libDir, '.changelog'), 'log');
  await writeFile(path.join(libDir, '.memory', '.references', 'ref.md'), 'ref');
  await writeFile(path.join(libDir, 'user-docs', 'notes.md'), 'notes');

  const router = createLibraryRouter();
  app = express();
  app.use(express.json());
  app.use('/api/library', router);
});

afterEach(async () => {
  delete process.env['NB_WORKSPACE_DIR'];
  await rm(tmpDir, { recursive: true, force: true });
});

describe('DELETE /api/library/files — system file protection', () => {
  it('rejects deleting MEMORY.md', async () => {
    const res = await request(app)
      .delete('/api/library/files?path=MEMORY.md');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/system/i);
  });

  it('rejects deleting dot-prefixed file at root (.master-index.md)', async () => {
    const res = await request(app)
      .delete('/api/library/files?path=.master-index.md');
    expect(res.status).toBe(403);
  });

  it('rejects deleting dot-prefixed file at root (.changelog)', async () => {
    const res = await request(app)
      .delete('/api/library/files?path=.changelog');
    expect(res.status).toBe(403);
  });

  it('rejects deleting .memory directory', async () => {
    const res = await request(app)
      .delete('/api/library/files?path=.memory');
    expect(res.status).toBe(403);
  });

  it('rejects deleting files inside .memory/', async () => {
    const res = await request(app)
      .delete('/api/library/files?path=.memory/.references/ref.md');
    expect(res.status).toBe(403);
  });

  it('rejects deleting subdirectory inside .memory/', async () => {
    const res = await request(app)
      .delete('/api/library/files?path=.memory/.references');
    expect(res.status).toBe(403);
  });

  it('allows deleting user-created files', async () => {
    const res = await request(app)
      .delete('/api/library/files?path=user-docs/notes.md');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows deleting user-created directories', async () => {
    const res = await request(app)
      .delete('/api/library/files?path=user-docs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
