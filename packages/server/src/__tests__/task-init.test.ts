import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'task-init-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('initTaskWorkingDir', () => {
  it('creates .index.json in .working/ with correct schema', async () => {
    const { initTaskWorkingDir } = await import('../task-init.js');
    const nbDir = path.join(tmpRoot, 'my-task');
    await mkdir(path.join(nbDir, '.working'), { recursive: true });

    await initTaskWorkingDir({
      nbDir,
      nbSlug: 'my-task',
      title: 'My Task',
      branchName: 'task/my-task',
      worktreePath: '.worktrees/task-my-task',
    });

    const indexPath = path.join(nbDir, '.working', '.index.json');
    expect(existsSync(indexPath)).toBe(true);

    const data = JSON.parse(await readFile(indexPath, 'utf-8'));
    expect(data.title).toBe('My Task');
    expect(data.status).toBe('draft');
    expect(data.phase).toBe('');
    expect(data.type).toBe('');
    expect(data.completed_steps).toBe(0);
    expect(data.depends_on).toEqual([]);
    expect(data.tags).toEqual([]);
    expect(data.created).toBeDefined();
    expect(data.updated).toBeDefined();
  });

  it('sets branch and worktree correctly in .index.json', async () => {
    const { initTaskWorkingDir } = await import('../task-init.js');
    const nbDir = path.join(tmpRoot, 'my-task');
    await mkdir(path.join(nbDir, '.working'), { recursive: true });

    await initTaskWorkingDir({
      nbDir,
      nbSlug: 'my-task',
      title: 'My Task',
      branchName: 'task/my-task',
      worktreePath: '.worktrees/task-my-task',
    });

    const data = JSON.parse(
      await readFile(path.join(nbDir, '.working', '.index.json'), 'utf-8'),
    );
    expect(data.branch).toBe('task/my-task');
    expect(data.worktree).toBe('.worktrees/task-my-task');
  });

  it('creates .target.md with title and template structure', async () => {
    const { initTaskWorkingDir } = await import('../task-init.js');
    const nbDir = path.join(tmpRoot, 'my-task');
    await mkdir(path.join(nbDir, '.working'), { recursive: true });

    await initTaskWorkingDir({
      nbDir,
      nbSlug: 'my-task',
      title: 'My Task',
      branchName: 'task/my-task',
      worktreePath: '.worktrees/task-my-task',
    });

    const targetPath = path.join(nbDir, '.working', '.target.md');
    expect(existsSync(targetPath)).toBe(true);
    const content = await readFile(targetPath, 'utf-8');
    expect(content).toContain('# Task Target: My Task');
    expect(content).toContain('## Objective');
    expect(content).toContain('## Requirements');
    expect(content).toContain('## Constraints');
  });

  it('returns the TaskIndexJson object', async () => {
    const { initTaskWorkingDir } = await import('../task-init.js');
    const nbDir = path.join(tmpRoot, 'my-task');
    await mkdir(path.join(nbDir, '.working'), { recursive: true });

    const result = await initTaskWorkingDir({
      nbDir,
      nbSlug: 'my-task',
      title: 'My Task',
      branchName: 'task/my-task',
      worktreePath: '.worktrees/task-my-task',
    });

    expect(result.title).toBe('My Task');
    expect(result.status).toBe('draft');
    expect(result.branch).toBe('task/my-task');
  });
});

describe('ensureLibrarySkeleton', () => {
  it('creates .library/ skeleton directories and files', async () => {
    const { ensureLibrarySkeleton } = await import('../task-init.js');
    const projectPath = path.join(tmpRoot, 'my-project');
    await mkdir(projectPath, { recursive: true });

    await ensureLibrarySkeleton(tmpRoot, projectPath);

    const libDir = path.join(tmpRoot, '.library');
    expect(existsSync(path.join(libDir, '.changelog'))).toBe(true);
    expect(existsSync(path.join(libDir, '.changelog-archive'))).toBe(true);
    expect(existsSync(path.join(libDir, '.master-index.md'))).toBe(true);
    expect(existsSync(path.join(libDir, '.type-registry.md'))).toBe(true);
    expect(existsSync(path.join(libDir, '.memory'))).toBe(true);
  });

  it('is idempotent — calling twice does not throw', async () => {
    const { ensureLibrarySkeleton } = await import('../task-init.js');
    const projectPath = path.join(tmpRoot, 'my-project');
    await mkdir(projectPath, { recursive: true });

    await ensureLibrarySkeleton(tmpRoot, projectPath);
    await ensureLibrarySkeleton(tmpRoot, projectPath);

    expect(existsSync(path.join(tmpRoot, '.library', '.changelog'))).toBe(true);
  });

  it('appends task-ai gitignore rules to project .gitignore', async () => {
    const { ensureLibrarySkeleton } = await import('../task-init.js');
    const projectPath = path.join(tmpRoot, 'my-project');
    await mkdir(projectPath, { recursive: true });

    await ensureLibrarySkeleton(tmpRoot, projectPath);

    const gitignore = await readFile(
      path.join(projectPath, '.gitignore'),
      'utf-8',
    );
    expect(gitignore).toContain('.worktrees/');
    expect(gitignore).toContain('**/.working/.lock');
  });

  it('preserves existing .gitignore content when appending', async () => {
    const { ensureLibrarySkeleton } = await import('../task-init.js');
    const projectPath = path.join(tmpRoot, 'my-project');
    await mkdir(projectPath, { recursive: true });
    await writeFile(
      path.join(projectPath, '.gitignore'),
      'node_modules/\n',
      'utf-8',
    );

    await ensureLibrarySkeleton(tmpRoot, projectPath);

    const gitignore = await readFile(
      path.join(projectPath, '.gitignore'),
      'utf-8',
    );
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('.worktrees/');
  });

  it('does not duplicate gitignore entries on repeated calls', async () => {
    const { ensureLibrarySkeleton } = await import('../task-init.js');
    const projectPath = path.join(tmpRoot, 'my-project');
    await mkdir(projectPath, { recursive: true });

    await ensureLibrarySkeleton(tmpRoot, projectPath);
    await ensureLibrarySkeleton(tmpRoot, projectPath);

    const gitignore = await readFile(
      path.join(projectPath, '.gitignore'),
      'utf-8',
    );
    const occurrences = gitignore.split('.worktrees/').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('GitManager.commitAll', () => {
  it('commits all changes with the given message', async () => {
    const { GitManager } = await import('../git.js');
    const repoDir = path.join(tmpRoot, 'git-test');
    await mkdir(repoDir, { recursive: true });

    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');

    // Create a file
    await writeFile(path.join(repoDir, 'hello.txt'), 'hello', 'utf-8');

    const mgr = new GitManager(repoDir);
    await mgr.commitAll('test commit message');

    const log = await git.log();
    expect(log.latest?.message).toBe('test commit message');
  });
});
