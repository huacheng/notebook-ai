import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Regression test for R2: Empty sessionId should not trigger subscription
 *
 * When a notebook tab is restored from cache after page refresh, sessionId
 * is empty string. The subscribeToSession should guard against this to
 * prevent wasteful WebSocket messages.
 */

// Mock dependencies
vi.mock('../store/authSlice', () => ({
  createAuthSlice: () => ({
    authToken: null,
    authRequired: null,
  }),
}));

describe('subscribeToSession empty sessionId guard', () => {
  let mockWs: { send: ReturnType<typeof vi.fn>; readyState: number };

  beforeEach(async () => {
    vi.resetModules();
    mockWs = {
      send: vi.fn(),
      readyState: WebSocket.OPEN,
    };
  });

  test('should NOT send subscribe message for empty sessionId', async () => {
    const { useStore } = await import('../store');

    // Set up mock WS
    useStore.setState({
      ws: mockWs as unknown as WebSocket,
      lastEventIndex: {},
      sessionReadyStatus: {},
    });

    // Call subscribeToSession with empty string
    useStore.getState().subscribeToSession('');

    // Should NOT have sent any messages
    expect(mockWs.send).not.toHaveBeenCalled();
  });

  test('should NOT update sessionReadyStatus for empty sessionId', async () => {
    const { useStore } = await import('../store');

    useStore.setState({
      ws: mockWs as unknown as WebSocket,
      lastEventIndex: {},
      sessionReadyStatus: {},
    });

    useStore.getState().subscribeToSession('');

    // sessionReadyStatus should remain empty
    expect(useStore.getState().sessionReadyStatus).toEqual({});
  });

  test('should still work for valid sessionId', async () => {
    const { useStore } = await import('../store');

    useStore.setState({
      ws: mockWs as unknown as WebSocket,
      lastEventIndex: {},
      sessionReadyStatus: {},
    });

    useStore.getState().subscribeToSession('valid-session-123');

    // Should have sent subscribe messages
    expect(mockWs.send).toHaveBeenCalled();
    expect(useStore.getState().sessionReadyStatus['valid-session-123']).toBe('subscribing');
  });
});
