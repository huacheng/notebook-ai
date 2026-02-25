/**
 * sidebarSlice tests — makeBlankNotebook metadata.agent regression.
 */

import { describe, it, expect } from 'vitest';
import { createSidebarSlice } from '../store/sidebarSlice';

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

  const slice = createSidebarSlice(set as any, get, {} as any);
  Object.assign(state, slice);

  return { state, getAction: (name: string) => (state as any)[name].bind(state) };
}

describe('createNewNotebook blank metadata', () => {
  it('createNewNotebook produces a notebook with metadata.agent set', async () => {
    const { state, getAction } = createTestSlice();

    // Mock fetch to return a valid response so the code path produces a notebook
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        notebook: {
          version: 1,
          metadata: { title: 'Test', created: '2025-01-01', agent: 'claude', git_repo: false },
          cells: [],
          slice: { generated: false, sections: [] },
          annotations: [],
          assets: { intermediate_files: [] },
        },
        notebookId: 'nb-1',
        sessionId: 's-1',
        workspaceDir: '/tmp/test',
      }),
    })) as any;

    try {
      // createNewNotebook optimistically sets a blank notebook first
      // The blank notebook's metadata must include `agent`
      const createPromise = getAction('createNewNotebook')('Test');

      // Right after calling, the optimistic blank notebook should already be set
      // and it must have agent in metadata (to satisfy the shared Notebook type)
      expect(state.notebook).not.toBeNull();
      expect(state.notebook.metadata).toHaveProperty('agent');

      await createPromise;
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
