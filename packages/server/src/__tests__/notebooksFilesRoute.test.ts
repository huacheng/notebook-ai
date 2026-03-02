/**
 * Test: GET /api/notebooks/:sessionId/files
 *
 * Lists files in the session's workspace directory.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createNotebooksRouter } from '../routes/notebooks';

describe('GET /api/notebooks/:sessionId/files', () => {
  let app: express.Express;
  let tmpDir: string;
  const TEST_SESSION_ID = 'test-session-123';

  beforeAll(async () => {
    // Create temp directory with test files
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-files-test-'));
    await fs.writeFile(path.join(tmpDir, 'file1.txt'), 'content1');
    await fs.writeFile(path.join(tmpDir, 'file2.md'), 'content2');
    await fs.mkdir(path.join(tmpDir, 'subdir'));
    await fs.writeFile(path.join(tmpDir, 'subdir', 'nested.js'), 'code');

    // Create notebook file
    await fs.writeFile(path.join(tmpDir, 'test.notebook.json'), JSON.stringify({
      version: 1,
      metadata: { title: 'Test' },
      cells: [],
    }));

    // Mock session manager that returns session with cwd
    const mockSessionManager = {
      getSession: (sessionId: string) => {
        if (sessionId === TEST_SESSION_ID) {
          return { id: TEST_SESSION_ID, cwd: tmpDir };
        }
        return undefined;
      },
    } as any;

    const mockDb = {} as any;
    const mockNotebookStore = {} as any;

    // Setup Express app
    app = express();
    app.use(express.json());
    const router = createNotebooksRouter(mockDb, mockSessionManager, mockNotebookStore);
    app.use('/api/notebooks', router);
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 404 for non-existent session', async () => {
    const res = await request(app).get('/api/notebooks/non-existent/files');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('lists files in session workspace directory', async () => {
    const res = await request(app).get(`/api/notebooks/${TEST_SESSION_ID}/files`);
    expect(res.status).toBe(200);
    expect(res.body.files).toBeDefined();
    expect(Array.isArray(res.body.files)).toBe(true);

    const names = res.body.files.map((f: { name: string }) => f.name);
    expect(names).toContain('file1.txt');
    expect(names).toContain('file2.md');
    expect(names).toContain('subdir');
  });

  it('lists files in subdirectory when path query param provided', async () => {
    const res = await request(app).get(`/api/notebooks/${TEST_SESSION_ID}/files?path=subdir`);
    expect(res.status).toBe(200);
    expect(res.body.files).toBeDefined();

    const names = res.body.files.map((f: { name: string }) => f.name);
    expect(names).toContain('nested.js');
    expect(names).not.toContain('file1.txt');
  });

  it('returns file metadata (name, path, isDir)', async () => {
    const res = await request(app).get(`/api/notebooks/${TEST_SESSION_ID}/files`);
    expect(res.status).toBe(200);

    const subdir = res.body.files.find((f: { name: string }) => f.name === 'subdir');
    expect(subdir).toBeDefined();
    expect(subdir.isDir).toBe(true);
    expect(subdir.path).toBe('subdir');

    const file1 = res.body.files.find((f: { name: string }) => f.name === 'file1.txt');
    expect(file1).toBeDefined();
    expect(file1.isDir).toBe(false);
    expect(file1.path).toBe('file1.txt');
  });
});
