import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../auth.ts'),
  'utf-8',
);

/**
 * P1-8: handleVerify and handleWsTicket should NOT use rate limiting
 * because they use 64-char random tokens that cannot be brute-forced.
 * Rate limiting only applies to login/register (password-based).
 */
describe('Auth rate limiting on verify/ws-ticket (P1-8)', () => {
  it('handleVerify should NOT call checkRateLimit (64-char token is brute-force proof)', () => {
    const start = src.indexOf('function handleVerify');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 1500);
    expect(block).not.toContain('checkRateLimit');
  });

  it('handleVerify should NOT call recordFailure (token expiry is normal)', () => {
    const start = src.indexOf('function handleVerify');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 1500);
    expect(block).not.toContain('recordFailure');
  });

  it('handleWsTicket should NOT call checkRateLimit (requires valid session token)', () => {
    const start = src.indexOf('function handleWsTicket');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 1500);
    expect(block).not.toContain('checkRateLimit');
  });

  it('handleWsTicket should NOT call recordFailure (already authenticated)', () => {
    const start = src.indexOf('function handleWsTicket');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 1500);
    expect(block).not.toContain('recordFailure');
  });
});
