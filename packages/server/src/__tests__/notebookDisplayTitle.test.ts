/**
 * Worktree notebooks should include their metadata.title in file listings,
 * so the frontend can display "聪明钱包" instead of "nb-556ea568".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { computeProjectFileList } from '../project-file-list.js';

let tmpDir: string;
let projectDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nb-test-display-title-'));
  projectDir = path.join(tmpDir, 'proj');
  await mkdir(path.join(projectDir, '.worktrees'), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('worktree notebook display title', () => {
  it('returns title from .notebook.json metadata for worktree notebooks', async () => {
    const slug = 'nb-556ea568';
    const wtDir = path.join(projectDir, '.worktrees', `task-${slug}`);
    await mkdir(wtDir, { recursive: true });

    // Create notebook with Chinese title
    await writeFile(
      path.join(wtDir, `${slug}.notebook.json`),
      JSON.stringify({ metadata: { title: '聪明钱包' }, cells: [] }),
    );

    const result = await computeProjectFileList(projectDir, '.');
    const nbEntry = result.files.find(f => f.name === `task-${slug}`);

    expect(nbEntry).toBeDefined();
    expect(nbEntry!.isNotebook).toBe(true);
    expect(nbEntry!.title).toBe('聪明钱包');
  });

  it('returns title for non-worktree notebook directories (old-style)', async () => {
    const slug = 'nb-oldstyle';
    const nbDir = path.join(projectDir, slug);
    await mkdir(nbDir, { recursive: true });

    await writeFile(
      path.join(nbDir, `${slug}.notebook.json`),
      JSON.stringify({ metadata: { title: '旧式笔记本' }, cells: [] }),
    );

    const result = await computeProjectFileList(projectDir, '.');
    const nbEntry = result.files.find(f => f.name === slug);

    expect(nbEntry).toBeDefined();
    expect(nbEntry!.isNotebook).toBe(true);
    expect(nbEntry!.title).toBe('旧式笔记本');
  });

  it('returns title for .notebook.json file when browsing inside notebook dir', async () => {
    const slug = 'nb-556ea568';
    const wtDir = path.join(projectDir, '.worktrees', `task-${slug}`);
    await mkdir(wtDir, { recursive: true });

    await writeFile(
      path.join(wtDir, `${slug}.notebook.json`),
      JSON.stringify({ metadata: { title: '聪明钱包' }, cells: [] }),
    );
    // Also create a regular file so the listing isn't empty
    await writeFile(path.join(wtDir, 'notes.md'), '# Notes');

    // Browse inside the worktree directory
    const result = await computeProjectFileList(projectDir, `.worktrees/task-${slug}`);
    const nbFile = result.files.find(f => f.name === `${slug}.notebook.json`);

    expect(nbFile).toBeDefined();
    expect(nbFile!.title).toBe('聪明钱包');
  });

  it('falls back to slug when .notebook.json has no title', async () => {
    const slug = 'nb-aabb1122';
    const wtDir = path.join(projectDir, '.worktrees', `task-${slug}`);
    await mkdir(wtDir, { recursive: true });

    await writeFile(
      path.join(wtDir, `${slug}.notebook.json`),
      JSON.stringify({ metadata: {}, cells: [] }),
    );

    const result = await computeProjectFileList(projectDir, '.');
    const nbEntry = result.files.find(f => f.name === `task-${slug}`);

    expect(nbEntry).toBeDefined();
    // No title field when metadata.title is missing
    expect(nbEntry!.title).toBeUndefined();
  });
});
