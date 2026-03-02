import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../auth.ts'),
  'utf-8',
);

/**
 * P1-8: handleVerify and handleWsTicket should use checkRateLimit + recordFailure
 * to prevent brute-force attacks (same as handleLogin already does).
 */
describe('Auth rate limiting on verify/ws-ticket (P1-8)', () => {
  it('handleVerify should call checkRateLimit', () => {
    const start = src.indexOf('function handleVerify');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 1500);
    expect(block).toContain('checkRateLimit');
  });

  it('handleVerify should call recordFailure on auth failure', () => {
    const start = src.indexOf('function handleVerify');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 1500);
    expect(block).toContain('recordFailure');
  });

  it('handleWsTicket should call checkRateLimit', () => {
    const start = src.indexOf('function handleWsTicket');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 1500);
    expect(block).toContain('checkRateLimit');
  });

  it('handleWsTicket should call recordFailure on auth failure', () => {
    const start = src.indexOf('function handleWsTicket');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 1500);
    expect(block).toContain('recordFailure');
  });
});
