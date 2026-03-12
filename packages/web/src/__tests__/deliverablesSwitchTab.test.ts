/**
 * Test: Deliverables path updates when switching notebook tabs.
 *
 * Bug: Deliverables directory stays at project level after clicking a notebook.
 * Expected: Switch to notebook's worktree deliverables.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getDeliverablesPath } from '../utils/deliverablesPath';

describe('Deliverables path on tab switch', () => {
  const projectPath = '/home/ubuntu/nb-workspaces/project-a';
  const notebook1WorkspaceDir = '/home/ubuntu/nb-workspaces/project-a/.worktrees/task-notebook-1';
  const notebook2WorkspaceDir = '/home/ubuntu/nb-workspaces/project-a/.worktrees/task-notebook-2';

  it('returns project-level deliverables when no notebook is active (workspaceDir=null)', () => {
    const result = getDeliverablesPath(null, projectPath);
    expect(result).toBe('.deliverables');
  });

  it('returns notebook-level deliverables when notebook is active', () => {
    const result = getDeliverablesPath(notebook1WorkspaceDir, projectPath);
    expect(result).toBe('.worktrees/task-notebook-1/.deliverables');
  });

  it('returns different deliverables path when switching to another notebook', () => {
    const result1 = getDeliverablesPath(notebook1WorkspaceDir, projectPath);
    const result2 = getDeliverablesPath(notebook2WorkspaceDir, projectPath);

    expect(result1).toBe('.worktrees/task-notebook-1/.deliverables');
    expect(result2).toBe('.worktrees/task-notebook-2/.deliverables');
    expect(result1).not.toBe(result2);
  });

  it('simulates full tab switch flow', () => {
    // 1. Enter project (no notebook active)
    let workspaceDir: string | null = null;
    expect(getDeliverablesPath(workspaceDir, projectPath)).toBe('.deliverables');

    // 2. Click notebook-1
    workspaceDir = notebook1WorkspaceDir;
    expect(getDeliverablesPath(workspaceDir, projectPath)).toBe('.worktrees/task-notebook-1/.deliverables');

    // 3. Switch to notebook-2
    workspaceDir = notebook2WorkspaceDir;
    expect(getDeliverablesPath(workspaceDir, projectPath)).toBe('.worktrees/task-notebook-2/.deliverables');

    // 4. Close all notebooks (back to project level)
    workspaceDir = null;
    expect(getDeliverablesPath(workspaceDir, projectPath)).toBe('.deliverables');
  });
});

describe('Store workspaceDir update on setActiveNotebookTab', () => {
  it('setActiveNotebookTab should update workspaceDir from openNotebooks entry', async () => {
    // This tests the store logic in notebookSlice.ts
    const { createNotebookSlice } = await import('../store/notebookSlice');

    let state: Record<string, any> = {};
    const set = (update: any) => {
      if (typeof update === 'function') {
        Object.assign(state, update(state));
      } else {
        Object.assign(state, update);
      }
    };
    const get = () => state as any;

    const slice = createNotebookSlice(set as any, get, {} as any);
    Object.assign(state, slice);

    // Setup: add two notebooks to openNotebooks
    const nb1 = { metadata: { title: 'NB1' }, cells: [] };
    const nb2 = { metadata: { title: 'NB2' }, cells: [] };
    const wsDir1 = '/ws/project/.worktrees/task-nb1';
    const wsDir2 = '/ws/project/.worktrees/task-nb2';

    // Open notebook 1
    state.openNotebookTab('nb1', nb1, 'session1', wsDir1);
    expect(state.workspaceDir).toBe(wsDir1);
    expect(state.activeNotebookId).toBe('nb1');

    // Open notebook 2
    state.openNotebookTab('nb2', nb2, 'session2', wsDir2);
    expect(state.workspaceDir).toBe(wsDir2);
    expect(state.activeNotebookId).toBe('nb2');

    // Switch back to notebook 1 via setActiveNotebookTab
    state.setActiveNotebookTab('nb1');
    expect(state.workspaceDir).toBe(wsDir1);
    expect(state.activeNotebookId).toBe('nb1');

    // Switch to notebook 2 again
    state.setActiveNotebookTab('nb2');
    expect(state.workspaceDir).toBe(wsDir2);
    expect(state.activeNotebookId).toBe('nb2');
  });
});
