import path from 'path';
import os from 'os';
import { mkdirSync, existsSync } from 'fs';
import { writeFile } from 'fs/promises';

const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), 'nb-workspaces');

function getWorkspaceRoot(): string {
  return process.env['NB_WORKSPACE_DIR'] ?? DEFAULT_WORKSPACE_ROOT;
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
 * Converts a title string into a URL-safe slug.
 */
export function titleToSlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled';
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
 * Writes a MEMORY.md file into the workspace directory, recording the
 * shared library directory path relative to the workspace.
 * Safe to call multiple times — overwrites any existing MEMORY.md.
 */
export async function initWorkspaceMemory(workspaceDir: string): Promise<void> {
  mkdirSync(workspaceDir, { recursive: true });
  const libraryDir = getLibraryDir();
  const relPath = path.relative(workspaceDir, libraryDir);
  const content =
    `# MEMORY\n\n` +
    `## Shared Library Directory\n\n` +
    `Path (relative to this workspace): \`${relPath}\`\n` +
    `Absolute path: \`${libraryDir}\`\n\n` +
    `This is the shared library directory accessible to all notebooks.\n` +
    `You can both read from and write to this directory.\n` +
    `Use it to store datasets, scripts, configuration files, and other\n` +
    `resources that should be shared across notebooks.\n`;
  await writeFile(path.join(workspaceDir, 'MEMORY.md'), content, 'utf-8');
}
