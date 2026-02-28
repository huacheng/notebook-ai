import { describe, it, expect } from 'vitest';
import { buildTimelineItems } from '../utils/timelineItems';

describe('CellOutput layout logic', () => {
  it('streaming: thinking and tool_use separated, text stays in content', () => {
    const outputs = [
      { type: 'thinking' as const, content: 'pondering...' },
      { type: 'tool_use' as const, name: 'bash', input: { cmd: 'ls' }, tool_use_id: 't1' },
      { type: 'text' as const, content: 'result text' },
    ];
    const { thinking, tools, content } = buildTimelineItems(outputs);
    expect(thinking).toHaveLength(1);
    expect(thinking[0].type).toBe('thinking');
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('tool_use');
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
  });

  it('completed: same partition as streaming', () => {
    const outputs = [
      { type: 'thinking' as const, content: 'thought' },
      { type: 'tool_use' as const, name: 'read', input: {}, tool_use_id: 't1', result: 'file content' },
      { type: 'text' as const, content: 'answer' },
    ];
    const { thinking, tools, content } = buildTimelineItems(outputs);
    expect(thinking).toHaveLength(1);
    expect(tools).toHaveLength(1);
    expect(content).toHaveLength(1);
  });

  it('tool with result is not pending', () => {
    const tool = { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1', result: 'ok' };
    expect(tool.result).toBeDefined();
    const pending = tool.result === undefined;
    expect(pending).toBe(false);
  });

  it('tool without result is pending', () => {
    const tool = { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1' };
    const pending = (tool as any).result === undefined;
    expect(pending).toBe(true);
  });
});
