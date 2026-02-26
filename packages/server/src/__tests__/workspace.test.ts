import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';

let tmpRoot: string;
let workspaceDir: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'workspace-test-'));
  workspaceDir = path.join(tmpRoot, 'my-notebook');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(tmpRoot, '.library'), { recursive: true });
  process.env['NB_WORKSPACE_DIR'] = tmpRoot;
});

afterEach(async () => {
  delete process.env['NB_WORKSPACE_DIR'];
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('initWorkspaceMemory', () => {
  it('creates MEMORY.md in the workspace directory', async () => {
    const { initWorkspaceMemory } = await import('../workspace.js');
    await initWorkspaceMemory(workspaceDir);

    const content = await readFile(path.join(workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('# MEMORY');
  });

  it('writes a relative path from workspace to the library', async () => {
    const { initWorkspaceMemory } = await import('../workspace.js');
    await initWorkspaceMemory(workspaceDir);

    const expectedRel = path.relative(workspaceDir, path.join(tmpRoot, '.library'));
    const content = await readFile(path.join(workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain(expectedRel);
  });

  it('content mentions read and write access', async () => {
    const { initWorkspaceMemory } = await import('../workspace.js');
    await initWorkspaceMemory(workspaceDir);

    const content = await readFile(path.join(workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(content).toMatch(/read.*write|write.*read/i);
  });

  it('overwrites an existing MEMORY.md without throwing', async () => {
    const { initWorkspaceMemory } = await import('../workspace.js');
    await initWorkspaceMemory(workspaceDir);
    await initWorkspaceMemory(workspaceDir); // second call must not throw
    const content = await readFile(path.join(workspaceDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('# MEMORY');
  });

  it('creates workspaceDir if it does not exist', async () => {
    const { initWorkspaceMemory } = await import('../workspace.js');
    const nonExistentDir = path.join(tmpRoot, 'does-not-exist');
    await initWorkspaceMemory(nonExistentDir);
    const content = await readFile(path.join(nonExistentDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('# MEMORY');
  });
});
