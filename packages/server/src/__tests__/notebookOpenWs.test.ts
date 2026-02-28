import { describe, it, expect } from 'vitest';

/**
 * Task A: Notebook Open via WebSocket — schema + openNotebookByPath tests
 */

describe('NotebookOpen WS schemas', () => {
  it('NotebookOpenSchema accepts a valid message', async () => {
    const { NotebookOpenSchema } = await import('@notebook-ai/shared');
    const msg = { type: 'notebook_open', request_id: 'abc-123', path: '/home/test/my.notebook.json' };
    const result = NotebookOpenSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('NotebookOpenSchema rejects missing request_id', async () => {
    const { NotebookOpenSchema } = await import('@notebook-ai/shared');
    const msg = { type: 'notebook_open', path: '/home/test/my.notebook.json' };
    const result = NotebookOpenSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('NotebookOpenedSchema accepts a valid response', async () => {
    const { NotebookOpenedSchema } = await import('@notebook-ai/shared');
    const msg = {
      type: 'notebook_opened',
      request_id: 'abc-123',
      notebook_id: 'nb-1',
      notebook: {
        version: 1,
        metadata: { title: 'Test', created: '2024-01-01T00:00:00Z' },
        cells: [],
        slice: { generated: false, sections: [] },
        annotations: [],
        assets: { intermediate_files: [] },
      },
      session_id: 'sess-1',
      workspace_dir: '/home/test',
      total_cells: 0,
    };
    const result = NotebookOpenedSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('NotebookOpenedSchema requires total_cells field', async () => {
    const { NotebookOpenedSchema } = await import('@notebook-ai/shared');
    const msg = {
      type: 'notebook_opened',
      request_id: 'abc-123',
      notebook_id: 'nb-1',
      notebook: {
        version: 1,
        metadata: { title: 'Test', created: '2024-01-01T00:00:00Z' },
        cells: [],
        slice: { generated: false, sections: [] },
        annotations: [],
        assets: { intermediate_files: [] },
      },
      session_id: 'sess-1',
      workspace_dir: '/home/test',
      // missing total_cells
    };
    const result = NotebookOpenedSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('NotebookOpenErrorSchema accepts an error response', async () => {
    const { NotebookOpenErrorSchema } = await import('@notebook-ai/shared');
    const msg = { type: 'notebook_open_error', request_id: 'abc-123', error: 'File not found' };
    const result = NotebookOpenErrorSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });
});

describe('openNotebookByPath()', () => {
  it('opens an existing notebook and returns notebook data', async () => {
    const { openNotebookByPath } = await import('../routes/notebooks.js');
    expect(typeof openNotebookByPath).toBe('function');
  });

  it('throws on non-existent path', async () => {
    const { openNotebookByPath } = await import('../routes/notebooks.js');
    // Create minimal mocks
    const mockDb = {
      listNotebooks: () => [],
      createNotebook: () => {},
      createSessionRecord: () => {},
    } as any;
    const mockStore = {
      load: () => Promise.reject(new Error('File not found')),
    } as any;
    const mockSessionManager = {} as any;

    await expect(
      openNotebookByPath('/no/such/file.notebook.json', mockDb, mockStore, mockSessionManager),
    ).rejects.toThrow();
  });
});
