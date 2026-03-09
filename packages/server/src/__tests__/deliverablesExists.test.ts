/**
 * Tests for deliverables directory existence optimization.
 *
 * Tests:
 * 1. listWorkspaceFiles returns exists: true for existing directories
 * 2. listWorkspaceFiles returns exists: false for non-existent directories
 * 3. computeProjectFileList propagates exists field
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = path.join(os.tmpdir(), `nb-deliv-exists-${Date.now()}`);

beforeAll(() => {
  mkdirSync(path.join(tmpDir, 'subdir'), { recursive: true });
  writeFileSync(path.join(tmpDir, 'subdir', 'file.txt'), 'hello');
  writeFileSync(path.join(tmpDir, 'readme.txt'), 'root');
  // Note: NO .deliverables directory created
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('listWorkspaceFiles exists field', () => {
  it('returns exists: true for existing directory', async () => {
    const { listWorkspaceFiles } = await import('../workspace-files.js');
    const result = await listWorkspaceFiles(tmpDir, 'subdir');
    expect(result.exists).toBe(true);
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('returns exists: false for non-existent directory', async () => {
    const { listWorkspaceFiles } = await import('../workspace-files.js');
    const result = await listWorkspaceFiles(tmpDir, '.deliverables');
    expect(result.exists).toBe(false);
    expect(result.files).toEqual([]);
  });

  it('returns exists: true for root directory', async () => {
    const { listWorkspaceFiles } = await import('../workspace-files.js');
    const result = await listWorkspaceFiles(tmpDir, '.');
    expect(result.exists).toBe(true);
  });

  it('still throws for path traversal on non-existent path', async () => {
    const { listWorkspaceFiles } = await import('../workspace-files.js');
    await expect(listWorkspaceFiles(tmpDir, '../../etc'))
      .rejects.toThrow('Path outside workspace');
  });
});

describe('computeProjectFileList propagates exists', () => {
  it('returns exists: false for non-existent .deliverables', async () => {
    const { computeProjectFileList } = await import('../project-file-list.js');
    const result = await computeProjectFileList(tmpDir, '.deliverables');
    expect(result.exists).toBe(false);
    expect(result.files).toEqual([]);
  });

  it('returns exists: true for existing subdir', async () => {
    const { computeProjectFileList } = await import('../project-file-list.js');
    const result = await computeProjectFileList(tmpDir, 'subdir');
    expect(result.exists).toBe(true);
  });
});
