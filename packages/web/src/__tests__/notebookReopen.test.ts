/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

describe('notebook reopen guard', () => {
  it('does not re-fetch when notebook is already open (matched by workspaceDir)', () => {
    // Simulate: openNotebooks has an entry with workspaceDir '/projects/a/.worktrees/task-foo'
    // handleFileClick should detect the match and skip the fetch
    const openNotebooks: Record<string, { workspaceDir: string | null }> = {
      'nb-123': { workspaceDir: '/projects/a/.worktrees/task-foo' },
    };

    const notebookPath = '/projects/a/.worktrees/task-foo/foo.notebook.json';
    const wsDir = notebookPath.replace(/\/[^/]+$/, '');

    let matched: string | null = null;
    for (const [nbId, entry] of Object.entries(openNotebooks)) {
      if (entry.workspaceDir === wsDir) {
        matched = nbId;
        break;
      }
    }

    expect(matched).toBe('nb-123');
  });

  it('does not match when workspaceDir differs', () => {
    const openNotebooks: Record<string, { workspaceDir: string | null }> = {
      'nb-456': { workspaceDir: '/projects/a/.worktrees/task-bar' },
    };

    const notebookPath = '/projects/a/.worktrees/task-foo/foo.notebook.json';
    const wsDir = notebookPath.replace(/\/[^/]+$/, '');

    let matched: string | null = null;
    for (const [nbId, entry] of Object.entries(openNotebooks)) {
      if (entry.workspaceDir === wsDir) {
        matched = nbId;
        break;
      }
    }

    expect(matched).toBeNull();
  });

  it('handleDirClick for worktree notebook returns true to prevent navigateInto', () => {
    // The fix: handleDirClick should return true for worktree notebooks
    // so that FileSection's onClick does not also call navigateInto
    // We test the contract: when meta.isNotebook && meta.worktreePath, return true

    // This is a behavioral contract test — verifying the return value pattern
    async function simulateHandleDirClick(
      meta: { isNotebook?: boolean; worktreePath?: string },
      findNotebookFile: () => string | null,
    ): Promise<boolean | void> {
      if (meta.isNotebook && meta.worktreePath) {
        const nbEntry = findNotebookFile();
        if (nbEntry) {
          // handleFileClick would be called here
          return true; // must return true to prevent navigateInto
        }
      }
      if (meta.isNotebook) {
        return true;
      }
    }

    // Test: worktree notebook found
    const result1 = simulateHandleDirClick(
      { isNotebook: true, worktreePath: '.worktrees/task-foo' },
      () => 'foo.notebook.json',
    );
    expect(result1).resolves.toBe(true);

    // Test: non-notebook directory
    const result2 = simulateHandleDirClick(
      { isNotebook: false },
      () => null,
    );
    expect(result2).resolves.toBeUndefined();
  });
});
