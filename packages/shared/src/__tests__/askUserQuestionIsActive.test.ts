import { describe, it, expect } from 'vitest';
import { ToolUseOutputSchema } from '../types';

/**
 * AskUserQuestion isActive property
 *
 * - isActive: true → question not yet answered (active, waiting for user)
 * - isActive: false → question has been answered
 */
describe('ToolUseOutput isActive property', () => {
  it('should accept isActive: true for unanswered questions', () => {
    const result = ToolUseOutputSchema.safeParse({
      type: 'tool_use',
      name: 'AskUserQuestion',
      input: { questions: [{ question: 'Which option?', options: [] }] },
      isActive: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });

  it('should accept isActive: false for answered questions', () => {
    const result = ToolUseOutputSchema.safeParse({
      type: 'tool_use',
      name: 'AskUserQuestion',
      input: { questions: [{ question: 'Which option?', options: [] }] },
      result: 'Option A',
      isActive: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(false);
    }
  });

  it('should allow isActive to be optional (backward compat)', () => {
    const result = ToolUseOutputSchema.safeParse({
      type: 'tool_use',
      name: 'bash',
      input: { command: 'ls' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBeUndefined();
    }
  });
});
