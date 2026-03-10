/**
 * Test: resolveAbsolutePath should not produce duplicate path segments
 * when workspaceDir is a subdirectory of the project root and filePath
 * already contains the relative path from project root.
 */
import { describe, it, expect } from 'vitest';
import { resolveAbsolutePath } from '../types/fileAnnotations';

describe('resolveAbsolutePath — no duplicate segments', () => {
  it('workspace file in worktree: should use activeProjectPath as base', () => {
    const result = resolveAbsolutePath(
      'workspace',
      '.worktrees/task-X/.working/.target.md',
      '/home/user/projects/demo/.worktrees/task-X',  // workspaceDir (notebook cwd)
      '/home/user/projects/demo',                     // activeProjectPath (project root)
    );
    expect(result).toBe('/home/user/projects/demo/.worktrees/task-X/.working/.target.md');
    // Should NOT be: .../demo/.worktrees/task-X/.worktrees/task-X/.working/.target.md
  });

  it('workspace file at project root: should still work normally', () => {
    const result = resolveAbsolutePath(
      'workspace',
      'src/main.ts',
      '/home/user/projects/demo',   // workspaceDir = project root
      '/home/user/projects/demo',   // activeProjectPath = same
    );
    expect(result).toBe('/home/user/projects/demo/src/main.ts');
  });

  it('workspace file when activeProjectPath is null: falls back to workspaceDir', () => {
    const result = resolveAbsolutePath(
      'workspace',
      'hello.py',
      '/home/user/projects/demo',
      null,
    );
    expect(result).toBe('/home/user/projects/demo/hello.py');
  });
});
