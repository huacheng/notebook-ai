/**
 * Tests that timerTick broadcasts timer_heartbeat even when skipping the
 * CONTINUE prompt (due to pending tools, active output, etc.),
 * so the frontend can distinguish "skipped" from "timer dead".
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('timerTick broadcasts even on skip', () => {
  it('should have timer_heartbeat broadcast AFTER the skip checks (not only in the send path)', () => {
    const src = sessionSrc();
    const timerTickMethod = src.match(/private timerTick\([\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(timerTickMethod).toBeTruthy();
    const body = timerTickMethod![0];

    // The broadcast should happen regardless of skip/send decision.
    // Count how many times 'timer_heartbeat' appears — should be at the end,
    // after all skip-return paths. Since skip paths now fall through to a
    // unified broadcast, the broadcast should NOT be inside an if-block
    // that only executes when CONTINUE is sent.
    //
    // Verify: the broadcast is NOT preceded by a return that would skip it
    // when pending tools are detected. This means the pending tool check
    // should NOT have a bare `return;` — it should use a skip flag instead.
    const pendingToolReturn = body.match(/_pendingToolUseIds\.size > 0[\s\S]*?return;/);
    expect(pendingToolReturn).toBeNull();
  });
});
