import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../event-buffer.ts'),
  'utf-8',
);

/**
 * P1-6: EventBuffer uses Array.shift() which is O(N).
 * Should use a circular buffer with head/tail pointers for O(1) operations.
 */
describe('EventBuffer O(1) ring buffer (P1-6)', () => {
  it('should not use Array.shift() for eviction', () => {
    expect(src).not.toContain('.shift()');
  });

  it('should use circular index for O(1) insertion', () => {
    // Should have a head/tail/write pointer for circular buffer
    expect(src).toMatch(/head|tail|writeIdx|writePos/);
  });
});
