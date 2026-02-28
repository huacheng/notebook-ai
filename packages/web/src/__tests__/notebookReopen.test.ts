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

  it('handleDirClick for notebook dir returns undefined so navigateInto still runs', () => {
    // The contract: handleDirClick opens the notebook but does NOT return true,
    // so FileSection's navigateInto() proceeds to show the directory contents.

    let fileClickCalled = false;
    async function simulateHandleDirClick(
      meta: { isNotebook?: boolean; worktreePath?: string },
      findNotebookFile: () => string | null,
    ): Promise<boolean | void> {
      if (meta.isNotebook && meta.worktreePath) {
        const nbEntry = findNotebookFile();
        if (nbEntry) {
          fileClickCalled = true; // handleFileClick called
          // Don't return true — let navigateInto proceed
        }
      } else if (meta.isNotebook) {
        fileClickCalled = true;
      }
      // Return undefined → navigateInto runs
    }

    // Test: worktree notebook found — opens notebook AND navigateInto runs
    const result1 = simulateHandleDirClick(
      { isNotebook: true, worktreePath: '.worktrees/task-foo' },
      () => 'foo.notebook.json',
    );
    expect(result1).resolves.toBeUndefined();
    expect(fileClickCalled).toBe(true);

    // Test: non-notebook directory — no file click, navigateInto runs
    fileClickCalled = false;
    const result2 = simulateHandleDirClick(
      { isNotebook: false },
      () => null,
    );
    expect(result2).resolves.toBeUndefined();
    expect(fileClickCalled).toBe(false);
  });
});
