import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

describe('computeFileCacheKey', () => {
  it('library → library cache key', async () => {
    const { computeFileCacheKey } = await import('../project-file-list.js');
    expect(computeFileCacheKey({ dirPath: '__library__' }))
      .toBe('nb-filelist-/api/library-.');
  });

  it('project root → project cache key', async () => {
    const { computeFileCacheKey } = await import('../project-file-list.js');
    expect(computeFileCacheKey({ projectId: 'abc' }))
      .toBe('nb-filelist-/api/projects/abc-.');
  });

  it('project subdir → project+path key', async () => {
    const { computeFileCacheKey } = await import('../project-file-list.js');
    expect(computeFileCacheKey({ projectId: 'abc', dirPath: '.deliverables' }))
      .toBe('nb-filelist-/api/projects/abc-.deliverables');
  });

  it('no valid context → null', async () => {
    const { computeFileCacheKey } = await import('../project-file-list.js');
    expect(computeFileCacheKey({})).toBeNull();
  });
});

describe('computeProjectFileList', () => {
  const tmpDir = path.join(os.tmpdir(), `nb-pfl-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    mkdirSync(path.join(tmpDir, '.deliverables'), { recursive: true });
    mkdirSync(path.join(tmpDir, '.working'), { recursive: true });
    mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    writeFileSync(path.join(tmpDir, '.target.md'), 'target');
    writeFileSync(path.join(tmpDir, '.lock'), 'lock');
    writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello');
    mkdirSync(path.join(tmpDir, 'subdir'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'subdir', '.plan.md'), 'plan');
    mkdirSync(path.join(tmpDir, 'mynotebook'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'mynotebook', 'mynotebook.notebook.json'), '{}');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('filters hidden dotfiles at top level', async () => {
    const { computeProjectFileList } = await import('../project-file-list.js');
    const result = await computeProjectFileList(tmpDir, '.');
    const names = result.files.map((f: any) => f.name);
    expect(names).not.toContain('.git');
    expect(names).not.toContain('.deliverables');
    expect(names).not.toContain('.lock');
    expect(names).toContain('.working');
    expect(names).toContain('.claude');
    expect(names).toContain('.target.md');
    expect(names).toContain('readme.txt');
  });

  it('allows dotfiles at non-top level', async () => {
    const { computeProjectFileList } = await import('../project-file-list.js');
    const result = await computeProjectFileList(tmpDir, 'subdir');
    const names = result.files.map((f: any) => f.name);
    expect(names).toContain('.plan.md');
  });

  it('marks notebook directories', async () => {
    const { computeProjectFileList } = await import('../project-file-list.js');
    const result = await computeProjectFileList(tmpDir, '.');
    const nb = result.files.find((f: any) => f.name === 'mynotebook');
    expect(nb).toBeDefined();
    expect((nb as any).isNotebook).toBe(true);
  });
});
