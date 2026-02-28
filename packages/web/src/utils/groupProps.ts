import { isAskUserQuestion } from './interactiveOptions';

interface ThinkingLike {
  type: 'thinking';
  content: string;
}

interface ToolLike {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
  result?: string;
  is_error?: boolean;
  [key: string]: unknown;
}

export function thinkingGroupProps(items: ThinkingLike[]) {
  const count = items.length;
  return { label: `Thinking (${count} block${count === 1 ? '' : 's'})`, count };
}

export function toolsGroupProps(items: ToolLike[]) {
  const count = items.length;
  const tools = items.filter((t) => !isAskUserQuestion(t as any));
  const displayCount = tools.length;
  const ok = tools.filter((t) => t.result !== undefined && !t.is_error).length;
  const fail = tools.filter((t) => t.result !== undefined && t.is_error).length;

  const parts = [`${displayCount} call${displayCount === 1 ? '' : 's'}`];
  if (ok > 0) parts.push(`${ok} ✓`);
  if (fail > 0) parts.push(`${fail} ✗`);

  return {
    label: `Tools (${parts.join(' · ')})`,
    count,
    displayCount,
    ok,
    fail,
  };
}
