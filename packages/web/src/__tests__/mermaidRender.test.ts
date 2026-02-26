/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { findMermaidBlocks, replaceMermaidBlock } from '../hooks/useMermaidRender';

describe('findMermaidBlocks', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('finds pre > code.language-mermaid blocks', () => {
    container.innerHTML = `
      <pre><code class="language-mermaid">graph TD; A-->B;</code></pre>
      <pre><code class="language-mermaid">sequenceDiagram; A->>B: Hi</code></pre>
    `;
    const blocks = findMermaidBlocks(container);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].source).toBe('graph TD; A-->B;');
    expect(blocks[1].source).toBe('sequenceDiagram; A->>B: Hi');
  });

  it('skips non-mermaid code blocks', () => {
    container.innerHTML = `
      <pre><code class="language-javascript">const x = 1;</code></pre>
      <pre><code class="language-mermaid">graph LR; A-->B;</code></pre>
    `;
    const blocks = findMermaidBlocks(container);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toContain('graph LR');
  });

  it('returns empty array when no mermaid blocks', () => {
    container.innerHTML = '<p>No code here</p>';
    expect(findMermaidBlocks(container)).toEqual([]);
  });
});

describe('replaceMermaidBlock', () => {
  it('replaces <pre> with diagram div containing SVG', () => {
    const pre = document.createElement('pre');
    const parent = document.createElement('div');
    parent.appendChild(pre);

    replaceMermaidBlock(pre, '<svg><rect/></svg>');

    const diagram = parent.querySelector('.fv-mermaid-diagram');
    expect(diagram).not.toBeNull();
    expect(diagram!.innerHTML).toContain('<svg>');
    expect(parent.contains(pre)).toBe(false);
  });

  it('shows error element on null svgHtml', () => {
    const pre = document.createElement('pre');
    const parent = document.createElement('div');
    parent.appendChild(pre);

    replaceMermaidBlock(pre, null, 'Parse error');

    const errEl = parent.querySelector('.fv-mermaid-error');
    expect(errEl).not.toBeNull();
    expect(errEl!.textContent).toContain('Parse error');
    expect(parent.contains(pre)).toBe(false);
  });
});
