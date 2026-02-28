/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { useStore } from '../store';

describe('StreamingText layout', () => {
  beforeEach(() => {
    useStore.setState({ streamBuffer: {} });
  });

  it('renders markdown container instead of plain <pre>', async () => {
    useStore.setState({
      streamBuffer: { 'cell-1': { text: '# Hello World\n\nSome **bold** text', thinking: '' } },
    });

    const { StreamingText } = await import('../components/StreamingCellOutput');
    const html = renderToString(createElement(StreamingText, { cellId: 'cell-1' }));

    // Should contain markdown-rendered class (from MarkdownRenderer)
    expect(html).toContain('markdown-rendered');
    // Should NOT be a plain <pre> tag for text output
    expect(html).not.toMatch(/<pre[^>]*class="output-text streaming"/);
  });

  it('renders empty state gracefully when no stream buffer', async () => {
    const { StreamingText } = await import('../components/StreamingCellOutput');
    const html = renderToString(createElement(StreamingText, { cellId: 'no-such-cell' }));

    // Should still render (empty markdown)
    expect(html).toContain('markdown-rendered');
  });
});

describe('CellOutput streaming layout structure', () => {
  beforeEach(() => {
    useStore.setState({ streamBuffer: {} });
  });

  it('StreamingText is outside cell-timeline-window', async () => {
    useStore.setState({
      streamBuffer: { 'cell-run': { text: 'hello output', thinking: '' } },
    });

    const { CellOutput } = await import('../components/CellOutput');
    const html = renderToString(
      createElement(CellOutput, {
        outputs: [],
        cellId: 'cell-run',
        cellStatus: 'running',
        source: 'test prompt',
      })
    );

    // Verify RunningStatus exists (has spinner)
    expect(html).toContain('spinner');
    // Verify streaming text area exists as a sibling (not inside timeline-window)
    expect(html).toContain('streaming-text-area');

    // Verify layout order: timeline-window, then status, then streaming-text-area
    const timelineIdx = html.indexOf('cell-timeline-window');
    const statusIdx = html.indexOf('cell-status-running');
    const textAreaIdx = html.indexOf('streaming-text-area');
    expect(timelineIdx).toBeLessThan(statusIdx);
    expect(statusIdx).toBeLessThan(textAreaIdx);
  });
});
