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
  it('shows success and fail counts in label', () => {
    const items = [
      { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1', result: 'ok' },
      { type: 'tool_use' as const, name: 'read', input: {}, tool_use_id: 't2', result: 'data' },
      { type: 'tool_use' as const, name: 'write', input: {}, tool_use_id: 't3', result: 'err', is_error: true },
    ];
    const props = toolsGroupProps(items as any);
    expect(props.label).toBe('Tools (3 calls · 2 ✓ · 1 ✗)');
    expect(props.ok).toBe(2);
    expect(props.fail).toBe(1);
  });

  it('omits fail segment when no errors', () => {
    const items = [
      { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1', result: 'ok' },
      { type: 'tool_use' as const, name: 'read', input: {}, tool_use_id: 't2', result: 'data' },
    ];
    const props = toolsGroupProps(items as any);
    expect(props.label).toBe('Tools (2 calls · 2 ✓)');
  });

  it('singular call label for 1 item', () => {
    const items = [
      { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1', result: 'done' },
    ];
    const props = toolsGroupProps(items as any);
    expect(props.label).toBe('Tools (1 call · 1 ✓)');
  });

  it('excludes AskUserQuestion from display count', () => {
    const items = [
      { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1', result: 'ok' },
      { type: 'tool_use' as const, name: 'AskUserQuestion', input: { questions: [{ question: 'Pick one', options: ['a', 'b'] }] }, tool_use_id: 't2' },
    ];
    const props = toolsGroupProps(items as any);
    expect(props.displayCount).toBe(1);
    expect(props.count).toBe(2);
  });

  it('handles tools with no result yet (pending)', () => {
    const items = [
      { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1', result: 'ok' },
      { type: 'tool_use' as const, name: 'read', input: {}, tool_use_id: 't2' },
    ];
    const props = toolsGroupProps(items as any);
    expect(props.label).toBe('Tools (2 calls · 1 ✓)');
    expect(props.ok).toBe(1);
    expect(props.fail).toBe(0);
  });
});
