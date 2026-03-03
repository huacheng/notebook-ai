/**
 * Utilities for detecting and formatting AskUserQuestion tool_use outputs.
 */

/**
 * Claude Code CLI auto-response string when AskUserQuestion is used in stream-json mode.
 * The CLI cannot wait for user input and returns this error instead.
 */
export const CLAUDE_CODE_AUTO_RESPONSE = 'Answer questions?';

/**
 * Detect whether a tool result is Claude Code's automatic error response.
 * This happens when AskUserQuestion is used with Claude Code in stream-json mode.
 */
export function isClaudeCodeAutoResponse(
  result: string | undefined,
  isError: boolean | undefined,
): boolean {
  return result === CLAUDE_CODE_AUTO_RESPONSE && isError === true;
}

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

export interface FormatAnswerOpts {
  otherTexts?: string[];   // per-question custom text (when __other__ selected)
  declineReason?: string;  // reason text (when __decline__ selected)
}

/**
 * Format user selections into a text answer.
 *
 * - __decline__ in any question → "Declined" or "Declined: {reason}"
 * - __other__ in a question → replaced with "Other: {text}"
 * - Single question, single/multi selection → plain labels (comma-separated if multi)
 * - Multiple questions → "header: labels" per line
 */
export function formatAnswer(
  questions: AskQuestion[],
  selections: string[][],
  opts?: FormatAnswerOpts,
): string {
  // Decline is global — if any question has __decline__, return decline format
  if (selections.some((s) => s.includes('__decline__'))) {
    const reason = opts?.declineReason?.trim();
    return reason ? `Declined: ${reason}` : 'Declined';
  }

  // Resolve __other__ per question
  const resolved = selections.map((s, qIdx) =>
    s.map((label) =>
      label === '__other__'
        ? `Other: ${opts?.otherTexts?.[qIdx] ?? ''}`
        : label,
    ),
  );

  if (questions.length === 1) {
    return resolved[0]?.join(', ') ?? '';
  }
  return questions
    .map((q, i) => `${q.header}: ${resolved[i]?.join(', ') ?? ''}`)
    .join('\n');
}
