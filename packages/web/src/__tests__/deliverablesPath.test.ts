import { describe, it, expect } from 'vitest';
import { getDeliverablesPath } from '../utils/deliverablesPath';
import { validateTitle } from '../utils/validateTitle';
import { createProjectSlice } from '../store/projectSlice';

describe('getDeliverablesPath', () => {
  it('returns project-level .deliverables when no notebook is active', () => {
    expect(getDeliverablesPath(null, '/ws/project-a')).toBe('.deliverables');
  });

  it('returns notebook-level .deliverables when workspaceDir has .worktrees pattern (even if project is null)', () => {
    // Fallback: detect .worktrees/task-xxx pattern in workspaceDir
    expect(getDeliverablesPath('/ws/project-a/.worktrees/task-nb', null)).toBe('.worktrees/task-nb/.deliverables');
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

// ── validateTitle Unicode support ─────────────────────────────────────

describe('validateTitle', () => {
  it('accepts Chinese characters', () => {
    expect(validateTitle('测试')).toBe('');
  });

  it('accepts Japanese characters', () => {
    expect(validateTitle('テスト')).toBe('');
  });

  it('accepts Korean characters', () => {
    expect(validateTitle('테스트')).toBe('');
  });

  it('accepts mixed Unicode and ASCII', () => {
    expect(validateTitle('项目 Alpha')).toBe('');
  });

  it('rejects pure punctuation/symbols', () => {
    expect(validateTitle('---')).not.toBe('');
  });

  it('rejects names starting with dot', () => {
    expect(validateTitle('.hidden')).not.toBe('');
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
  return { state, getAction: (name: string) => (state as any)[name].bind(state) };
}

describe('project navigation sets sidebar level', () => {
  it('setActiveProject sets sidebarLevel to L2', () => {
    const { state, getAction } = createProjectTestSlice();
    getAction('setActiveProject')('proj-1', '/ws/proj-1');
    expect(state.sidebarLevel).toBe('L2');
  });

  it('goBackToProjectList sets sidebarLevel to L1', () => {
    const { state, getAction } = createProjectTestSlice();
    getAction('setActiveProject')('proj-1', '/ws/proj-1');
    getAction('goBackToProjectList')();
    expect(state.sidebarLevel).toBe('L1');
  });
});
