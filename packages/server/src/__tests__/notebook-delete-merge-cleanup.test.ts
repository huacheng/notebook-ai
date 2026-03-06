/**
 * Tests for:
 * 1. Project creation should generate .gitignore and .MEMORY.md
 * 2. Merge-delete should only bring .deliverables/ to master, not .claude/ or .working/
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'nb-del-merge-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('project creation scaffolding', () => {
  it('creates .gitignore during project init', async () => {
    const repoDir = path.join(tmpRoot, 'new-project');
    await mkdir(path.join(repoDir, '.deliverables'), { recursive: true });

    // Simulate what project creation should do
    const { ensureLibrarySkeleton } = await import('../task-init.js');
    const workspacesRoot = tmpRoot;
    await ensureLibrarySkeleton(workspacesRoot, repoDir);

    expect(existsSync(path.join(repoDir, '.gitignore'))).toBe(true);
  });

  it('does NOT create .MEMORY.md or .claude/ at project level', async () => {
    const repoDir = path.join(tmpRoot, 'new-project');
    await mkdir(path.join(repoDir, '.deliverables'), { recursive: true });

    // Project init only calls ensureLibrarySkeleton, not initWorkspaceMemory
    const { ensureLibrarySkeleton } = await import('../task-init.js');
    await ensureLibrarySkeleton(tmpRoot, repoDir);

    expect(existsSync(path.join(repoDir, '.gitignore'))).toBe(true);
    expect(existsSync(path.join(repoDir, '.MEMORY.md'))).toBe(false);
    expect(existsSync(path.join(repoDir, '.claude'))).toBe(false);
  });
});

/**
 * Setup for merge-delete tests
 */
async function setupProjectWithNotebook() {
  const repoDir = path.join(tmpRoot, 'project');
  await mkdir(path.join(repoDir, '.deliverables'), { recursive: true });

  const git = simpleGit(repoDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');

  // Initial commit on master (project-level files only)
  await writeFile(path.join(repoDir, '.deliverables', '.keep'), '', 'utf-8');
  await writeFile(path.join(repoDir, '.gitignore'), '.worktrees/\n', 'utf-8');
  await writeFile(path.join(repoDir, '.MEMORY.md'), '# Project MEMORY', 'utf-8');
  await git.add('-A');
  await git.commit('init project');

  // Create task branch + worktree
  await git.branch(['task/test-nb']);
  const worktreePath = path.join(repoDir, '.worktrees', 'task-test-nb');
  await git.raw(['worktree', 'add', worktreePath, 'task/test-nb']);

  // Simulate notebook init files in worktree
  const wtGit = simpleGit(worktreePath);
  await mkdir(path.join(worktreePath, '.working'), { recursive: true });
  await mkdir(path.join(worktreePath, '.claude'), { recursive: true });
  await mkdir(path.join(worktreePath, '.deliverables', 'output'), { recursive: true });

  await writeFile(path.join(worktreePath, '.MEMORY.md'), '# Notebook MEMORY (overwritten)', 'utf-8');
  await writeFile(path.join(worktreePath, '.claude', 'settings.json'), '{}', 'utf-8');
  await writeFile(path.join(worktreePath, '.working', '.status.json'), '{}', 'utf-8');
  await writeFile(path.join(worktreePath, '.working', '.target.md'), '# Target', 'utf-8');
  await writeFile(path.join(worktreePath, 'test-nb.notebook.json'), '{"cells":[]}', 'utf-8');
  await writeFile(path.join(worktreePath, '.deliverables', 'output', 'report.pdf'), 'pdf-content', 'utf-8');

  await wtGit.add('-A');
  await wtGit.commit('task work');

  return { repoDir, worktreePath };
}

describe('notebook merge-delete cleanup', () => {
  it('mergeDeliverables brings only .deliverables/ to master, not notebook artifacts', async () => {
    const { repoDir } = await setupProjectWithNotebook();

    const { GitManager } = await import('../git.js');
    const git = new GitManager(repoDir);

    await git.mergeDeliverables('task/test-nb');

    // .deliverables/ content should be merged
    expect(existsSync(path.join(repoDir, '.deliverables', 'output', 'report.pdf'))).toBe(true);

    // Notebook-specific artifacts must NOT be on master
    expect(existsSync(path.join(repoDir, '.claude'))).toBe(false);
    expect(existsSync(path.join(repoDir, '.working'))).toBe(false);
    expect(existsSync(path.join(repoDir, 'test-nb.notebook.json'))).toBe(false);
  });

  it('project-level .MEMORY.md is preserved after merge', async () => {
    const { repoDir } = await setupProjectWithNotebook();

    const { GitManager } = await import('../git.js');
    const git = new GitManager(repoDir);

    await git.mergeDeliverables('task/test-nb');

    // Project-level .MEMORY.md should remain unchanged (not overwritten by notebook's version)
    expect(existsSync(path.join(repoDir, '.MEMORY.md'))).toBe(true);
    const content = await readFile(path.join(repoDir, '.MEMORY.md'), 'utf-8');
    expect(content).toBe('# Project MEMORY');
  });

  it('.gitignore on master is preserved after merge', async () => {
    const { repoDir } = await setupProjectWithNotebook();

    const { GitManager } = await import('../git.js');
    const git = new GitManager(repoDir);

    await git.mergeDeliverables('task/test-nb');

    expect(existsSync(path.join(repoDir, '.gitignore'))).toBe(true);
  });
});
