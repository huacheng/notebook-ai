/**
 * GitWatcher branch detection tests.
 *
 * Tests that GitWatcher triggers callback when:
 * 1. A new branch is created (without changing HEAD)
 * 2. A branch is deleted
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import { GitWatcher } from '../watcher.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'git-watcher-branch-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function setupRepo() {
  const repoDir = path.join(tmpRoot, 'project');
  await mkdir(repoDir, { recursive: true });

  const git = simpleGit(repoDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');

  // Initial commit
  await writeFile(path.join(repoDir, 'readme.txt'), 'initial', 'utf-8');
  await git.add('-A');
  await git.commit('init');

  return { repoDir, git };
}

describe('GitWatcher branch detection', () => {
  it('triggers callback when a new branch is created', async () => {
    const { repoDir, git } = await setupRepo();
    const watcher = new GitWatcher(100); // 100ms poll interval for faster test
    const callback = vi.fn();

    const unsub = watcher.subscribe(repoDir, 'proj-1', callback);

    // Wait for initial poll to establish baseline
    await new Promise((r) => setTimeout(r, 150));
    expect(callback).not.toHaveBeenCalled();

    // Create a new branch (without switching to it)
    await git.branch(['feature/test']);

    // Wait for next poll + debounce
    await new Promise((r) => setTimeout(r, 400));

    expect(callback).toHaveBeenCalled();
    expect(callback.mock.calls[0][0]).toBe('proj-1');

    unsub();
    watcher.destroy();
  });

  it('triggers callback when a branch is deleted', async () => {
    const { repoDir, git } = await setupRepo();

    // Create a branch first
    await git.branch(['to-delete']);

    const watcher = new GitWatcher(100);
    const callback = vi.fn();

    const unsub = watcher.subscribe(repoDir, 'proj-1', callback);

    // Wait for initial poll
    await new Promise((r) => setTimeout(r, 150));
    expect(callback).not.toHaveBeenCalled();

    // Delete the branch
    await git.branch(['-D', 'to-delete']);

    // Wait for next poll + debounce
    await new Promise((r) => setTimeout(r, 400));

    expect(callback).toHaveBeenCalled();

    unsub();
    watcher.destroy();
  });

  it('does NOT trigger callback when nothing changes', async () => {
    const { repoDir } = await setupRepo();
    const watcher = new GitWatcher(100);
    const callback = vi.fn();

    const unsub = watcher.subscribe(repoDir, 'proj-1', callback);

    // Wait for several poll cycles
    await new Promise((r) => setTimeout(r, 500));

    // Should not have been called (no changes)
    expect(callback).not.toHaveBeenCalled();

    unsub();
    watcher.destroy();
  });
});
