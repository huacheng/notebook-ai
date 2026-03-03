import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const componentSrc = readFileSync(
  path.resolve(__dirname, '../components/GitHistoryPanel.tsx'),
  'utf-8',
);

const hookSrc = readFileSync(
  path.resolve(__dirname, '../hooks/useWsRequest.ts'),
  'utf-8',
);

/**
 * R8-F5: CommitItem should prevent state updates after unmount when WS requests are pending.
 * This is now handled by the useWsRequest hook via cancelled flag pattern.
 */
describe('GitHistoryPanel mounted guard (R8-F5)', () => {
  it('CommitItem should use useWsRequest hook for safe async state updates', () => {
    const commitItemStart = componentSrc.indexOf('function CommitItem');
    const commitItemEnd = componentSrc.indexOf('\n});', commitItemStart);
    const block = componentSrc.slice(commitItemStart, commitItemEnd);
    // Should use useWsRequest hook (which handles unmount safety internally)
    expect(block).toMatch(/useWsRequest/);
  });

  it('useWsRequest hook should have cancelled flag pattern', () => {
    // Hook should have cancelled flag to prevent state updates after unmount
    expect(hookSrc).toMatch(/let cancelled\s*=\s*false/);
    // Hook should set cancelled=true in cleanup
    expect(hookSrc).toMatch(/cancelled\s*=\s*true/);
    // Hook should check cancelled before setState
    expect(hookSrc).toMatch(/if\s*\(\s*!cancelled\s*\)/);
  });
});
