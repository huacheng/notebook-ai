import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../store/wsSlice.ts'),
  'utf-8',
);

/**
 * P1-10: When ws-ticket fetch returns 401/403, the code enters an infinite
 * reconnect loop without notifying the user to re-authenticate.
 * Should detect auth failure and trigger logout.
 */
describe('WS ticket auth failure handling (P1-10)', () => {
  it('should check for 401/403 status and trigger logout on auth failure', () => {
    const ticketBlock = src.slice(
      src.indexOf('/api/auth/ws-ticket'),
      src.indexOf('wsUrl = `${protocol}'),
    );
    // Must check for auth error status codes
    expect(ticketBlock).toMatch(/401|403|logout|authToken.*null/);
  });
});
