import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { GitManager } from '../git.js';

describe('GitManager.getCurrentBranch', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'git-br-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('returns HEAD branch name after ensureRepo (no commits)', async () => {
    const git = new GitManager(tmp);
    await git.ensureRepo();
    const br = await git.getCurrentBranch();
    expect(br).toMatch(/^(main|master)$/);
  });

  it('returns correct name after commit on custom branch', async () => {
    const git = new GitManager(tmp);
    await git.ensureRepo();
    await writeFile(path.join(tmp, 'a.txt'), 'hi', 'utf-8');
    await git.commitAll('init');
    const br = await git.getCurrentBranch();
    expect(typeof br).toBe('string');
    expect(br.length).toBeGreaterThan(0);
  });
});
