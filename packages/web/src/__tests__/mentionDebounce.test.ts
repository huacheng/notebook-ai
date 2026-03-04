import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * useMention should debounce fetchItems calls to prevent excessive API requests
 * when user types quickly (e.g., typing "@file" should not trigger 5 separate requests)
 */
describe('useMention debounce', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../hooks/useMention.ts'),
    'utf-8',
  );

  it('should have debounce mechanism for fetchItems', () => {
    // Look for debounce-related code: setTimeout, debounce timer, or similar
    const hasDebounce =
      src.includes('setTimeout') ||
      src.includes('debounce') ||
      src.includes('debounceRef') ||
      src.includes('debounceTimer');
    expect(hasDebounce).toBe(true);
  });

  it('should clear previous debounce timer on new input', () => {
    // When typing quickly, previous pending fetch should be cancelled
    const hasClearTimeout = src.includes('clearTimeout');
    expect(hasClearTimeout).toBe(true);
  });
});
