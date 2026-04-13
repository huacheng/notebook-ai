import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { mkdirSync, existsSync, constants } from 'fs';
import { writeFile, chmod, access } from 'fs/promises';
import { GitManager } from './git.js';

const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), 'nb-workspaces');

/** Protected system file - read-only for users/Claude, writable only by backend init */
export const MEMORY_FILENAME = '.MEMORY.md';

export function getWorkspaceRoot(): string {
  return process.env['NB_WORKSPACES_ROOT'] ?? DEFAULT_WORKSPACE_ROOT;
}

/**
 * Returns the shared library directory path (shared across all notebooks).
 */
export function getLibraryDir(): string {
  return path.join(getWorkspaceRoot(), '.library');
}

/**
 * Creates the library directory if it doesn't exist and returns the path.
 */
export function ensureLibraryDir(): string {
  const dir = getLibraryDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Ensures the library directory exists and is a git repository.
 * Idempotent: only initializes git if not already a repo.
 */
export async function ensureLibraryGit(): Promise<string> {
  const dir = ensureLibraryDir();
  const git = new GitManager(dir);
  await git.ensureRepo();
  return dir;
}

/**
 * Generate a random ASCII-only slug: prefix + 8-char hex.
 * Used for filesystem paths — ensures pure ASCII for Claude CLI compatibility.
 */
export function generateSlug(prefix: 'proj' | 'nb' = 'nb'): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Converts a title string into a URL-safe slug.
 * Preserves Unicode letters (CJK, Japanese, Korean, etc.) and digits.
 * @deprecated Use generateSlug() for new creations. Kept for migration/tests.
 */
export function titleToSlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    || 'notebook';
}

/**
 * Returns the workspace directory path for a given slug.
 */
export function getWorkspaceDir(slug: string, userId?: string | null): string {
  const root = getWorkspaceRoot();
  if (userId) {
    return path.join(root, userId, slug);
  }
  return path.join(root, slug);
}

/**
 * Creates the workspace directory if it doesn't exist and returns the path.
 */
export function ensureWorkspaceDir(slug: string, userId?: string | null): string {
  const dir = getWorkspaceDir(slug, userId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Returns the .notebook.json file path within a workspace directory.
 */
export function getNotebookFilePath(workspaceDir: string, slug: string): string {
  return path.join(workspaceDir, `${slug}.notebook.json`);
}

/**
 * Generates a unique slug by appending a counter if the directory already exists.
 */
export function uniqueSlug(baseSlug: string, userId?: string | null): string {
  let slug = baseSlug;
  let counter = 1;
  while (existsSync(getWorkspaceDir(slug, userId))) {
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
  return slug;
}

/**
 * Writes the .MEMORY.md file into the workspace directory, recording the
 * shared library directory path relative to the workspace.
 * Safe to call multiple times — overwrites any existing .MEMORY.md.
 * This file is protected: users/Claude cannot modify it via API.
 */
export async function initWorkspaceMemory(
  workspaceDir: string,
  projectPath?: string,
  opts?: { skipClaudeSettings?: boolean; skipMemoryWrite?: boolean }
): Promise<void> {
  mkdirSync(workspaceDir, { recursive: true });

  if (!opts?.skipMemoryWrite) {
    const libraryDir = getLibraryDir();
    const libRelPath = path.relative(workspaceDir, libraryDir);
    const workingDir = path.join(workspaceDir, '.working');

    let content =
      `# MEMORY\n\n` +
      `## Task-AI Work Directory ($TASKAI_WORK_DIR)\n` +
      `Path: \`.working\` → \`${workingDir}\`\n` +
      `Note: /task-ai:* commands reference .working/.status.json, not worktree root.\n\n` +
      `### Core State Files\n` +
      `- **.status.json** — Task status hub: status/phase/completed_steps/stage/depends_on, sync point for all sub-commands\n` +
      `- **.target.md** — Objective + Acceptance Criteria + Constraints, anchor for D1 Correctness review\n` +
      `- **.plan.md** — Step-by-step plan with \`Covers: R#\` annotations, basis for exec and check\n` +
      `- **.summary.md** — Compressed context (≤200 lines): state/progress/decisions/issues, used for context recovery after compression\n\n` +
      `## Shared Library (read/write, shared across notebooks)\n` +
      `Path: \`${libRelPath}\` → \`${libraryDir}\`\n\n` +
      `## Deliverables\n` +
      `Path: \`.deliverables\` → \`${path.join(workspaceDir, '.deliverables')}\`\n` +
      `Write generated code, data, scripts, and other non-system outputs here.\n`;

    if (projectPath) {
      const projDelRel = path.relative(workspaceDir, path.join(projectPath, '.deliverables'));
      content +=
        `\n## Project Deliverables\n` +
        `Path: \`${projDelRel}\` → \`${path.join(projectPath, '.deliverables')}\`\n` +
        `Write cross-notebook outputs here (shared datasets, reports, artifacts).\n`;
    }

    const memoryPath = path.join(workspaceDir, MEMORY_FILENAME);

    // If file exists and is read-only, temporarily make it writable
    try {
      await access(memoryPath, constants.F_OK);
      await chmod(memoryPath, 0o644); // Make writable before overwriting
    } catch {
      // File doesn't exist yet, that's fine
    }

    await writeFile(memoryPath, content, 'utf-8');

    // Set file to read-only (444 = r--r--r--)
    await chmod(memoryPath, 0o444);
  }

  // Create .claude/settings.json with SessionStart hook to auto-load .MEMORY.md
  // Skip for project-level init (only needed in notebook worktrees)
  if (!opts?.skipClaudeSettings) {
    const claudeDir = path.join(workspaceDir, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.json');
    mkdirSync(claudeDir, { recursive: true });

    // Use absolute path for .MEMORY.md so the hook works regardless of Claude's cwd
    const absoluteMemoryPath = path.join(workspaceDir, MEMORY_FILENAME);
    const memoryLoadCommand = `cat "${absoluteMemoryPath}" 2>/dev/null || echo '无记忆文件'`;
    const memoryLoadHook = {
      command: memoryLoadCommand,
      description: '加载记忆文件',
    };

    const settingsContent = JSON.stringify({
      hooks: {
        SessionStart: [memoryLoadHook],
      },
    }, null, 2);

    // If file exists and is read-only, temporarily make it writable
    try {
      await access(settingsPath, constants.F_OK);
      await chmod(settingsPath, 0o644);
    } catch {
      // File doesn't exist yet
    }

    await writeFile(settingsPath, settingsContent, 'utf-8');
    await chmod(settingsPath, 0o444);
  }
}
