/**
 * sessionRestart tests — restartSession action + WS response handling.
 */

import { describe, it, expect, vi } from 'vitest';
import { createWsSlice } from '../store/wsSlice';

function createTestWsSlice() {
  let state: Record<string, any> = {};

  const set = (update: any) => {
    if (typeof update === 'function') {
      Object.assign(state, update(state));
    } else {
      Object.assign(state, update);
    }
  };

  const get = () => state as any;

  const slice = createWsSlice(set as any, get, {} as any);
  Object.assign(state, slice);

  return { state, set, get };
}

describe('restartSession', () => {
  it('should send restart_session WS message', () => {
    const { state } = createTestWsSlice();
    const sendFn = vi.fn();

    // Mock a connected WebSocket
    state.ws = { readyState: WebSocket.OPEN, send: sendFn } as any;
    state.sessionId = 'nb-abc123';

    state.restartSession();

    expect(sendFn).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendFn.mock.calls[0][0]);
    expect(sent).toEqual({
      type: 'restart_session',
      session_id: 'nb-abc123',
    });
  });

  it('should set sessionRestarting to true when called', () => {
    const { state } = createTestWsSlice();
    const sendFn = vi.fn();

    state.ws = { readyState: WebSocket.OPEN, send: sendFn } as any;
    state.sessionId = 'nb-abc123';

    state.restartSession();

    expect(state.sessionRestarting).toBe(true);
  });

  it('should not send if WS is not connected', () => {
    const { state } = createTestWsSlice();
    const sendFn = vi.fn();

    state.ws = { readyState: WebSocket.CLOSED, send: sendFn } as any;
    state.sessionId = 'nb-abc123';

    state.restartSession();

    expect(sendFn).not.toHaveBeenCalled();
  });
});
