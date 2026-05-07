import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for openNotebookByPath utility — extracted shared logic
 * for opening .notebook.json files from both desktop and mobile.
 */

// Mock store
const mockState: Record<string, any> = {};
const mockSetState = vi.fn();
const mockGetState = vi.fn(() => mockState);

vi.mock('../store', () => ({
  useStore: Object.assign(() => null, {
    getState: () => mockGetState(),
    setState: (...args: any[]) => mockSetState(...args),
  }),
}));

// Import after mock
const { openNotebookByPath } = await import('../utils/openNotebookByPath');

// Mock window event listeners for WS test
const windowListeners: Record<string, Function[]> = {};
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    addEventListener: vi.fn((event: string, handler: Function) => {
      if (!windowListeners[event]) windowListeners[event] = [];
      windowListeners[event].push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: Function) => {
      if (windowListeners[event]) {
        windowListeners[event] = windowListeners[event].filter(h => h !== handler);
      }
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Clear window listeners
  Object.keys(windowListeners).forEach(k => delete windowListeners[k]);
  // Reset state
  Object.keys(mockState).forEach(k => delete mockState[k]);
  Object.assign(mockState, {
    openNotebooks: {},
    ws: null,
    authToken: 'tok',
    openNotebookTab: vi.fn(),
    setActiveNotebookTab: vi.fn(),
    deactivateFileTab: vi.fn(),
  });
});

describe('openNotebookByPath', () => {
  test('switches to existing tab if notebook already open', async () => {
    mockState.openNotebooks = {
      'nb-1': { notebook: {}, sessionId: 's1', scrollY: 0, workspaceDir: '/projects/demo' },
    };

    await openNotebookByPath('/projects/demo/task.notebook.json');

    expect(mockState.deactivateFileTab).toHaveBeenCalled();
    expect(mockState.setActiveNotebookTab).toHaveBeenCalledWith('nb-1');
    // Should NOT set notebookLoading
    expect(mockSetState).not.toHaveBeenCalledWith(expect.objectContaining({ notebookLoading: true }));
  });

  test('opens notebook via REST fallback when WS not available', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        notebookId: 'nb-2',      // camelCase — matches actual server response
        notebook: { cells: [] },
        sessionId: 's2',
        workspaceDir: '/projects/test',
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    await openNotebookByPath('/projects/test/my.notebook.json');

    expect(mockSetState).toHaveBeenCalledWith(expect.objectContaining({ notebookLoading: true }));
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(mockState.openNotebookTab).toHaveBeenCalledWith('nb-2', { cells: [] }, 's2', '/projects/test');
    // Note: subscribeToSession is now handled by useWebSocket hook when openNotebooks changes
    // notebookLoading cleared
    expect(mockSetState).toHaveBeenCalledWith(expect.objectContaining({ notebookLoading: false }));
  });

  test('sets sessionNotice on REST error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Not found'),
    });

    await openNotebookByPath('/projects/test/bad.notebook.json');

    // Should set error notice
    expect(mockSetState).toHaveBeenCalledWith(expect.objectContaining({
      notebookLoading: false,
      sessionNotice: expect.stringContaining('Not found'),
    }));
  });

  test('handles WS close during open by rejecting early', async () => {
    // Simulate WS that closes mid-operation
    const mockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    mockState.ws = mockWs;

    const promise = openNotebookByPath('/projects/test/ws.notebook.json');

    // Simulate WS close event
    const closeHandler = mockWs.addEventListener.mock.calls.find(
      (c: any[]) => c[0] === 'close'
    );
    expect(closeHandler).toBeTruthy();
    closeHandler[1](); // trigger close handler

    await promise;

    // Should set error notice
    expect(mockSetState).toHaveBeenCalledWith(expect.objectContaining({
      notebookLoading: false,
      sessionNotice: expect.stringContaining('disconnected'),
    }));
  });

  test('returns { switched: true } when switching to existing tab', async () => {
    mockState.openNotebooks = {
      'nb-x': { notebook: {}, sessionId: 'sx', scrollY: 0, workspaceDir: '/proj/a' },
    };

    const result = await openNotebookByPath('/proj/a/t.notebook.json');
    expect(result).toEqual({ switched: true, notebookId: 'nb-x' });
  });

  test('returns { opened: true } on successful open', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        notebookId: 'nb-new',
        notebook: { cells: [] },
        sessionId: 'snew',
        workspaceDir: '/proj/b',
      }),
    });

    const result = await openNotebookByPath('/proj/b/new.notebook.json');
    expect(result).toEqual({ opened: true, notebookId: 'nb-new' });
  });

  test('sets cellsOffset correctly based on totalCells from REST response', async () => {
    // Server returns totalCells=100 but only 2 cells (last page)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        notebookId: 'nb-paged',
        notebook: { cells: [{ id: 'c1' }, { id: 'c2' }] },
        sessionId: 's-paged',
        workspaceDir: '/proj/paged',
        totalCells: 100,
      }),
    });

    await openNotebookByPath('/proj/paged/big.notebook.json');

    // cellsOffset should be 100 - 2 = 98
    expect(mockSetState).toHaveBeenCalledWith(expect.objectContaining({
      cellsOffset: 98,
      loadingOlderCells: false,
    }));
  });

  test('sets cellsOffset to 0 when totalCells equals cells.length', async () => {
    // All cells returned — no pagination needed
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        notebookId: 'nb-small',
        notebook: { cells: [{ id: 'c1' }] },
        sessionId: 's-small',
        workspaceDir: '/proj/small',
        totalCells: 1,
      }),
    });

    await openNotebookByPath('/proj/small/small.notebook.json');

    expect(mockSetState).toHaveBeenCalledWith(expect.objectContaining({
      cellsOffset: 0,
    }));
  });

  test('sets cellsOffset via WS total_cells field', async () => {
    // Mock WS
    const mockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    mockState.ws = mockWs;

    const promise = openNotebookByPath('/proj/ws/nb.notebook.json');

    // Simulate WS response with total_cells (snake_case from server)
    await new Promise(resolve => setTimeout(resolve, 10));
    const onOpened = windowListeners['nb:notebook-opened']?.[0];
    expect(onOpened).toBeTruthy();
    onOpened(new CustomEvent('nb:notebook-opened', {
      detail: {
        request_id: mockWs.send.mock.calls[0][0] && JSON.parse(mockWs.send.mock.calls[0][0]).request_id,
        notebook_id: 'nb-ws',
        notebook: { cells: [{ id: 'c1' }, { id: 'c2' }] },
        session_id: 's-ws',
        workspace_dir: '/proj/ws',
        total_cells: 50,
      },
    }));

    await promise;

    // cellsOffset should be 50 - 2 = 48
    expect(mockSetState).toHaveBeenCalledWith(expect.objectContaining({
      cellsOffset: 48,
      loadingOlderCells: false,
    }));
  });

  test('clamps cellsOffset to 0 when totalCells is less than cells.length', async () => {
    // Edge case: server returns fewer totalCells than actual cells (data inconsistency)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        notebookId: 'nb-edge',
        notebook: { cells: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] },
        sessionId: 's-edge',
        workspaceDir: '/proj/edge',
        totalCells: 1, // Less than cells.length (3)
      }),
    });

    await openNotebookByPath('/proj/edge/edge.notebook.json');

    // cellsOffset should be clamped to 0, not negative (-2)
    expect(mockSetState).toHaveBeenCalledWith(expect.objectContaining({
      cellsOffset: 0,
    }));
  });
});
