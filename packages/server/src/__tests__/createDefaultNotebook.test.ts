import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access, writeFile } from 'fs/promises';
import { constants, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { GitManager } from '../git.js';
import { createDefaultNotebook } from '../default-notebook.js';

describe('createDefaultNotebook', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'create-def-nb-'));
    const git = new GitManager(tmp);
    await git.ensureRepo();
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('creates notebook file at project root with given title', async () => {
    const result = await createDefaultNotebook({ projectPath: tmp, title: 'My Project' });

    expect(result.notebookPath).toMatch(/\/nb-[a-f0-9]{8}\.notebook\.json$/);
    expect(path.dirname(result.notebookPath)).toBe(tmp);

    const raw = await readFile(result.notebookPath, 'utf-8');
    const nb = JSON.parse(raw);
    expect(nb.metadata.title).toBe('My Project');
    expect(nb.metadata.worktree_path).toBeUndefined();
    // v2 format: no cells array on disk; cell_ids is the canonical list
    expect(nb.cell_ids).toEqual([]);
  });

  it('initializes .working, .deliverables and .MEMORY.md + .claude/settings.json', async () => {
    await createDefaultNotebook({ projectPath: tmp, title: 'P' });

    expect(existsSync(path.join(tmp, '.working'))).toBe(true);
    expect(existsSync(path.join(tmp, '.deliverables'))).toBe(true);
    await expect(access(path.join(tmp, '.MEMORY.md'), constants.F_OK)).resolves.toBeUndefined();
    await expect(access(path.join(tmp, '.claude', 'settings.json'), constants.F_OK)).resolves.toBeUndefined();
  });

  it('does not overwrite pre-existing .MEMORY.md (skipMemoryWrite)', async () => {
    await writeFile(path.join(tmp, '.MEMORY.md'), 'user-custom', 'utf-8');
    await createDefaultNotebook({ projectPath: tmp, title: 'P', skipMemoryWrite: true });
    const content = await readFile(path.join(tmp, '.MEMORY.md'), 'utf-8');
    expect(content).toBe('user-custom');
    await expect(access(path.join(tmp, '.claude', 'settings.json'), constants.F_OK)).resolves.toBeUndefined();
  });

  it('retries slug on collision', async () => {
    const a = await createDefaultNotebook({ projectPath: tmp, title: 'A' });
    await rm(a.notebookPath);
    const b = await createDefaultNotebook({ projectPath: tmp, title: 'B' });
    expect(b.notebookPath).not.toBe(a.notebookPath);
  });
});
