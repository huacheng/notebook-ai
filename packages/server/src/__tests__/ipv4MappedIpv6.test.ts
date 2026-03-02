import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../url-capture.ts'),
  'utf-8',
);

/**
 * R8-S6: isPrivateIP must handle IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
 * to prevent SSRF bypass.
 */
describe('IPv4-mapped IPv6 SSRF bypass (R8-S6)', () => {
  it('isPrivateIP should handle ::ffff: prefix', () => {
    // The source must contain handling for ::ffff: IPv4-mapped addresses
    const fnStart = src.indexOf('function isPrivateIP');
    const fnEnd = src.indexOf('\n}', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/::ffff:/i);
  });
});
