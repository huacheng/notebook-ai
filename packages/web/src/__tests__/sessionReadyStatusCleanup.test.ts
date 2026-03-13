import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Regression test for R1: sessionReadyStatus should be cleaned up on unsubscribe
 *
 * When a notebook tab is closed, unsubscribeFromSession is called. This should
 * clean up the sessionReadyStatus entry to prevent memory leak.
 */

// Mock dependencies
vi.mock('../store/authSlice', () => ({
  createAuthSlice: () => ({
    authToken: null,
    authRequired: null,
  }),
}));

describe('sessionReadyStatus cleanup on unsubscribe', () => {
  let mockWs: { send: ReturnType<typeof vi.fn>; readyState: number };

  beforeEach(async () => {
    vi.resetModules();
    mockWs = {
      send: vi.fn(),
      readyState: WebSocket.OPEN,
    };
  });

  test('should clean up sessionReadyStatus when unsubscribing', async () => {
    const { useStore } = await import('../store');

    // Set up state with an existing session status
    useStore.setState({
      ws: mockWs as unknown as WebSocket,
      sessionReadyStatus: {
        'session-1': 'ready',
        'session-2': 'subscribing',
      },
      lastEventIndex: {
        'session-1': 5,
      },
    });

    // Unsubscribe from session-1
    useStore.getState().unsubscribeFromSession('session-1');

    // sessionReadyStatus should no longer contain session-1
    const status = useStore.getState().sessionReadyStatus;
    expect(status['session-1']).toBeUndefined();
    expect(status['session-2']).toBe('subscribing');
  });

  test('should clean up lastEventIndex when unsubscribing (existing behavior)', async () => {
    const { useStore } = await import('../store');

    useStore.setState({
      ws: mockWs as unknown as WebSocket,
      sessionReadyStatus: {},
      lastEventIndex: {
        'session-1': 5,
        'session-2': 10,
      },
    });

    useStore.getState().unsubscribeFromSession('session-1');

    // lastEventIndex should no longer contain session-1
    const idx = useStore.getState().lastEventIndex;
    expect(idx['session-1']).toBeUndefined();
    expect(idx['session-2']).toBe(10);
  });
});
