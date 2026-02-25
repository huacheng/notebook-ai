/**
 * notebookSlice tests — updateAgent regression.
 */

import { describe, it, expect } from 'vitest';
import { createNotebookSlice } from '../store/notebookSlice';

function createTestSlice() {
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

  return { state, getAction: (name: string) => (state as any)[name].bind(state) };
}

describe('updateAgent', () => {
  it('is a function on the slice', () => {
    const { state } = createTestSlice();
    expect(typeof state.updateAgent).toBe('function');
  });

  it('updates notebook metadata.agent to gemini', () => {
    const { state, getAction } = createTestSlice();
    state.notebook = {
      version: 1,
      metadata: { title: 'Test', created: '2025-01-01', agent: 'claude', git_repo: false },
      cells: [],
      slice: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    };
    getAction('updateAgent')('gemini');
    expect(state.notebook.metadata.agent).toBe('gemini');
  });

  it('updates metadata.updated timestamp', () => {
    const { state, getAction } = createTestSlice();
    state.notebook = {
      version: 1,
      metadata: { title: 'Test', created: '2025-01-01', updated: '2025-01-01', agent: 'claude', git_repo: false },
      cells: [],
      slice: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    };
    getAction('updateAgent')('gemini');
    expect(state.notebook.metadata.updated).not.toBe('2025-01-01');
  });

  it('no-ops when notebook is null', () => {
    const { state, getAction } = createTestSlice();
    expect(state.notebook).toBeNull();
    getAction('updateAgent')('gemini');
    expect(state.notebook).toBeNull();
  });
});
