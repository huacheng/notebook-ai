/**
 * Tests for ThinkingGroup / ToolsGroup grouping components.
 * Since no DOM environment is available, we test the exported
 * groupProps helper that computes display data for each group.
 */
import { describe, it, expect } from 'vitest';
import { thinkingGroupProps, toolsGroupProps } from '../utils/groupProps';

describe('ThinkingGroup props', () => {
  it('returns label with block count', () => {
    const items = [
      { type: 'thinking' as const, content: 'a' },
      { type: 'thinking' as const, content: 'b' },
      { type: 'thinking' as const, content: 'c' },
    ];
    const props = thinkingGroupProps(items as any);
    expect(props.label).toBe('Thinking (3 blocks)');
    expect(props.count).toBe(3);
  });

  it('singular block label for 1 item', () => {
    const items = [{ type: 'thinking' as const, content: 'a' }];
    const props = thinkingGroupProps(items as any);
    expect(props.label).toBe('Thinking (1 block)');
  });
});

describe('ToolsGroup props', () => {
  it('returns label with call count', () => {
    const items = [
      { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1' },
      { type: 'tool_use' as const, name: 'read', input: {}, tool_use_id: 't2' },
    ];
    const props = toolsGroupProps(items as any);
    expect(props.label).toBe('Tools (2 calls)');
    expect(props.count).toBe(2);
  });

  it('singular call label for 1 item', () => {
    const items = [
      { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1' },
    ];
    const props = toolsGroupProps(items as any);
    expect(props.label).toBe('Tools (1 call)');
  });

  it('excludes AskUserQuestion from display count', () => {
    const items = [
      { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1' },
      { type: 'tool_use' as const, name: 'AskUserQuestion', input: { questions: [{ question: 'Pick one', options: ['a', 'b'] }] }, tool_use_id: 't2' },
    ];
    const props = toolsGroupProps(items as any);
    // AskUserQuestion is still in items but count only reflects non-interactive tools
    expect(props.displayCount).toBe(1);
    expect(props.count).toBe(2); // total items
  });
});
