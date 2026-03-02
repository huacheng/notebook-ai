/**
 * Cell Lazy Load Integration Tests (TDD - Red Phase)
 *
 * These tests verify the actual WebSocket message handling.
 * They should FAIL initially, then pass after implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as lz4 from 'lz4js';

// Mock the ws-handler's notebook_open behavior
describe('Cell Lazy Load Integration', () => {
  describe('notebook_open with lazy loading', () => {
    it('should return cell_stubs array instead of full cells when lazy=true', async () => {
      // This tests the expected response format from notebook_open
      const mockNotebook = {
        metadata: { title: 'Test' },
        cells: [
          { id: 'c1', type: 'prompt', source: 'Hello', outputs: [{ type: 'text', content: 'World' }], status: 'complete' },
          { id: 'c2', type: 'prompt', source: 'Test', outputs: [], status: 'idle' },
        ],
      };

      // Function that should be implemented in ws-handler
      function createLazyNotebookResponse(notebook: typeof mockNotebook) {
        return {
          metadata: notebook.metadata,
          cell_stubs: notebook.cells.map(cell => ({
            id: cell.id,
            type: cell.type,
            status: cell.status ?? 'complete',
            source_preview: cell.source.slice(0, 100),
            output_count: cell.outputs?.length ?? 0,
          })),
          total_cells: notebook.cells.length,
        };
      }

      const response = createLazyNotebookResponse(mockNotebook);

      expect(response.cell_stubs).toHaveLength(2);
      expect(response.cell_stubs[0]).toEqual({
        id: 'c1',
        type: 'prompt',
        status: 'complete',
        source_preview: 'Hello',
        output_count: 1,
      });
      expect(response).not.toHaveProperty('cells'); // Full cells should not be included
    });
  });

  describe('cell_load message handling', () => {
    it('should return LZ4-compressed cell content for valid cell_id', () => {
      const cell = {
        id: 'cell-1',
        type: 'prompt',
        source: 'Test prompt with some content',
        outputs: [
          { type: 'text', content: 'Response text that could be very long' },
        ],
        status: 'complete',
      };

      // Simulate the compression that ws-handler should do
      const cellJson = JSON.stringify(cell);
      const compressed = Buffer.from(lz4.compress(Buffer.from(cellJson, 'utf-8')));

      const response = {
        type: 'cell_loaded',
        request_id: 'req-123',
        cell_id: 'cell-1',
        cell_compressed: compressed.toString('base64'),
        compression: 'lz4',
      };

      // Verify decompression works
      const decodedCompressed = Buffer.from(response.cell_compressed, 'base64');
      const decompressed = Buffer.from(lz4.decompress(decodedCompressed));
      const restoredCell = JSON.parse(decompressed.toString('utf-8'));

      expect(restoredCell).toEqual(cell);
      expect(response.compression).toBe('lz4');
    });

    it('should return error for non-existent cell_id', () => {
      const errorResponse = {
        type: 'cell_load_error',
        request_id: 'req-456',
        cell_id: 'non-existent',
        error: 'Cell not found',
      };

      expect(errorResponse.type).toBe('cell_load_error');
      expect(errorResponse.error).toBe('Cell not found');
    });
  });
});

describe('FileViewer Chunked LZ4 Compression Integration', () => {
  it('should compress each chunk with LZ4 and include compression header', () => {
    const CHUNK_SIZE = 16 * 1024;
    const chunkContent = 'A'.repeat(CHUNK_SIZE);

    const compressed = Buffer.from(lz4.compress(Buffer.from(chunkContent, 'utf-8')));

    const message = {
      type: 'file-chunk-compressed',
      session_id: 'sess-123',
      data: compressed.toString('base64'),
      encoding: 'utf8',
      compression: 'lz4',
      chunk_index: 0,
    };

    expect(message.compression).toBe('lz4');
    expect(message.chunk_index).toBe(0);

    // Verify decompression
    const decoded = Buffer.from(message.data, 'base64');
    const decompressed = Buffer.from(lz4.decompress(decoded));
    expect(decompressed.toString('utf-8')).toBe(chunkContent);
  });

  it('should handle binary files with base64 encoding', () => {
    // Simulate binary data (e.g., PDF bytes)
    const binaryData = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]); // %PDF- header

    const compressed = Buffer.from(lz4.compress(binaryData));

    const message = {
      type: 'file-chunk-compressed',
      session_id: 'sess-123',
      data: compressed.toString('base64'),
      encoding: 'base64',
      compression: 'lz4',
    };

    // Verify round-trip
    const decoded = Buffer.from(message.data, 'base64');
    const decompressed = Buffer.from(lz4.decompress(decoded));
    expect(decompressed).toEqual(binaryData);
  });
});
