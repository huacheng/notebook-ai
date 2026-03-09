/**
 * Tests autoTick behavior when no cell is running:
 * - Should NOT call sendPrompt directly (response would be dropped)
 * - Should create a new cell and executeCell with CONTINUE_PROMPT
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('autoTick with no running cell', () => {
  it('should NOT call sendPrompt when no cell is running', () => {
    const src = sessionSrc();
    const autoTickBody = src.match(/private autoTick\([\s\S]*?(?=\n  \/\*\*|\n  private [a-z]|\n  \/\/ ──)/);
    expect(autoTickBody).toBeTruthy();
    const hasRawSendInAutoTick = autoTickBody![0].match(
      /findRunningCellId[\s\S]*?else[\s\S]*?sendPrompt/
    );
    expect(hasRawSendInAutoTick).toBeNull();
  });

  it('should call executeCell when no running cell (auto-create new cell)', () => {
    const src = sessionSrc();
    const autoTickBody = src.match(/private autoTick\([\s\S]*?(?=\n  \/\*\*|\n  private [a-z]|\n  \/\/ ──)/);
    expect(autoTickBody).toBeTruthy();
    // When no running cell, the else branch should call executeCell
    const hasExecuteInElse = autoTickBody![0].match(
      /else[\s\S]*?executeCell/
    );
    expect(hasExecuteInElse).toBeTruthy();
  });
});
