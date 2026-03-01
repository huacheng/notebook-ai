/**
 * Tests for submitToolResult WS action (sends tool_result_response via WebSocket).
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

describe('submitToolResult', () => {
  it('sends WS message with correct tool_result_response format', () => {
    const { state } = createTestWsSlice();
    const sendFn = vi.fn();

    state.ws = { readyState: WebSocket.OPEN, send: sendFn } as any;

    state.submitToolResult('nb-abc123', 'toolu_01abc', 'Python');

    expect(sendFn).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendFn.mock.calls[0][0]);
    expect(sent).toEqual({
      type: 'tool_result_response',
      session_id: 'nb-abc123',
      tool_use_id: 'toolu_01abc',
      content: 'Python',
    });
  });

  it('does not send if WS is not connected', () => {
    const { state } = createTestWsSlice();
    const sendFn = vi.fn();

    state.ws = { readyState: WebSocket.CLOSED, send: sendFn } as any;

    state.submitToolResult('nb-abc123', 'toolu_01abc', 'Python');

    expect(sendFn).not.toHaveBeenCalled();
  });
});
