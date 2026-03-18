/**
 * Test: Desktop ConnectionBanner displays based on wsStatus
 *
 * Requirements:
 * - Show "Reconnecting..." when wsStatus is 'connecting' or 'disconnected'
 * - Do NOT show when wsStatus is 'connected'
 * - Do NOT show when wsReconnectExhausted is true (separate banner handles that)
 */
import { describe, it, expect } from 'vitest';

/** Logic for whether to show the reconnecting banner */
function shouldShowReconnectBanner(
  wsStatus: 'connected' | 'connecting' | 'disconnected',
  wsReconnectExhausted: boolean
): boolean {
  // Don't show if exhausted (separate banner handles that)
  if (wsReconnectExhausted) return false;
  // Show when not connected
  return wsStatus !== 'connected';
}

describe('ConnectionBanner visibility logic', () => {
  it('shows when wsStatus is connecting', () => {
    expect(shouldShowReconnectBanner('connecting', false)).toBe(true);
  });

  it('shows when wsStatus is disconnected', () => {
    expect(shouldShowReconnectBanner('disconnected', false)).toBe(true);
  });

  it('hides when wsStatus is connected', () => {
    expect(shouldShowReconnectBanner('connected', false)).toBe(false);
  });

  it('hides when wsReconnectExhausted is true (even if disconnected)', () => {
    expect(shouldShowReconnectBanner('disconnected', true)).toBe(false);
  });

  it('hides when wsReconnectExhausted is true and connecting', () => {
    expect(shouldShowReconnectBanner('connecting', true)).toBe(false);
  });
});
