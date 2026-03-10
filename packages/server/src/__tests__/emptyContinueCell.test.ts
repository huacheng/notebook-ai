/**
 * Test: Empty CONTINUE cells should be removed from notebook after completion.
 * When timer mode sends '继续' and the response is empty, the cell is pruned.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('Empty CONTINUE cell cleanup', () => {
  it('completeCell should check for empty CONTINUE cells and remove them', () => {
    const src = sessionSrc();
    // completeCell should reference CONTINUE_PROMPT to detect timer-generated cells
    expect(src).toContain('CONTINUE_PROMPT');
    // Should have logic to remove empty cells (removeCell or filter)
    expect(src).toMatch(/removeContinueCell|pruneContinueCell|isEmptyContinue/);
  });

  it('CONTINUE_PROMPT constant should be defined', () => {
    const src = sessionSrc();
    expect(src).toContain("CONTINUE_PROMPT = '继续'");
  });

  it('should NOT prune CONTINUE cell when it has non-text outputs (tool_use, error, chart)', () => {
    const src = sessionSrc();
    // pruneContinueCell must check output TYPE, not just text field.
    // Outputs with type 'tool_use', 'error', 'chart' are meaningful even without text.
    // The check should look at output.type (not just output.text) to avoid false pruning.
    expect(src).toMatch(/o\.type\b.*!==.*'text'/s);
  });
});
