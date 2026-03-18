/**
 * Test: local-command-stderr should be forwarded to frontend as error output
 *
 * Bug: When a skill/command (like ralph-loop) fails with shell parse error,
 * the error is logged to jsonl but not shown in the frontend.
 *
 * Fix: Detect <local-command-stderr> in user message content and broadcast as error
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('local-command-stderr forwarding', () => {
  const sessionPath = '/home/ubuntu/notebook-ai/packages/server/src/session.ts';

  it('should detect and forward local-command-stderr from user messages', () => {
    const src = fs.readFileSync(sessionPath, 'utf-8');

    // Find case 'user' block (match until case 'content_block_delta')
    const userCaseMatch = src.match(/case 'user':\s*\{[\s\S]*?(?=case 'content_block_delta')/);
    expect(userCaseMatch).not.toBeNull();

    const userCase = userCaseMatch![0];

    // Should check for string content with local-command-stderr
    expect(userCase).toMatch(/local-command-stderr/i);
    // Should broadcast error to frontend
    expect(userCase).toMatch(/broadcast[\s\S]*?type:\s*['"]cell_output['"]/i);
  });
});
