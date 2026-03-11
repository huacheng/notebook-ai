import path from 'path';
import os from 'os';
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
 * Converts a title string into a URL-safe slug.
 * Preserves Unicode letters (CJK, Japanese, Korean, etc.) and digits.
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
export async function initWorkspaceMemory(workspaceDir: string, projectPath?: string, opts?: { skipClaudeSettings?: boolean }): Promise<void> {
  mkdirSync(workspaceDir, { recursive: true });
  const libraryDir = getLibraryDir();
  const libRelPath = path.relative(workspaceDir, libraryDir);

  let content =
    `# MEMORY\n\n` +
    `## Shared Library Directory\n\n` +
    `Path (relative to this workspace): \`${libRelPath}\`\n` +
    `Absolute path: \`${libraryDir}\`\n\n` +
    `This is the shared library directory accessible to all notebooks.\n` +
    `You can both read from and write to this directory.\n` +
    `Use it to store datasets, scripts, configuration files, and other\n` +
    `resources that should be shared across notebooks.\n\n` +
    `## Deliverables Directory\n\n` +
    `Path: \`.deliverables\`\n` +
    `Absolute path: \`${path.join(workspaceDir, '.deliverables')}\`\n\n` +
    `This is the deliverables directory for this notebook.\n` +
    `Place final outputs here — reports, exported files, generated artifacts,\n` +
    `and any other deliverables that should be presented to the user.\n` +
    `Files in this directory are shown in the right panel of the UI.\n`;

  if (projectPath) {
    const projDelRel = path.relative(workspaceDir, path.join(projectPath, '.deliverables'));
    content +=
      `\n## Project Deliverables Directory\n\n` +
      `Path (relative to this workspace): \`${projDelRel}\`\n` +
      `Absolute path: \`${path.join(projectPath, '.deliverables')}\`\n\n` +
      `This is the project-level deliverables directory shared across all notebooks in the project.\n`;
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
