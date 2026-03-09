/**
 * Tests timerTick behavior when no cell is running:
 * - Should NOT call sendPrompt directly (response would be dropped)
 * - Should create a new cell and executeCell with CONTINUE_PROMPT
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('timerTick with no running cell', () => {
  it('should NOT call sendPrompt when no cell is running', () => {
    const src = sessionSrc();
    const timerTickBody = src.match(/private timerTick\([\s\S]*?(?=\n  \/\*\*|\n  private [a-z]|\n  \/\/ ──)/);
    expect(timerTickBody).toBeTruthy();
    const hasRawSendInTimerTick = timerTickBody![0].match(
      /findRunningCellId[\s\S]*?else[\s\S]*?sendPrompt/
    );
    expect(hasRawSendInTimerTick).toBeNull();
  });

  it('should call executeCell when no running cell (timer-create new cell)', () => {
    const src = sessionSrc();
    const timerTickBody = src.match(/private timerTick\([\s\S]*?(?=\n  \/\*\*|\n  private [a-z]|\n  \/\/ ──)/);
    expect(timerTickBody).toBeTruthy();
    // When no running cell, the else branch should call executeCell
    const hasExecuteInElse = timerTickBody![0].match(
      /else[\s\S]*?executeCell/
    );
    expect(hasExecuteInElse).toBeTruthy();
  });
});
