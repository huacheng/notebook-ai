import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import os from 'os';
import { initWorkspaceMemory, MEMORY_FILENAME } from '../workspace.js';

describe('initWorkspaceMemory skipMemoryWrite', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'ws-mem-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('writes .MEMORY.md by default', async () => {
    await initWorkspaceMemory(tmp);
    const content = await readFile(path.join(tmp, MEMORY_FILENAME), 'utf-8');
    expect(content).toContain('# MEMORY');
  });

  it('skips .MEMORY.md when skipMemoryWrite=true but still creates settings.json', async () => {
    const preExisting = 'user-custom content';
    await writeFile(path.join(tmp, MEMORY_FILENAME), preExisting, 'utf-8');
    await initWorkspaceMemory(tmp, undefined, { skipMemoryWrite: true });

    const after = await readFile(path.join(tmp, MEMORY_FILENAME), 'utf-8');
    expect(after).toBe(preExisting);

    await expect(
      access(path.join(tmp, '.claude', 'settings.json'), constants.F_OK)
    ).resolves.toBeUndefined();
  });

  it('still honors skipClaudeSettings independently', async () => {
    await initWorkspaceMemory(tmp, undefined, { skipMemoryWrite: true, skipClaudeSettings: true });
    await expect(
      access(path.join(tmp, '.claude', 'settings.json'), constants.F_OK)
    ).rejects.toThrow();
  });
});
