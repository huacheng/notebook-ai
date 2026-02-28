/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { useStore } from '../store';
import type { CellOutput as CellOutputItem } from '@notebook-ai/shared';

// ── Helpers ─────────────────────────────────────────────────

async function renderCellOutput(props: {
  outputs: CellOutputItem[];
  cellId?: string;
  cellStatus?: string;
  source?: string;
}) {
  const { CellOutput } = await import('../components/CellOutput');
  return renderToString(createElement(CellOutput, props));
}

async function renderStreamingText(cellId: string, lastTextContent?: string) {
  const { StreamingText } = await import('../components/StreamingCellOutput');
  return renderToString(createElement(StreamingText, { cellId, lastTextContent }));
}

async function renderStreamingThinking(cellId: string, lastThinkingContent?: string) {
  const { StreamingThinking } = await import('../components/StreamingCellOutput');
  return renderToString(createElement(StreamingThinking, { cellId, lastThinkingContent }));
}

// ── StreamingText ───────────────────────────────────────────

describe('StreamingText', () => {
  beforeEach(() => {
    useStore.setState({ streamBuffer: {} });
  });

  it('renders markdown container instead of plain <pre>', async () => {
    useStore.setState({
      streamBuffer: { 'cell-1': { text: '# Hello\n\n**bold**', thinking: '' } },
    });
    const html = await renderStreamingText('cell-1');
    expect(html).toContain('markdown-rendered');
    expect(html).not.toMatch(/<pre[^>]*class="output-text streaming"/);
  });

  it('renders empty state gracefully when no stream buffer', async () => {
    const html = await renderStreamingText('no-such-cell');
    expect(html).toContain('markdown-rendered');
  });

  it('wraps in streaming-text-area container', async () => {
    useStore.setState({
      streamBuffer: { c1: { text: 'hello', thinking: '' } },
    });
    const html = await renderStreamingText('c1');
    expect(html).toContain('streaming-text-area');
  });
});

// ── StreamingThinking ───────────────────────────────────────

describe('StreamingThinking', () => {
  beforeEach(() => {
    useStore.setState({ streamBuffer: {} });
  });

  it('returns null when no thinking content', async () => {
    const html = await renderStreamingThinking('c1');
    expect(html).toBe('');
  });

  it('renders preview lines when collapsed (default)', async () => {
    useStore.setState({
      streamBuffer: { c1: { text: '', thinking: 'line1\nline2\nline3\nline4\nline5\nline6' } },
    });
    const html = await renderStreamingThinking('c1');
    // Should show last 4 lines (preview), not all 6
    expect(html).toContain('line6');
    expect(html).toContain('line3');
    expect(html).not.toContain('line1');
  });

  it('shows spinner during streaming', async () => {
    useStore.setState({
      streamBuffer: { c1: { text: '', thinking: 'thinking...' } },
    });
    const html = await renderStreamingThinking('c1');
    expect(html).toContain('spinner');
    expect(html).toContain('Thinking');
  });
});

// ── CellOutput: streaming layout ────────────────────────────

describe('CellOutput streaming layout', () => {
  beforeEach(() => {
    useStore.setState({ streamBuffer: {} });
  });

  it('streaming has only 3 components: StreamingThinking → ToolsGroup → StreamingText', async () => {
    useStore.setState({
      streamBuffer: { 'cell-run': { text: 'model output', thinking: 'hmm' } },
    });
    const html = await renderCellOutput({
      outputs: [
        { type: 'tool_use', name: 'bash', tool_use_id: 't1', input: {}, result: 'ok' } as any,
      ],
      cellId: 'cell-run',
      cellStatus: 'running',
      source: 'prompt',
    });

    // Has ToolsGroup + StreamingThinking + StreamingText + RunningStatus
    expect(html).toContain('tl-group--tools');
    expect(html).toContain('cell-status-running');
    expect(html).toContain('streaming-text-area');

    // NO ThinkingGroup during streaming (StreamingThinking handles live thinking)
    expect(html).not.toContain('tl-group--thinking');

    // Order: thinking → tools → status → text
    const thinkingIdx = html.indexOf('tl-block--thinking streaming');
    const toolsIdx = html.indexOf('tl-group--tools');
    const statusIdx = html.indexOf('cell-status-running');
    const textIdx = html.indexOf('streaming-text-area');
    expect(thinkingIdx).toBeLessThan(toolsIdx);
    expect(toolsIdx).toBeLessThan(statusIdx);
    expect(statusIdx).toBeLessThan(textIdx);
  });

  it('streaming: no ThinkingGroup even with completed thinking blocks', async () => {
    useStore.setState({
      streamBuffer: { c2: { text: '', thinking: '' } },
    });
    const html = await renderCellOutput({
      outputs: [
        { type: 'thinking', content: 'thought-1' } as any,
        { type: 'tool_use', name: 'bash', tool_use_id: 't1', input: {}, result: 'ok' } as any,
        { type: 'thinking', content: 'thought-2' } as any,
      ],
      cellId: 'c2',
      cellStatus: 'running',
      source: 'p',
    });

    // Only ToolsGroup, no ThinkingGroup
    expect(html).toContain('tl-group--tools');
    expect(html).not.toContain('tl-group--thinking');
  });
});

// ── CellOutput: completed layout ────────────────────────────

describe('CellOutput completed layout', () => {
  const thinkingOutput: CellOutputItem = { type: 'thinking', content: 'I thought about this' };
  const toolOutput: CellOutputItem = {
    type: 'tool_use',
    name: 'Read',
    tool_use_id: 'tu1',
    input: { path: '/test' },
    result: 'file contents',
  };
  const textOutput: CellOutputItem = { type: 'text', content: '## Answer\n\nHere is the result.' };

  it('separates thinking+tools groups from text markdown', async () => {
    const html = await renderCellOutput({
      outputs: [thinkingOutput, toolOutput, textOutput],
      cellId: 'done-cell',
      cellStatus: 'completed',
    });

    expect(html).toContain('tl-groups');
    expect(html).toContain('markdown-rendered');
  });

  it('thinking+tools groups are inside groups container, text is outside', async () => {
    const html = await renderCellOutput({
      outputs: [thinkingOutput, toolOutput, textOutput],
      cellId: 'done-cell',
      cellStatus: 'completed',
    });

    const groupsStart = html.indexOf('tl-groups');
    const thinkGroupIdx = html.indexOf('tl-group--thinking');
    const toolGroupIdx = html.indexOf('tl-group--tools');
    const mdIdx = html.indexOf('markdown-rendered');

    expect(thinkGroupIdx).toBeGreaterThan(groupsStart);
    expect(toolGroupIdx).toBeGreaterThan(groupsStart);
    expect(mdIdx).toBeGreaterThan(toolGroupIdx);
  });

  it('renders only text when no thinking/tools', async () => {
    const html = await renderCellOutput({
      outputs: [textOutput],
      cellId: 'text-only',
      cellStatus: 'completed',
    });

    expect(html).not.toContain('tl-groups');
    expect(html).toContain('markdown-rendered');
  });

  it('renders only groups when no text outputs', async () => {
    const html = await renderCellOutput({
      outputs: [thinkingOutput, toolOutput],
      cellId: 'tools-only',
      cellStatus: 'completed',
    });

    expect(html).toContain('tl-groups');
    expect(html).not.toContain('output-text-md');
  });

  it('ToolRow inside group shows no result preview (compact)', async () => {
    const html = await renderCellOutput({
      outputs: [toolOutput, textOutput],
      cellId: 'compact-check',
      cellStatus: 'completed',
    });

    // ToolsGroup is collapsed, so no ToolRow rendered at all
    expect(html).not.toContain('tool-use-result-preview');
    // But the group header should exist
    expect(html).toContain('tl-group--tools');
  });
});
