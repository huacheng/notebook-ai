import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../components/GitHistoryPanel.tsx'),
  'utf-8',
);

/**
 * R8-F5: CommitItem should have a mounted ref to prevent state updates
 * after unmount when WS requests are pending.
 */
describe('GitHistoryPanel mounted guard (R8-F5)', () => {
  it('CommitItem should track mounted state via useRef', () => {
    const commitItemStart = src.indexOf('function CommitItem');
    const commitItemEnd = src.indexOf('\n});', commitItemStart);
    const block = src.slice(commitItemStart, commitItemEnd);
    // Should have a mounted/unmounted ref pattern
    expect(block).toMatch(/mountedRef|unmountedRef/);
    // Should have a useEffect cleanup that sets it to false
    expect(block).toMatch(/\.current\s*=\s*false/);
  });
});
