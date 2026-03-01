import { describe, it, expect, vi } from 'vitest';
import { createWsTicket, consumeWsTicket } from '../auth.js';

describe('ws-ticket', () => {
  it('createWsTicket returns unique tickets', () => {
    const t1 = createWsTicket();
    const t2 = createWsTicket();
    expect(t1).not.toBe(t2);
    expect(typeof t1).toBe('string');
    expect(t1.length).toBeGreaterThan(0);
  });

  it('consumeWsTicket succeeds for a valid ticket', () => {
    const ticket = createWsTicket();
    expect(consumeWsTicket(ticket)).toBe(true);
  });

  it('consumeWsTicket fails on reuse (one-time)', () => {
    const ticket = createWsTicket();
    expect(consumeWsTicket(ticket)).toBe(true);
    expect(consumeWsTicket(ticket)).toBe(false);
  });

  it('consumeWsTicket fails after expiry', () => {
    vi.useFakeTimers();
    try {
      const ticket = createWsTicket();
      // Advance past TTL (30s)
      vi.advanceTimersByTime(31_000);
      expect(consumeWsTicket(ticket)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
