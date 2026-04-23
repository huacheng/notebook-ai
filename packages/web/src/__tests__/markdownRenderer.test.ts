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

describe('MarkdownRenderer math (KaTeX)', () => {
  async function render(content: string) {
    const { MarkdownRenderer } = await import('../components/MarkdownRenderer');
    return renderToString(createElement(MarkdownRenderer, { content }));
  }

  it('renders block math $$...$$ with katex class', async () => {
    const html = await render('$$\nE = mc^2\n$$');
    // rehype-katex emits <span class="katex"> or wraps in math element
    expect(html).toMatch(/katex|math/i);
    expect(html).not.toContain('$$');
  });

  it('single $...$ is treated as plain text (singleDollarTextMath disabled)', async () => {
    // With singleDollarTextMath: false, $...$ is NOT parsed as math
    const html = await render('The formula $E = mc^2$ is famous.');
    expect(html).not.toContain('class="katex"');
    expect(html).toContain('$E');
  });

  it('does not break regular text without dollar signs', async () => {
    const html = await render('Hello world, no math here.');
    expect(html).toContain('Hello world');
    expect(html).not.toMatch(/katex/i);
  });

  it('does not mangle currency: $100 and $200 stay as plain text', async () => {
    const html = await render('The cost is $100 and the revenue is $200.');
    // Should NOT be parsed as inline math
    expect(html).not.toContain('class="katex"');
    expect(html).toContain('$100');
    expect(html).toContain('$200');
  });

  it('renders GFM table and block math in same document without conflict', async () => {
    const md = '| Name |\n|---|\n| Einstein |\n\n$$\nE = mc^2\n$$';
    const html = await render(md);
    expect(html).toContain('<table>');
    expect(html).toMatch(/katex|math/i);
  });

  it('does NOT treat single ~text~ as strikethrough (singleTilde disabled)', async () => {
    const html = await render('Path ~/dir and ~text~ here.');
    expect(html).not.toContain('<del>');
    expect(html).toContain('~text~');
  });

  it('still treats double ~~text~~ as strikethrough', async () => {
    const html = await render('正常 ~~删除~~ 文本');
    expect(html).toContain('<del>');
  });

  it('CJK adjacent URL: 参考https://example.com这个 — link must end at .com', async () => {
    const html = await render('参考https://example.com这个链接');
    expect(html).not.toMatch(/href="[^"]*%E[\dA-F]{2}/i);
    expect(html).not.toMatch(/example\.com这个/);
  });

  it('XSS: <script> tags are escaped not executed', async () => {
    const html = await render('Hello <script>alert(1)</script> world');
    expect(html).not.toMatch(/<script[^>]*>/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('XSS: javascript: URL produces empty href, not navigating', async () => {
    const html = await render('[click](javascript:alert(1))');
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it('opens external links in new tab with rel="noopener noreferrer"', async () => {
    const html = await render('[GitHub](https://github.com)');
    expect(html).toMatch(/target="_blank"/);
    expect(html).toMatch(/rel="[^"]*noopener[^"]*noreferrer[^"]*"/);
  });
});
