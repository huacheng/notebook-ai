/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

describe('MarkdownBody', () => {
  async function render(content: string) {
    const { MarkdownBody } = await import('../components/MarkdownBody');
    return renderToString(createElement(MarkdownBody, { content }));
  }

  it('renders GFM table (default Streamdown plugin must be preserved)', async () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const html = await render(md);
    expect(html).toContain('<table');
    expect(html).toMatch(/<td[^>]*>1<\/td>/);
  });

  it('renders block math $$...$$ via KaTeX', async () => {
    const html = await render('$$\nE = mc^2\n$$');
    expect(html).toMatch(/katex|<math/i);
    expect(html).not.toContain('$$');
  });

  it('does not mangle currency $100 ... $200', async () => {
    const html = await render('Price is $100 and revenue is $200.');
    expect(html).not.toContain('class="katex"');
    expect(html).toContain('$100');
  });

  it('renders Chinese \\text{} block math without console errors', async () => {
    const html = await render('$$\n\\text{买 Call(K)} + \\text{卖 Put(K)} = \\text{多头}\n$$');
    expect(html).toMatch(/katex|<math/i);
  });

  it('does NOT treat single ~text~ as strikethrough (singleTilde disabled)', async () => {
    const html = await render('Path is ~/dir and pattern is ~xxx~ file.');
    expect(html).not.toContain('<del>');
    expect(html).toContain('~xxx~');
  });

  it('still treats double ~~text~~ as strikethrough (standard GFM)', async () => {
    const html = await render('正常 ~~删除~~ 文本');
    expect(html).toContain('<del>');
    expect(html).toContain('删除');
  });

  it('CJK adjacent URL: 参考https://example.com这个 — link must end at .com', async () => {
    const html = await render('参考https://example.com这个链接');
    // URL should NOT contain Chinese chars or their percent-encoding
    expect(html).not.toMatch(/href="[^"]*%E[\dA-F]{2}/i);
    expect(html).not.toMatch(/example\.com这个/);
  });

  it('**bold** renders as standard <strong> (not Streamdown span)', async () => {
    const html = await render('正文 **粗体** 后续');
    expect(html).toMatch(/<strong[^>]*>粗体<\/strong>/);
    expect(html).not.toContain('font-semibold');
  });

  it('XSS: <script> tags are escaped not executed', async () => {
    const html = await render('Hello <script>alert(1)</script> world');
    expect(html).not.toMatch(/<script[^>]*>/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('XSS: javascript: URL produces non-navigating element', async () => {
    const html = await render('[click](javascript:alert(1))');
    // Streamdown wraps links in <button> (no href); ReactMarkdown emits empty href
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it('renders [text](url) as standard <a href>, not <button>', async () => {
    const html = await render('看 [文档](https://example.com/doc) 这里');
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\/doc"[^>]*>文档<\/a>/);
    expect(html).not.toContain('data-streamdown="link"');
  });

  it('opens external links in new tab with rel="noopener noreferrer"', async () => {
    const html = await render('[GitHub](https://github.com)');
    expect(html).toMatch(/target="_blank"/);
    expect(html).toMatch(/rel="[^"]*noopener[^"]*noreferrer[^"]*"/);
  });

  it('drops javascript: and data: scheme links to safe href', async () => {
    const html1 = await render('[js](javascript:alert(1))');
    const html2 = await render('[data](data:text/html;base64,PHM+)');
    expect(html1).not.toMatch(/href="javascript:/i);
    expect(html2).not.toMatch(/href="data:/i);
  });

  it('reference-style link [text][label] resolves via preprocessor', async () => {
    const md = '看 [文档][doc] 这里\n\n[doc]: https://example.com';
    const html = await render(md);
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com"[^>]*>文档<\/a>/);
    expect(html).not.toContain('[文档][doc]');
  });

  it('collapsed reference [label] resolves via preprocessor', async () => {
    const md = '查 [doc] 文档\n\n[doc]: https://example.com';
    const html = await render(md);
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com"[^>]*>doc<\/a>/);
  });

  it('reference labels are case-insensitive', async () => {
    const md = '看 [文档][DOC]\n\n[doc]: https://example.com';
    const html = await render(md);
    expect(html).toMatch(/href="https:\/\/example\.com"/);
  });

  it('does NOT inline references inside fenced code blocks', async () => {
    const md = '```\n[code][doc]\n```\n\n[doc]: https://example.com';
    const html = await render(md);
    // Code block should preserve literal [code][doc]
    expect(html).toContain('[code][doc]');
  });
});
