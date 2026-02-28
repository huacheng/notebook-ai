import { describe, it, expect } from 'vitest';
import type { Notebook } from '@notebook-ai/shared';
import { applyToSession } from '../store/wsRouting';

const dummyNb = (title: string): Notebook => ({
  cells: [],
  metadata: { title, created: '', git_repo: false, agent: 'claude' as const },
} as any);

function makeState(activeTabId: string | null, entries: Record<string, { notebook: Notebook; sessionId: string }>) {
  const openNotebooks: Record<string, any> = {};
  for (const [id, e] of Object.entries(entries)) {
    openNotebooks[id] = { notebook: e.notebook, sessionId: e.sessionId, scrollY: 0, workspaceDir: null };
  }
  return {
    openNotebooks,
    activeNotebookTabId: activeTabId,
    notebook: activeTabId ? openNotebooks[activeTabId]?.notebook ?? null : null,
  } as any;
}

describe('applyToSession', () => {
  it('routes mutation to correct notebook by sessionId', () => {
    const nb1 = dummyNb('nb1');
    const nb2 = dummyNb('nb2');
    const state = makeState('id1', {
      id1: { notebook: nb1, sessionId: 's1' },
      id2: { notebook: nb2, sessionId: 's2' },
    });

    const result = applyToSession(state, 's2', (nb) => ({
      ...nb,
      metadata: { ...nb.metadata, title: 'mutated' },
    }));

    expect(result.openNotebooks!.id2.notebook.metadata.title).toBe('mutated');
    // id1 untouched
    expect(result.openNotebooks!.id1.notebook.metadata.title).toBe('nb1');
  });

  it('updates state.notebook when target is active tab', () => {
    const nb1 = dummyNb('nb1');
    const state = makeState('id1', {
      id1: { notebook: nb1, sessionId: 's1' },
    });

    const result = applyToSession(state, 's1', (nb) => ({
      ...nb,
      metadata: { ...nb.metadata, title: 'active-mutated' },
    }));

    expect(result.notebook!.metadata.title).toBe('active-mutated');
  });

  it('does not update state.notebook for background tab', () => {
    const nb1 = dummyNb('nb1');
    const nb2 = dummyNb('nb2');
    const state = makeState('id1', {
      id1: { notebook: nb1, sessionId: 's1' },
      id2: { notebook: nb2, sessionId: 's2' },
    });

    const result = applyToSession(state, 's2', (nb) => ({
      ...nb,
      metadata: { ...nb.metadata, title: 'bg-mutated' },
    }));

    // state.notebook should not be set (background tab)
    expect(result.notebook).toBeUndefined();
  });

  it('returns unchanged state for unknown sessionId', () => {
    const nb1 = dummyNb('nb1');
    const state = makeState('id1', {
      id1: { notebook: nb1, sessionId: 's1' },
    });

    const result = applyToSession(state, 'unknown', (nb) => ({
      ...nb,
      metadata: { ...nb.metadata, title: 'should-not-appear' },
    }));

    expect(result.openNotebooks).toEqual(state.openNotebooks);
    expect(result.notebook).toBeUndefined();
  });
});
