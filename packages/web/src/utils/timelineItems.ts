interface OutputLike {
  type: string;
  [key: string]: unknown;
}

interface TimelineResult<T> {
  thinking: T[];
  tools: T[];
  content: T[];
}

export function buildTimelineItems<T extends OutputLike>(outputs: T[]): TimelineResult<T> {
  const thinking: T[] = [];
  const tools: T[] = [];
  const content: T[] = [];
  for (const o of outputs) {
    if (o.type === 'thinking') {
      thinking.push(o);
    } else if (o.type === 'tool_use') {
      tools.push(o);
    } else {
      content.push(o);
    }
  }
  return { thinking, tools, content };
}
