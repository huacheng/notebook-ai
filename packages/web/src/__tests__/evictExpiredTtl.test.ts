import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../utils/localCache.ts'),
  'utf-8',
);

/**
 * R8-F6: evictExpired should use per-entry TTL instead of always DEFAULT_TTL.
 * CacheEntry should store ttl, and evictExpired should read it.
 */
describe('evictExpired per-entry TTL (R8-F6)', () => {
  it('CacheEntry interface should include a ttl field', () => {
    const interfaceBlock = src.slice(
      src.indexOf('interface CacheEntry'),
      src.indexOf('}', src.indexOf('interface CacheEntry')) + 1,
    );
    expect(interfaceBlock).toMatch(/ttl/);
  });

  it('evictExpired should use entry.ttl instead of DEFAULT_TTL', () => {
    const evictBlock = src.slice(
      src.indexOf('function evictExpired'),
      src.indexOf('\n}', src.indexOf('function evictExpired')) + 2,
    );
    // Should reference entry ttl, not just DEFAULT_TTL
    expect(evictBlock).toMatch(/entry\.ttl|\.ttl\s*\?\?/);
    // Should NOT use only DEFAULT_TTL for the comparison
    expect(evictBlock).not.toMatch(/>\s*DEFAULT_TTL\s*\)/);
  });
});
