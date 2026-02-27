import { describe, it, expect } from 'vitest';
import { getDeliverablesPath } from '../utils/deliverablesPath';
import { createProjectSlice } from '../store/projectSlice';

describe('getDeliverablesPath', () => {
  it('returns project-level .deliverables when no notebook is active', () => {
    expect(getDeliverablesPath(null, '/ws/project-a')).toBe('.deliverables');
  });

  it('returns project-level .deliverables when no project is active', () => {
    expect(getDeliverablesPath('/ws/project-a/.worktrees/task-nb', null)).toBe('.deliverables');
  });

  it('returns worktree-level .deliverables when notebook is active inside project', () => {
    expect(getDeliverablesPath(
      '/ws/project-a/.worktrees/task-nb-a',
      '/ws/project-a',
    )).toBe('.worktrees/task-nb-a/.deliverables');
  });

  it('returns project-level .deliverables when workspaceDir is not inside project', () => {
    // standalone notebook not inside a project
    expect(getDeliverablesPath(
      '/ws/standalone-nb',
      '/ws/project-a',
    )).toBe('.deliverables');
  });

  it('handles project path without trailing slash', () => {
    expect(getDeliverablesPath(
      '/ws/proj/.worktrees/task-x',
      '/ws/proj',
    )).toBe('.worktrees/task-x/.deliverables');
  });
});

// ── Right panel auto open/close on project navigation ─────────────────

function createProjectTestSlice() {
  let state: Record<string, any> = {};
  const set = (update: any) => {
    if (typeof update === 'function') {
      Object.assign(state, update(state));
    } else {
      Object.assign(state, update);
    }
  };
  const get = () => state as any;
  const slice = createProjectSlice(set as any, get, {} as any);
  Object.assign(state, slice);
  // Simulate initial rightPanelOpen = false (project list level)
  state.rightPanelOpen = false;
  return { state, getAction: (name: string) => (state as any)[name].bind(state) };
}

describe('right panel auto open/close on project navigation', () => {
  it('setActiveProject opens right panel', () => {
    const { state, getAction } = createProjectTestSlice();
    expect(state.rightPanelOpen).toBe(false);
    getAction('setActiveProject')('proj-1', '/ws/proj-1');
    expect(state.rightPanelOpen).toBe(true);
  });

  it('goBackToProjectList closes right panel', () => {
    const { state, getAction } = createProjectTestSlice();
    getAction('setActiveProject')('proj-1', '/ws/proj-1');
    expect(state.rightPanelOpen).toBe(true);
    getAction('goBackToProjectList')();
    expect(state.rightPanelOpen).toBe(false);
  });

  it('rightPanelOpen defaults to false in uiSlice initial state', async () => {
    // This tests that the initial value is false (panel closed at app start)
    const { createUiSlice } = await import('../store/uiSlice');
    let state: Record<string, any> = {};
    const set = (update: any) => {
      if (typeof update === 'function') Object.assign(state, update(state));
      else Object.assign(state, update);
    };
    const slice = createUiSlice(set as any, (() => state) as any, {} as any);
    Object.assign(state, slice);
    expect(state.rightPanelOpen).toBe(false);
  });
});
