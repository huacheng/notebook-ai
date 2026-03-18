/**
 * Test: Session error should clear subscribing status
 *
 * Bug: When server returns error (e.g., "Session not found"), the
 * sessionReadyStatus remains 'subscribing' and spinner keeps spinning.
 *
 * Fix: Clear sessionReadyStatus on session-related errors.
 */
import { describe, it, expect } from 'vitest';

type SessionReadyStatus = Record<string, 'subscribing' | 'ready'>;

/**
 * Logic extracted from wsSlice error handling:
 * When error received for a session that is 'subscribing', remove it from status.
 */
function handleSessionError(
  sessionReadyStatus: SessionReadyStatus,
  msgSessionId: string | undefined
): SessionReadyStatus {
  if (msgSessionId && sessionReadyStatus[msgSessionId] === 'subscribing') {
    const { [msgSessionId]: _, ...rest } = sessionReadyStatus;
    return rest;
  }
  return sessionReadyStatus;
}

describe('Session error clears subscribing status', () => {
  it('clears sessionReadyStatus when error received for subscribing session', () => {
    const status: SessionReadyStatus = { 'test-session': 'subscribing' };
    const result = handleSessionError(status, 'test-session');
    expect(result['test-session']).toBeUndefined();
  });

  it('does not affect other sessions', () => {
    const status: SessionReadyStatus = {
      'test-session': 'subscribing',
      'other-session': 'ready',
    };
    const result = handleSessionError(status, 'test-session');
    expect(result['test-session']).toBeUndefined();
    expect(result['other-session']).toBe('ready');
  });

  it('does not clear status if session is already ready', () => {
    const status: SessionReadyStatus = { 'test-session': 'ready' };
    const result = handleSessionError(status, 'test-session');
    expect(result['test-session']).toBe('ready');
  });

  it('does not clear status if msgSessionId is undefined', () => {
    const status: SessionReadyStatus = { 'test-session': 'subscribing' };
    const result = handleSessionError(status, undefined);
    expect(result['test-session']).toBe('subscribing');
  });
});
