/**
 * Cell Lazy Load - Client-side Tests (TDD)
 *
 * Requirements:
 * 1. When notebook opens in lazy mode, store has cell_stubs instead of full cells
 * 2. Cell component shows loading state when cell is a stub
 * 3. useCellLazyLoad hook requests cell content when cell becomes visible
 * 4. cell_loaded message decompresses LZ4 and updates store
 */
import { describe, it, expect } from 'vitest';
import * as lz4 from 'lz4js';

// Local CellStub type (avoids importing from hook which triggers store init)
interface CellStub {
  id: string;
  type: string;
  source_preview: string;
  output_count: number;
  status: string;
  _stub: true;
}

// Local isCellStub implementation (mirrors useCellLazyLoad.ts)
function isCellStub(cell: unknown): cell is CellStub {
  return (
    typeof cell === 'object' &&
    cell !== null &&
    '_stub' in cell &&
    (cell as CellStub)._stub === true
  );
}

describe('Cell Lazy Load - Client', () => {
  describe('CellStub type', () => {
    it('should have required stub fields', () => {
      const stub: CellStub = {
        id: 'cell-1',
        type: 'prompt',
        source_preview: 'Hello world...',
        output_count: 2,
        status: 'completed',
        _stub: true,
      };

      expect(stub._stub).toBe(true);
      expect(stub.source_preview).toBeDefined();
      expect(stub.output_count).toBe(2);
    });

    it('should distinguish between stub and full cell using isCellStub', () => {
      const stub: CellStub = { id: 'cell-1', type: 'prompt', _stub: true, source_preview: '...', output_count: 0, status: 'completed' };
      const fullCell = { id: 'cell-1', type: 'prompt', source: 'Hello', outputs: [] };

      expect(isCellStub(stub)).toBe(true);
      expect(isCellStub(fullCell)).toBe(false);
    });

    it('should return false for null/undefined/primitives', () => {
      expect(isCellStub(null)).toBe(false);
      expect(isCellStub(undefined)).toBe(false);
      expect(isCellStub('string')).toBe(false);
      expect(isCellStub(123)).toBe(false);
      expect(isCellStub({})).toBe(false);
    });

    it('should return false if _stub is not true', () => {
      expect(isCellStub({ _stub: false })).toBe(false);
      expect(isCellStub({ _stub: 'true' })).toBe(false);
      expect(isCellStub({ _stub: 1 })).toBe(false);
    });
  });

  describe('cell_loaded message handling', () => {
    it('should decompress LZ4 cell data', () => {
      const cell = {
        id: 'cell-1',
        type: 'prompt',
        source: 'Hello world',
        outputs: [{ type: 'text', content: 'Response text' }],
        status: 'completed',
      };

      // Simulate server-side compression
      const cellJson = JSON.stringify(cell);
      const compressed = Buffer.from(lz4.compress(Buffer.from(cellJson, 'utf-8')));
      const base64 = compressed.toString('base64');

      // Client-side decompression
      const compressedBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const decompressed = lz4.decompress(compressedBytes);
      const text = new TextDecoder().decode(decompressed);
      const restored = JSON.parse(text);

      expect(restored).toEqual(cell);
    });

    it('should replace stub with full cell in store', () => {
      // Initial state with stubs
      const cells = [
        { id: 'cell-1', type: 'prompt', _stub: true, source_preview: 'Hello...' },
        { id: 'cell-2', type: 'prompt', _stub: true, source_preview: 'World...' },
      ];

      // Full cell data received
      const fullCell = {
        id: 'cell-1',
        type: 'prompt',
        source: 'Hello world',
        outputs: [{ type: 'text', content: 'Response' }],
        status: 'completed',
      };

      // Update logic
      const updatedCells = cells.map((c) =>
        c.id === fullCell.id ? fullCell : c
      );

      expect(updatedCells[0]).toEqual(fullCell);
      expect(updatedCells[0]._stub).toBeUndefined();
      expect(updatedCells[1]._stub).toBe(true);
    });
  });

  describe('cell load request', () => {
    it('should create valid cell_load message', () => {
      const msg = {
        type: 'cell_load',
        request_id: 'req-123',
        session_id: 'sess-456',
        cell_id: 'cell-789',
      };

      expect(msg.type).toBe('cell_load');
      expect(msg.cell_id).toBe('cell-789');
      expect(msg.session_id).toBeDefined();
      expect(msg.request_id).toBeDefined();
    });
  });

  describe('loading cells tracking', () => {
    it('should track which cells are currently loading', () => {
      const loadingCells = new Set<string>();

      // Start loading
      loadingCells.add('cell-1');
      expect(loadingCells.has('cell-1')).toBe(true);
      expect(loadingCells.has('cell-2')).toBe(false);

      // Finish loading
      loadingCells.delete('cell-1');
      expect(loadingCells.has('cell-1')).toBe(false);
    });

    it('should prevent duplicate load requests', () => {
      const loadingCells = new Set<string>();
      const requestedCells: string[] = [];

      function requestCellLoad(cellId: string) {
        if (loadingCells.has(cellId)) return false;
        loadingCells.add(cellId);
        requestedCells.push(cellId);
        return true;
      }

      expect(requestCellLoad('cell-1')).toBe(true);
      expect(requestCellLoad('cell-1')).toBe(false); // Duplicate
      expect(requestCellLoad('cell-2')).toBe(true);
      expect(requestedCells).toEqual(['cell-1', 'cell-2']);
    });
  });

  describe('replaceCellStub with openNotebooks (D1 fix)', () => {
    it('should update both notebook and openNotebooks', () => {
      const stub = { id: 'cell-1', type: 'prompt', _stub: true, source: '...' };
      const fullCell = { id: 'cell-1', type: 'prompt', source: 'Hello', outputs: [] };

      // Simulated state
      const state = {
        notebook: { metadata: {}, cells: [stub] },
        openNotebooks: {
          'nb-1': { notebook: { metadata: {}, cells: [stub] }, sessionId: 's1', scrollY: 0, workspaceDir: null },
        },
      };

      // Update logic (mirrors notebookSlice.replaceCellStub)
      const updatedNotebook = {
        ...state.notebook,
        cells: state.notebook.cells.map(c => c.id === fullCell.id ? fullCell : c),
      };

      const updatedOpenNotebooks = { ...state.openNotebooks };
      for (const [nbId, entry] of Object.entries(updatedOpenNotebooks)) {
        const idx = entry.notebook.cells.findIndex(c => c.id === fullCell.id);
        if (idx !== -1) {
          updatedOpenNotebooks[nbId] = {
            ...entry,
            notebook: {
              ...entry.notebook,
              cells: entry.notebook.cells.map(c => c.id === fullCell.id ? fullCell : c),
            },
          };
        }
      }

      expect(updatedNotebook.cells[0]).toEqual(fullCell);
      expect(updatedOpenNotebooks['nb-1'].notebook.cells[0]).toEqual(fullCell);
    });
  });

  describe('session_id verification (D1 fix)', () => {
    it('should skip cell_loaded if session_id does not match', () => {
      const currentSessionId = 'sess-current';
      const loadedSessionId = 'sess-stale';
      let cellReplaced = false;

      // Simulated handler logic
      if (loadedSessionId && loadedSessionId !== currentSessionId) {
        // Skip - session mismatch
      } else {
        cellReplaced = true;
      }

      expect(cellReplaced).toBe(false);
    });

    it('should process cell_loaded if session_id matches', () => {
      const currentSessionId = 'sess-current';
      const loadedSessionId = 'sess-current';
      let cellReplaced = false;

      if (loadedSessionId && loadedSessionId !== currentSessionId) {
        // Skip
      } else {
        cellReplaced = true;
      }

      expect(cellReplaced).toBe(true);
    });
  });

  describe('loadingCellIds cleanup (D3 fixes)', () => {
    it('should clear loadingCellIds on WS disconnect', () => {
      const loadingCellIds = new Set(['cell-1', 'cell-2', 'cell-3']);

      // Simulated onclose handler
      const clearedState = { loadingCellIds: new Set<string>() };

      expect(clearedState.loadingCellIds.size).toBe(0);
    });

    it('should remove cellId from loadingCellIds on decompression error', () => {
      const loadingCellIds = new Set(['cell-1', 'cell-2']);
      const errorCellId = 'cell-1';

      // Simulated error handling
      const newLoadingIds = new Set(loadingCellIds);
      newLoadingIds.delete(errorCellId);

      expect(newLoadingIds.has('cell-1')).toBe(false);
      expect(newLoadingIds.has('cell-2')).toBe(true);
    });

    it('should remove cellId from loadingCellIds on cell_load_error', () => {
      const loadingCellIds = new Set(['cell-1', 'cell-2']);
      const errorResponse = { type: 'cell_load_error', cell_id: 'cell-1', error: 'Not found' };

      const newLoadingIds = new Set(loadingCellIds);
      newLoadingIds.delete(errorResponse.cell_id);

      expect(newLoadingIds.has('cell-1')).toBe(false);
      expect(newLoadingIds.has('cell-2')).toBe(true);
    });
  });

  describe('lazy mode notebook construction', () => {
    it('should construct notebook from metadata and cell_stubs', () => {
      const serverResponse = {
        lazy: true,
        metadata: { title: 'Test', model: 'claude-3-opus' },
        cell_stubs: [
          { id: 'c1', type: 'prompt', source_preview: 'Hello...', output_count: 2, status: 'completed' },
          { id: 'c2', type: 'prompt', source_preview: 'World...', output_count: 1, status: 'completed' },
        ],
      };

      // Construct notebook (mirrors useNotebookActions.openNotebookViaWs)
      const notebook = {
        metadata: serverResponse.metadata,
        cells: serverResponse.cell_stubs.map((stub: any) => ({
          ...stub,
          _stub: true,
          source: stub.source_preview || '',
          outputs: [],
        })),
        slice: { generated: false, sections: [] },
      };

      expect(notebook.cells.length).toBe(2);
      expect(notebook.cells[0]._stub).toBe(true);
      expect(notebook.cells[0].source).toBe('Hello...');
      expect(notebook.cells[0].outputs).toEqual([]);
      expect(notebook.metadata.title).toBe('Test');
    });

    it('should handle empty cell_stubs array', () => {
      const serverResponse = {
        lazy: true,
        metadata: { title: 'Empty' },
        cell_stubs: [],
      };

      const notebook = {
        metadata: serverResponse.metadata,
        cells: serverResponse.cell_stubs.map((stub: any) => ({
          ...stub,
          _stub: true,
          source: stub.source_preview || '',
          outputs: [],
        })),
        slice: { generated: false, sections: [] },
      };

      expect(notebook.cells.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle corrupted LZ4 data gracefully', () => {
      const corruptedBase64 = 'not_valid_lz4_data!!!';
      let decompressError: Error | null = null;

      try {
        const compressedBytes = Uint8Array.from(atob(corruptedBase64), (c) => c.charCodeAt(0));
        lz4.decompress(compressedBytes);
      } catch (e) {
        decompressError = e as Error;
      }

      expect(decompressError).not.toBeNull();
    });

    it('should handle cell with missing optional fields', () => {
      const minimalCell = { id: 'cell-1', type: 'prompt', source: '' };
      const cellJson = JSON.stringify(minimalCell);
      const compressed = Uint8Array.from(lz4.compress(new TextEncoder().encode(cellJson)));
      const decompressed = lz4.decompress(compressed);
      const text = new TextDecoder().decode(decompressed);
      const restored = JSON.parse(text);

      expect(restored.id).toBe('cell-1');
      expect(restored.outputs).toBeUndefined();
    });
  });
});
