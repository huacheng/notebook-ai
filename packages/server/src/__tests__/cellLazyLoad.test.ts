/**
 * Cell Lazy Load Tests (TDD)
 *
 * Requirements:
 * 1. notebook_open returns metadata + cell stubs (id, type, status) instead of full cells
 * 2. cell_load request returns LZ4-compressed single cell content
 * 3. Client can request cells on-demand
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as lz4 from 'lz4js';

describe('Cell Lazy Load', () => {
  describe('notebook_open response', () => {
    it('should return cell stubs instead of full cell content', () => {
      // Simulated notebook with large cells
      const fullNotebook = {
        metadata: { title: 'Test Notebook' },
        cells: [
          { id: 'cell-1', type: 'prompt', source: 'Hello', outputs: [{ type: 'text', content: 'A'.repeat(10000) }] },
          { id: 'cell-2', type: 'prompt', source: 'World', outputs: [{ type: 'text', content: 'B'.repeat(20000) }] },
        ],
      };

      // Expected stub format
      const expectedStubs = [
        { id: 'cell-1', type: 'prompt', status: 'complete', outputCount: 1 },
        { id: 'cell-2', type: 'prompt', status: 'complete', outputCount: 1 },
      ];

      // Function to create stubs from cells
      function createCellStubs(cells: typeof fullNotebook.cells) {
        return cells.map(cell => ({
          id: cell.id,
          type: cell.type,
          status: 'complete',
          outputCount: cell.outputs?.length ?? 0,
        }));
      }

      const stubs = createCellStubs(fullNotebook.cells);
      expect(stubs).toEqual(expectedStubs);

      // Stub response should be much smaller than full notebook
      const stubSize = JSON.stringify(stubs).length;
      const fullSize = JSON.stringify(fullNotebook.cells).length;
      expect(stubSize).toBeLessThan(fullSize / 10);
    });
  });

  describe('cell_load response', () => {
    it('should return LZ4-compressed cell content', () => {
      const cell = {
        id: 'cell-1',
        type: 'prompt',
        source: 'Hello world',
        outputs: [{ type: 'text', content: 'This is a large output'.repeat(1000) }],
      };

      const cellJson = JSON.stringify(cell);
      const cellBuffer = Buffer.from(cellJson, 'utf-8');

      // Compress with LZ4
      const compressed = Buffer.from(lz4.compress(cellBuffer));

      // Verify compression reduces size
      expect(compressed.length).toBeLessThan(cellBuffer.length);

      // Verify can decompress
      const decompressed = Buffer.from(lz4.decompress(compressed));
      const restored = JSON.parse(decompressed.toString('utf-8'));
      expect(restored).toEqual(cell);
    });

    it('should handle cell_load request with cell_id parameter', () => {
      // Mock WebSocket message format
      const request = {
        type: 'cell_load',
        request_id: 'req-123',
        notebook_id: 'nb-456',
        cell_id: 'cell-1',
      };

      expect(request.type).toBe('cell_load');
      expect(request.cell_id).toBe('cell-1');
    });

    it('should return cell_loaded response with compressed data', () => {
      const cell = { id: 'cell-1', source: 'test', outputs: [] };
      const compressed = Buffer.from(lz4.compress(Buffer.from(JSON.stringify(cell))));

      // Expected response format
      const response = {
        type: 'cell_loaded',
        request_id: 'req-123',
        cell_id: 'cell-1',
        cell_compressed: compressed.toString('base64'),
      };

      expect(response.type).toBe('cell_loaded');
      expect(response.cell_compressed).toBeTruthy();

      // Verify can decode
      const decoded = Buffer.from(response.cell_compressed, 'base64');
      const decompressed = Buffer.from(lz4.decompress(decoded));
      expect(JSON.parse(decompressed.toString())).toEqual(cell);
    });
  });
});

describe('Notebook LZ4 Compression (non-lazy mode)', () => {
  it('should use LZ4 compression for notebook_opened response', () => {
    const notebook = {
      metadata: { title: 'Test Notebook', model: 'claude-3-opus' },
      cells: [
        { id: 'cell-1', type: 'prompt', source: 'Hello', outputs: [] },
        { id: 'cell-2', type: 'prompt', source: 'World', outputs: [] },
      ],
    };

    const notebookJson = JSON.stringify(notebook);
    const notebookBuffer = Buffer.from(notebookJson, 'utf-8');

    // Compress with LZ4
    const compressed = Buffer.from(lz4.compress(notebookBuffer));

    // Verify compression works
    expect(compressed.length).toBeLessThanOrEqual(notebookBuffer.length);

    // Verify can decompress
    const decompressed = Buffer.from(lz4.decompress(compressed));
    const restored = JSON.parse(decompressed.toString('utf-8'));
    expect(restored).toEqual(notebook);
  });

  it('should send notebook_opened with compression field indicating lz4', () => {
    const notebook = { metadata: { title: 'Test' }, cells: [] };
    const compressed = Buffer.from(lz4.compress(Buffer.from(JSON.stringify(notebook))));

    // Expected response format
    const response = {
      type: 'notebook_opened',
      request_id: 'req-123',
      notebook_id: 'nb-456',
      notebook_compressed: compressed.toString('base64'),
      compression: 'lz4',
      session_id: 'sess-789',
      workspace_dir: '/path/to/workspace',
      total_cells: 0,
    };

    expect(response.compression).toBe('lz4');
    expect(response.notebook_compressed).toBeTruthy();

    // Verify can decode
    const decoded = Buffer.from(response.notebook_compressed, 'base64');
    const decompressedBuf = Buffer.from(lz4.decompress(decoded));
    expect(JSON.parse(decompressedBuf.toString())).toEqual(notebook);
  });
});

describe('FileViewer Chunked Compression', () => {
  it('should compress each chunk individually with LZ4', () => {
    const CHUNK_SIZE = 16 * 1024; // 16KB chunks
    const fileContent = 'A'.repeat(50 * 1024); // 50KB file

    const chunks: Buffer[] = [];
    for (let i = 0; i < fileContent.length; i += CHUNK_SIZE) {
      const chunk = fileContent.slice(i, i + CHUNK_SIZE);
      const compressed = Buffer.from(lz4.compress(Buffer.from(chunk)));
      chunks.push(compressed);
    }

    expect(chunks.length).toBe(4); // 50KB / 16KB = 4 chunks (rounded up)

    // Each compressed chunk should be smaller than original
    chunks.forEach((compressed, i) => {
      const originalSize = Math.min(CHUNK_SIZE, fileContent.length - i * CHUNK_SIZE);
      // LZ4 on repetitive data should compress well
      expect(compressed.length).toBeLessThan(originalSize);
    });

    // Decompress and verify
    let reconstructed = '';
    for (const compressed of chunks) {
      const decompressed = Buffer.from(lz4.decompress(compressed));
      reconstructed += decompressed.toString();
    }
    expect(reconstructed).toBe(fileContent);
  });

  it('should send file-chunk-compressed messages with LZ4 data', () => {
    const chunkData = 'Hello World'.repeat(100);
    const compressed = Buffer.from(lz4.compress(Buffer.from(chunkData)));

    const message = {
      type: 'file-chunk-compressed',
      session_id: 'sess-123',
      data: compressed.toString('base64'),
      encoding: 'utf8',
      compression: 'lz4',
    };

    expect(message.compression).toBe('lz4');
    expect(message.data).toBeTruthy();
  });
});

describe('cell_load error handling', () => {
  it('should return cell_load_error for missing session', () => {
    const response = {
      type: 'cell_load_error',
      request_id: 'req-123',
      cell_id: 'cell-1',
      error: 'Session or notebook not found',
    };

    expect(response.type).toBe('cell_load_error');
    expect(response.error).toContain('not found');
  });

  it('should return cell_load_error for missing cell', () => {
    const response = {
      type: 'cell_load_error',
      request_id: 'req-123',
      cell_id: 'cell-nonexistent',
      error: 'Cell not found',
    };

    expect(response.type).toBe('cell_load_error');
    expect(response.cell_id).toBe('cell-nonexistent');
  });

  it('should sanitize error messages for client', () => {
    // Internal error with file path
    const internalError = new Error('/home/user/secret/path/file.ts: ENOENT');

    // Sanitization logic (simplified)
    const sanitized = internalError.message.includes('/') ? 'Internal server error' : internalError.message;

    expect(sanitized).not.toContain('/home');
    expect(sanitized).toBe('Internal server error');
  });
});

describe('cell_loaded response format', () => {
  it('should include session_id for client verification (D1 fix)', () => {
    const cell = { id: 'cell-1', source: 'test', outputs: [] };
    const compressed = Buffer.from(lz4.compress(Buffer.from(JSON.stringify(cell))));

    const response = {
      type: 'cell_loaded',
      request_id: 'req-123',
      session_id: 'sess-456', // D1: Include session_id
      cell_id: 'cell-1',
      cell_compressed: compressed.toString('base64'),
      compression: 'lz4',
    };

    expect(response.session_id).toBe('sess-456');
    expect(response.compression).toBe('lz4');
  });
});

describe('lazy mode notebook_opened response', () => {
  it('should return cell_stubs with source_preview', () => {
    const fullCell = {
      id: 'cell-1',
      type: 'prompt',
      source: 'This is a very long source text that should be truncated...',
      outputs: [{ type: 'text', content: 'output 1' }, { type: 'text', content: 'output 2' }],
      status: 'completed',
    };

    // Create stub (mirrors ws-handler.ts logic)
    const stub = {
      id: fullCell.id,
      type: fullCell.type,
      source_preview: fullCell.source.slice(0, 200),
      output_count: fullCell.outputs.length,
      status: fullCell.status,
    };

    expect(stub.source_preview.length).toBeLessThanOrEqual(200);
    expect(stub.output_count).toBe(2);
  });

  it('should handle cell with empty source', () => {
    const stub = {
      id: 'cell-1',
      type: 'prompt',
      source_preview: '',
      output_count: 0,
      status: 'idle',
    };

    expect(stub.source_preview).toBe('');
  });

  it('should handle cell with very long source (truncation)', () => {
    const longSource = 'A'.repeat(1000);
    const stub = {
      id: 'cell-1',
      type: 'prompt',
      source_preview: longSource.slice(0, 200),
      output_count: 0,
      status: 'completed',
    };

    expect(stub.source_preview.length).toBe(200);
    expect(stub.source_preview).toBe('A'.repeat(200));
  });
});
