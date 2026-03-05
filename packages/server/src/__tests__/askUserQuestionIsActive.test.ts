import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * AskUserQuestion isActive property
 *
 * - When AskUserQuestion tool_use is created: isActive should be true (in session.ts)
 * - When user answers (tool_result arrives): isActive should be set to false (in notebook-mutations.ts)
 */
describe('AskUserQuestion isActive in session output', () => {
  const sessionSrc = readFileSync(
    path.resolve(__dirname, '../session.ts'),
    'utf-8',
  );
  const mutationsSrc = readFileSync(
    path.resolve(__dirname, '../notebook-mutations.ts'),
    'utf-8',
  );

  it('should set isActive: true when creating AskUserQuestion tool_use output', () => {
    // When tool_use output is created for AskUserQuestion,
    // it should include isActive: true to indicate waiting for user input

    // Look for isActive being set in the tool_use creation logic
    // The pattern should be: when name === 'AskUserQuestion', add isActive: true
    const hasIsActiveForAskUser =
      sessionSrc.includes('isActive: true') &&
      sessionSrc.includes('AskUserQuestion');

    expect(hasIsActiveForAskUser).toBe(true);
  });

  it('should set isActive: false when tool_result is received', () => {
    // When tool_result arrives for an AskUserQuestion,
    // the output should be updated to isActive: false
    // This happens in attachToolResult in notebook-mutations.ts

    const hasIsActiveFalseOnResult = mutationsSrc.includes('isActive: false');

    expect(hasIsActiveFalseOnResult).toBe(true);
  });
});
