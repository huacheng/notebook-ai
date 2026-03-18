/**
 * Test: Zero-width characters should be filtered from text_delta
 *
 * Bug: Claude outputs \u200b (zero-width space) when trying to "say nothing"
 * in response to stop hook feedback. These accumulate as empty lines.
 *
 * Fix: Filter out zero-width characters before broadcasting to frontend
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('zero-width character filtering', () => {
  const sessionPath = '/home/ubuntu/notebook-ai/packages/server/src/session.ts';

  it('should filter zero-width characters from text_delta', () => {
    const src = fs.readFileSync(sessionPath, 'utf-8');

    // Find text_delta handling
    const textDeltaMatch = src.match(/text_delta[\s\S]*?broadcast\(session,[\s\S]*?cell_stream[\s\S]*?\}\);/);
    expect(textDeltaMatch).not.toBeNull();

    const textDeltaBlock = textDeltaMatch![0];

    // Should filter zero-width space \u200b
    expect(textDeltaBlock).toMatch(/\\u200b/);
    // Should check for visible text before broadcasting
    expect(textDeltaBlock).toMatch(/visibleText/i);
  });
});
