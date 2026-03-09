/**
 * Tests that timerTick skips sending CONTINUE when tool execution is pending
 * (e.g., sub-agent running). Sending CONTINUE while waiting for tool_result
 * is pointless and potentially disruptive.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('timerTick skips when tool execution is pending', () => {
  it('should check _pendingToolUseIds in timerTick before sending CONTINUE', () => {
    const src = sessionSrc();
    const timerTickMethod = src.match(/private timerTick\([\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(timerTickMethod).toBeTruthy();
    // timerTick should check _pendingToolUseIds.size > 0 and skip
    expect(timerTickMethod![0]).toContain('_pendingToolUseIds');
  });
});
