interface OutputLike {
  type: string;
  [key: string]: unknown;
}

interface TimelineResult<T> {
  timeline: T[];
  content: T[];
}

export function buildTimelineItems<T extends OutputLike>(outputs: T[]): TimelineResult<T> {
  const timeline: T[] = [];
  const content: T[] = [];
  for (const o of outputs) {
    if (o.type === 'thinking' || o.type === 'tool_use') {
      timeline.push(o);
    } else {
      content.push(o);
    }
  }
  return { timeline, content };
}
