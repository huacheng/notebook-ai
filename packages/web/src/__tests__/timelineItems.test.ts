import { describe, it, expect } from 'vitest';
import { buildTimelineItems } from '../utils/timelineItems';

describe('buildTimelineItems', () => {
  it('separates thinking, tool_use, and content into three groups', () => {
    const outputs = [
      { type: 'thinking' as const, content: 'hmm' },
      { type: 'tool_use' as const, name: 'bash', input: { cmd: 'ls' }, tool_use_id: 't1' },
      { type: 'text' as const, content: 'hello' },
      { type: 'error' as const, message: 'oops' },
    ];
    const result = buildTimelineItems(outputs);
    expect(result.thinking).toHaveLength(1);
    expect(result.thinking[0].type).toBe('thinking');
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].type).toBe('tool_use');
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1].type).toBe('error');
  });

  it('returns empty arrays for empty input', () => {
    const result = buildTimelineItems([]);
    expect(result.thinking).toEqual([]);
    expect(result.tools).toEqual([]);
    expect(result.content).toEqual([]);
  });

  it('preserves order within each group', () => {
    const outputs = [
      { type: 'thinking' as const, content: 'a' },
      { type: 'tool_use' as const, name: 'read', input: {}, tool_use_id: 't1' },
      { type: 'thinking' as const, content: 'b' },
      { type: 'tool_use' as const, name: 'write', input: {}, tool_use_id: 't2' },
    ];
    const result = buildTimelineItems(outputs);
    expect(result.thinking.map(o => o.content)).toEqual(['a', 'b']);
    expect(result.tools.map(o => o.name)).toEqual(['read', 'write']);
  });

  it('puts chart outputs into content', () => {
    const outputs = [
      { type: 'chart' as const, chart_type: 'bar', data: {} },
    ];
    const result = buildTimelineItems(outputs);
    expect(result.thinking).toHaveLength(0);
    expect(result.tools).toHaveLength(0);
    expect(result.content).toHaveLength(1);
  });
});
