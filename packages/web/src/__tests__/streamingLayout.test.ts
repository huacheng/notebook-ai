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

  it('has three zones: timeline-window → status → streaming-text-area', async () => {
    useStore.setState({
      streamBuffer: { 'cell-run': { text: 'model output', thinking: '' } },
    });
    const html = await renderCellOutput({
      outputs: [],
      cellId: 'cell-run',
      cellStatus: 'running',
      source: 'prompt',
    });

    expect(html).toContain('tl-frame');
    expect(html).toContain('cell-status-running');
    expect(html).toContain('streaming-text-area');

    const timelineIdx = html.indexOf('tl-frame');
    const statusIdx = html.indexOf('cell-status-running');
    const textIdx = html.indexOf('streaming-text-area');
    expect(timelineIdx).toBeLessThan(statusIdx);
    expect(statusIdx).toBeLessThan(textIdx);
  });

  it('StreamingThinking is inside timeline-window (before status)', async () => {
    useStore.setState({
      streamBuffer: { c1: { text: '', thinking: 'deep thought' } },
    });
    const html = await renderCellOutput({
      outputs: [],
      cellId: 'c1',
      cellStatus: 'running',
      source: 'p',
    });

    const timelineStart = html.indexOf('tl-frame');
    const thinkingIdx = html.indexOf('tl-block tl-block--thinking streaming');
    const statusIdx = html.indexOf('cell-status-running');
    expect(thinkingIdx).toBeGreaterThan(timelineStart);
    expect(thinkingIdx).toBeLessThan(statusIdx);
  });
});

// ── CellOutput: completed layout (two-zone split) ──────────

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

  it('separates thinking+tools into timeline-window, text as markdown outside', async () => {
    const html = await renderCellOutput({
      outputs: [thinkingOutput, toolOutput, textOutput],
      cellId: 'done-cell',
      cellStatus: 'completed',
    });

    expect(html).toContain('tl-frame');
    expect(html).toContain('markdown-rendered');
  });

  it('thinking+tools are inside timeline-window, text is outside', async () => {
    const html = await renderCellOutput({
      outputs: [thinkingOutput, toolOutput, textOutput],
      cellId: 'done-cell',
      cellStatus: 'completed',
    });

    const timelineStart = html.indexOf('tl-frame');
    const toolIdx = html.indexOf('tl-block--tool');
    const thinkIdx = html.indexOf('tl-block--thinking');
    const mdIdx = html.indexOf('markdown-rendered');

    expect(thinkIdx).toBeGreaterThan(timelineStart);
    expect(toolIdx).toBeGreaterThan(timelineStart);
    expect(mdIdx).toBeGreaterThan(toolIdx);
  });

  it('renders only text when no thinking/tools', async () => {
    const html = await renderCellOutput({
      outputs: [textOutput],
      cellId: 'text-only',
      cellStatus: 'completed',
    });

    expect(html).not.toContain('tl-frame');
    expect(html).toContain('markdown-rendered');
  });

  it('renders only timeline-window when no text outputs', async () => {
    const html = await renderCellOutput({
      outputs: [thinkingOutput, toolOutput],
      cellId: 'tools-only',
      cellStatus: 'completed',
    });

    expect(html).toContain('tl-frame');
    expect(html).not.toContain('output-text-md');
  });
});
