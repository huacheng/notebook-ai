import { isAskUserQuestion } from './interactiveOptions';

interface ThinkingLike {
  type: 'thinking';
  content: string;
}

interface ToolLike {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
  [key: string]: unknown;
}

export function thinkingGroupProps(items: ThinkingLike[]) {
  const count = items.length;
  return { label: `Thinking (${count} block${count === 1 ? '' : 's'})`, count };
}

export function toolsGroupProps(items: ToolLike[]) {
  const count = items.length;
  const displayCount = items.filter((t) => !isAskUserQuestion(t as any)).length;
  return {
    label: `Tools (${displayCount} call${displayCount === 1 ? '' : 's'})`,
    count,
    displayCount,
  };
}
