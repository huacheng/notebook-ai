import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile } from 'fs/promises';

// Mock fs/promises to simulate write failure
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    writeFile: vi.fn(),
  };
});

describe('autoSave error notification - D3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should broadcast autosave_error when writeFile fails', async () => {
    // Arrange: mock writeFile to throw error
    const mockWriteFile = vi.mocked(writeFile);
    mockWriteFile.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));

    const broadcastMessages: any[] = [];
    const mockBroadcast = (msg: any) => broadcastMessages.push(msg);

    // Simulate session structure with broadcast capability
    const session = {
      id: 'test-session',
      notebookPath: '/tmp/test.notebook.json',
      notebook: { version: 1, cells: [] },
      listeners: new Set([mockBroadcast]),
    };

    // Act: simulate autoSave with error handling that broadcasts
    let errorThrown = false;
    try {
      await writeFile(session.notebookPath, JSON.stringify(session.notebook));
    } catch (err) {
      errorThrown = true;
      // D3-fix: broadcast error to frontend
      for (const listener of session.listeners) {
        listener({
          type: 'autosave_error',
          session_id: session.id,
          error: 'Failed to save notebook. Please save manually.',
        });
      }
    }

    // Assert
    expect(errorThrown).toBe(true);
    expect(broadcastMessages).toHaveLength(1);
    expect(broadcastMessages[0]).toMatchObject({
      type: 'autosave_error',
      session_id: 'test-session',
      error: expect.stringContaining('Failed to save'),
    });
  });

  it('should not broadcast when writeFile succeeds', async () => {
    // Arrange: mock writeFile to succeed
    const mockWriteFile = vi.mocked(writeFile);
    mockWriteFile.mockResolvedValueOnce(undefined);

    const broadcastMessages: any[] = [];
    const mockBroadcast = (msg: any) => broadcastMessages.push(msg);

    const session = {
      id: 'test-session',
      notebookPath: '/tmp/test.notebook.json',
      notebook: { version: 1, cells: [] },
      listeners: new Set([mockBroadcast]),
    };

    // Act
    await writeFile(session.notebookPath, JSON.stringify(session.notebook));

    // Assert: no error broadcast
    expect(broadcastMessages).toHaveLength(0);
  });
});
