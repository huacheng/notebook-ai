/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

describe('MarkdownRenderer', () => {
  // Lazy import to allow Red phase to fail on missing module
  async function render(content: string, className?: string) {
    const { MarkdownRenderer } = await import('../components/MarkdownRenderer');
    return renderToString(createElement(MarkdownRenderer, { content, className }));
  }

  it('renders heading as HTML h1', async () => {
    const html = await render('# Title');
    expect(html).toContain('<h1>');
    expect(html).toContain('Title');
  });

  it('renders GFM table', async () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const html = await render(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>');
  });

  it('renders code with syntax highlight class', async () => {
    const md = '```js\nconst x = 1;\n```';
    const html = await render(md);
    expect(html).toContain('<code');
    expect(html).toContain('const');
  });

  it('applies custom className', async () => {
    const html = await render('hello', 'output-text-md');
    expect(html).toContain('markdown-rendered');
    expect(html).toContain('output-text-md');
  });
});

describe('TextOutputView uses MarkdownRenderer', () => {
  it('renders markdown instead of raw pre', async () => {
    const { TextOutputView } = await import('../components/CellOutput');
    const html = renderToString(createElement(TextOutputView, { content: '# Hello' }));
    expect(html).toContain('<h1>');
    expect(html).not.toMatch(/<pre[^>]*># Hello<\/pre>/);
  });
});
