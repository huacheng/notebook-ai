/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { extractHeadings, toSlug, headingComponents, MarkdownToc } from '../components/MarkdownToc';

describe('extractHeadings', () => {
  it('extracts h1 and h2', () => {
    const md = '# Title\n## Sub';
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Sub' },
    ]);
  });

  it('ignores headings inside fenced code blocks', () => {
    const md = '# Real\n```\n# Not a heading\n```\n## Also Real';
    const result = extractHeadings(md);
    expect(result).toEqual([
      { level: 1, text: 'Real' },
      { level: 2, text: 'Also Real' },
    ]);
  });

  it('handles h1 through h6', () => {
    const md = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const result = extractHeadings(md);
    expect(result).toHaveLength(6);
    expect(result[0]).toEqual({ level: 1, text: 'H1' });
    expect(result[5]).toEqual({ level: 6, text: 'H6' });
  });

  it('returns empty array for no headings', () => {
    expect(extractHeadings('Just some text\nNo headings here')).toEqual([]);
  });
});

describe('toSlug', () => {
  it('converts to lowercase kebab-case', () => {
    expect(toSlug('Hello World')).toBe('hello-world');
  });

  it('handles duplicate slugs with suffix', () => {
    const seen = new Map<string, number>();
    expect(toSlug('Title', seen)).toBe('title');
    expect(toSlug('Title', seen)).toBe('title-1');
    expect(toSlug('Title', seen)).toBe('title-2');
  });

  it('preserves Chinese characters', () => {
    const slug = toSlug('你好世界');
    expect(slug).toBe('你好世界');
  });

  it('strips punctuation but keeps alphanumeric and CJK', () => {
    const slug = toSlug('Hello, World! (2024)');
    expect(slug).toBe('hello-world-2024');
  });
});

// Helper: render a React element into a fresh DOM container
function renderToDOM(element: React.ReactElement): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return container;
}

describe('headingComponents', () => {
  it('h1 component adds correct id attribute', () => {
    const comps = headingComponents();
    const container = renderToDOM(createElement(comps.h1 as any, null, 'My Title'));
    const el = container.querySelector('h1')!;
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('My Title');
    expect(el.id).toBe('my-title');
  });

  it('h2 component adds correct id attribute', () => {
    const comps = headingComponents();
    const container = renderToDOM(createElement(comps.h2 as any, null, 'Sub Section'));
    const el = container.querySelector('h2')!;
    expect(el).not.toBeNull();
    expect(el.id).toBe('sub-section');
  });

  it('deduplicates slugs across headings', () => {
    const comps = headingComponents();
    const container = renderToDOM(
      createElement('div', null,
        createElement(comps.h2 as any, null, 'Title'),
        createElement(comps.h2 as any, null, 'Title'),
      )
    );
    const els = container.querySelectorAll('h2');
    expect(els[0].id).toBe('title');
    expect(els[1].id).toBe('title-1');
  });
});

describe('MarkdownToc', () => {
  it('renders all heading items', () => {
    const headings = [
      { level: 1, text: 'Intro' },
      { level: 2, text: 'Details' },
      { level: 3, text: 'Deep' },
    ];
    const container = renderToDOM(createElement(MarkdownToc, { headings, isOpen: true }));
    expect(container.textContent).toContain('Intro');
    expect(container.textContent).toContain('Details');
    expect(container.textContent).toContain('Deep');
  });

  it('does not render when headings is empty', () => {
    const container = renderToDOM(createElement(MarkdownToc, { headings: [], isOpen: true }));
    expect(container.querySelector('.fv-md-toc')).toBeNull();
  });
});
