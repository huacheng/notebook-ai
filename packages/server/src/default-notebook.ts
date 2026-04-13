import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { generateSlug, initWorkspaceMemory } from './workspace.js';
import { NotebookStore } from './notebook-store.js';
import { GitManager } from './git.js';
import { initTaskWorkingDir } from './task-init.js';

/**
 * 判定 notebook 是否为默认 notebook（位于 project 根直接下）。
 * 通过 path.resolve 规范化两侧路径，避免末尾斜杠、相对路径、..段落导致误判。
 */
export function isDefaultNotebook(notebookPath: string, projectPath: string): boolean {
  const resolvedNb = path.resolve(notebookPath);
  const resolvedProject = path.resolve(projectPath);
  return path.dirname(resolvedNb) === resolvedProject;
}

export interface CreateDefaultNotebookResult {
  nbSlug: string;
  notebookPath: string;
  branchName: string;
}

export interface CreateDefaultNotebookOptions {
  projectPath: string;
  title: string;
  skipMemoryWrite?: boolean;
}

/**
 * 在 project 根创建默认 notebook（不走 worktree / 不开新分支）。
 * 调用方负责：DB 登记、session 创建、git commit。
 */
export async function createDefaultNotebook(
  opts: CreateDefaultNotebookOptions
): Promise<CreateDefaultNotebookResult> {
  const { projectPath, title, skipMemoryWrite } = opts;

  const git = new GitManager(projectPath);
  const branchName = await git.getCurrentBranch();

  let nbSlug = '';
  let notebookPath = '';
  for (let i = 0; i < 5; i++) {
    nbSlug = generateSlug('nb');
    notebookPath = `${projectPath}/${nbSlug}.notebook.json`;
    if (!existsSync(notebookPath)) break;
    if (i === 4) throw new Error('Failed to generate unique notebook slug after 5 retries');
  }

  const store = new NotebookStore();
  const notebook = store.createNew(title, projectPath);
  await store.save(notebookPath, notebook);

  mkdirSync(`${projectPath}/.working`, { recursive: true });
  mkdirSync(`${projectPath}/.deliverables`, { recursive: true });
  await initTaskWorkingDir({ worktreePath: projectPath, nbSlug, title, branchName });

  await initWorkspaceMemory(projectPath, undefined, {
    skipClaudeSettings: false,
    skipMemoryWrite,
  });

  return { nbSlug, notebookPath, branchName };
}
