/**
 * Utilities for detecting and formatting AskUserQuestion tool_use outputs.
 */

interface ToolUseItem {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

/**
 * Detect whether a tool_use output is an AskUserQuestion with valid structure.
 */
export function isAskUserQuestion(item: ToolUseItem): boolean {
  return (
    item.name === 'AskUserQuestion' &&
    Array.isArray(item.input?.questions) &&
    item.input.questions.length > 0
  );
}

/**
 * Format user selections into a text answer.
 *
 * - Single question, single/multi selection → plain labels (comma-separated if multi)
 * - Multiple questions → "header: labels" per line
 */
export function formatAnswer(questions: AskQuestion[], selections: string[][]): string {
  if (questions.length === 1) {
    return selections[0]?.join(', ') ?? '';
  }
  return questions
    .map((q, i) => `${q.header}: ${selections[i]?.join(', ') ?? ''}`)
    .join('\n');
}
