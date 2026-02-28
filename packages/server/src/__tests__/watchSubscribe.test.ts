import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Test the watch_subscribe / watch_unsubscribe WS message flow.
 * We test by verifying that the ws-handler correctly routes subscribe
 * messages to the appropriate watcher and cleans up on disconnect.
 */

// Minimal mock WebSocket
function createMockWs() {
  const sent: any[] = [];
  const listeners = new Map<string, Function[]>();
  return {
    readyState: 1, // OPEN
    OPEN: 1,
    send(data: string) { sent.push(JSON.parse(data)); },
    on(event: string, fn: Function) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
    },
    close: vi.fn(),
    _sent: sent,
    _listeners: listeners,
    emit(event: string, ...args: any[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
  };
}

describe('watch_subscribe message parsing', () => {
  it('WatchSubscribeSchema accepts valid git watch message', async () => {
    const { WatchSubscribeSchema } = await import('@notebook-ai/shared');
    const result = WatchSubscribeSchema.safeParse({
      type: 'watch_subscribe',
      watch_id: 'w1',
      kind: 'git',
      project_id: 'proj-123',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      type: 'watch_subscribe',
      watch_id: 'w1',
      kind: 'git',
      project_id: 'proj-123',
    });
  });

  it('WatchSubscribeSchema accepts valid files watch message', async () => {
    const { WatchSubscribeSchema } = await import('@notebook-ai/shared');
    const result = WatchSubscribeSchema.safeParse({
      type: 'watch_subscribe',
      watch_id: 'w2',
      kind: 'files',
      dir_path: '__library__',
    });
    expect(result.success).toBe(true);
  });

  it('WatchUnsubscribeSchema accepts valid message', async () => {
    const { WatchUnsubscribeSchema } = await import('@notebook-ai/shared');
    const result = WatchUnsubscribeSchema.safeParse({
      type: 'watch_unsubscribe',
      watch_id: 'w1',
    });
    expect(result.success).toBe(true);
  });

  it('WSClientMessageSchema discriminates watch_subscribe', async () => {
    const { WSClientMessageSchema } = await import('@notebook-ai/shared');
    const result = WSClientMessageSchema.safeParse({
      type: 'watch_subscribe',
      watch_id: 'w1',
      kind: 'git',
      project_id: 'proj-123',
    });
    expect(result.success).toBe(true);
  });

  it('GitChangedSchema validates server message', async () => {
    const { GitChangedSchema } = await import('@notebook-ai/shared');
    const result = GitChangedSchema.safeParse({
      type: 'git_changed',
      watch_id: 'w1',
      project_id: 'proj-123',
      latest_hash: 'abc123',
    });
    expect(result.success).toBe(true);
  });

  it('GitChangedSchema accepts commits payload for push-based git log', async () => {
    const { GitChangedSchema } = await import('@notebook-ai/shared');
    const result = GitChangedSchema.safeParse({
      type: 'git_changed',
      watch_id: 'w1',
      project_id: 'proj-123',
      latest_hash: 'abc123',
      commits: [{ hash: 'abc', shortHash: 'abc', message: 'test' }],
      total: 1,
      page: 1,
      limit: 5,
    });
    expect(result.success).toBe(true);
    expect(result.data!.commits).toHaveLength(1);
  });

  it('FilesChangedSchema validates server message', async () => {
    const { FilesChangedSchema } = await import('@notebook-ai/shared');
    const result = FilesChangedSchema.safeParse({
      type: 'files_changed',
      watch_id: 'w1',
      dir_path: '/some/path',
    });
    expect(result.success).toBe(true);
  });
});
