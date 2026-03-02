import { describe, it, expect, vi } from 'vitest';
import { createWsTicket, consumeWsTicket } from '../auth.js';

describe('ws-ticket', () => {
  const testUserId = 'test-user-123';

  it('createWsTicket returns unique tickets', () => {
    const t1 = createWsTicket(testUserId);
    const t2 = createWsTicket(testUserId);
    expect(t1).not.toBe(t2);
    expect(typeof t1).toBe('string');
    expect(t1.length).toBeGreaterThan(0);
  });

  it('consumeWsTicket succeeds for a valid ticket', () => {
    const ticket = createWsTicket(testUserId);
    const result = consumeWsTicket(ticket);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe(testUserId);
  });

  it('consumeWsTicket fails on reuse (one-time)', () => {
    const ticket = createWsTicket(testUserId);
    const first = consumeWsTicket(ticket);
    const second = consumeWsTicket(ticket);
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(false);
  });

  it('consumeWsTicket fails after expiry', () => {
    vi.useFakeTimers();
    try {
      const ticket = createWsTicket(testUserId);
      // Advance past TTL (30s)
      vi.advanceTimersByTime(31_000);
      const result = consumeWsTicket(ticket);
      expect(result.valid).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
