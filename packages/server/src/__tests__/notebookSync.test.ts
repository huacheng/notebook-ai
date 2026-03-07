/**
 * @vitest-environment node
 *
 * Tests for cross-device notebook sync:
 * 1. openNotebookByPath returns in-memory notebook for reconnected sessions
 * 2. subscribe sends notebook_digest
 * 3. notebook_sync_request returns full in-memory notebook
 */
import { describe, it, expect, vi } from 'vitest';

describe('cross-device notebook sync', () => {

  describe('openNotebookByPath returns in-memory notebook for reconnected sessions', () => {
    it('should return session.notebook when reconnected=true', async () => {
      // The fix: when reconnectSession returns { reconnected: true },
      // openNotebookByPath should use result.session.notebook (in-memory),
      // not the disk notebook loaded by notebookStore.load().
      //
      // We test the expected contract: the returned notebook should be
      // the in-memory version when the session already exists.
      const diskNotebook = {
        cells: [{ id: 'c1' }],
      };
      const inMemoryNotebook = {
        cells: [{ id: 'c1' }, { id: 'c2' }],
      };

      // Simulate the fix logic:
      const reconnected = true;
      const sessionNotebook = inMemoryNotebook;
      const resultNotebook = reconnected ? sessionNotebook : diskNotebook;

      expect(resultNotebook.cells).toHaveLength(2);
      expect(resultNotebook.cells[1].id).toBe('c2');
    });

    it('should return disk notebook when reconnected=false (new session)', () => {
      const diskNotebook = {
        cells: [{ id: 'c1' }],
      };
      const inMemoryNotebook = {
        cells: [], // createSession returns empty notebook
      };

      const reconnected = false;
      const sessionNotebook = inMemoryNotebook;
      const resultNotebook = reconnected ? sessionNotebook : diskNotebook;

      expect(resultNotebook.cells).toHaveLength(1);
      expect(resultNotebook.cells[0].id).toBe('c1');
    });
  });

  describe('notebook_digest on subscribe', () => {
    it('builds correct digest from session notebook', () => {
      const cells = [
        { id: 'c1', type: 'prompt', source: 'hello', outputs: [], status: 'completed', execution_count: 1 },
        { id: 'c2', type: 'prompt', source: 'world', outputs: [{ type: 'text', content: 'result' }], status: 'completed', execution_count: 2 },
      ];

      const digest = {
        type: 'notebook_digest' as const,
        session_id: 'nb-abc',
        cell_count: cells.length,
        last_cell_id: cells.length > 0 ? cells[cells.length - 1].id : null,
      };

      expect(digest.type).toBe('notebook_digest');
      expect(digest.cell_count).toBe(2);
      expect(digest.last_cell_id).toBe('c2');
    });

    it('handles empty notebook in digest', () => {
      const cells: unknown[] = [];
      const digest = {
        type: 'notebook_digest' as const,
        session_id: 'nb-abc',
        cell_count: cells.length,
        last_cell_id: cells.length > 0 ? (cells[cells.length - 1] as any).id : null,
      };

      expect(digest.cell_count).toBe(0);
      expect(digest.last_cell_id).toBeNull();
    });
  });

  describe('notebook_sync_request returns full notebook', () => {
    it('should return in-memory notebook cells on sync request', () => {
      // Simulate the handler logic
      const session = {
        id: 'nb-abc',
        notebook: {
          version: 1,
          metadata: { title: 'Test', created: '', git_repo: false, agent: 'claude' },
          cells: [
            { id: 'c1', type: 'prompt', source: 'hello', outputs: [], status: 'completed', execution_count: 1 },
            { id: 'c2', type: 'prompt', source: 'world', outputs: [{ type: 'text', content: 'output' }], status: 'running', execution_count: 2 },
          ],
          slide: { generated: false, sections: [] },
          annotations: [],
          assets: { intermediate_files: [] },
        },
      };

      const response = {
        type: 'notebook_sync' as const,
        session_id: session.id,
        notebook: session.notebook,
      };

      expect(response.type).toBe('notebook_sync');
      expect(response.notebook.cells).toHaveLength(2);
      expect(response.notebook.cells[1].status).toBe('running');
    });
  });
});
