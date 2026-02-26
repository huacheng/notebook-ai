// ── MarkdownToc — pure utility functions + TOC component for Markdown viewer ──
import { createElement, useCallback } from 'react';
import type { ReactNode, FC } from 'react';

export interface Heading {
  level: number;
  text: string;
}

/**
 * Extract headings from raw markdown, ignoring fenced code blocks.
 */
export function extractHeadings(markdown: string): Heading[] {
  const lines = markdown.split('\n');
  const headings: Heading[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^```/.test(line.trimEnd())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }
  }
  return headings;
}

/**
 * Convert heading text to a URL-safe slug.
 * Preserves CJK characters, strips punctuation, deduplicates via seen map.
 */
export function toSlug(text: string, seen?: Map<string, number>): string {
  const slug = text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')   // replace punctuation/symbols with space
    .trim()
    .replace(/\s+/g, '-')              // spaces → hyphens
    .replace(/^-+|-+$/g, '');          // trim leading/trailing hyphens

  if (!seen) return slug;

  const count = seen.get(slug) ?? 0;
  seen.set(slug, count + 1);
  return count === 0 ? slug : `${slug}-${count}`;
}

// ── Heading ID injection for ReactMarkdown components prop ───────────────

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/**
 * Returns a components map for ReactMarkdown that adds `id={slug}` to h1-h6.
 * Uses a shared `seen` map for slug deduplication across headings.
 */
export function headingComponents(): Record<HeadingTag, FC<{ children?: ReactNode }>> {
  const seen = new Map<string, number>();

  function makeHeading(tag: HeadingTag): FC<{ children?: ReactNode }> {
    return function HeadingWithId({ children }) {
      const text = typeof children === 'string' ? children : String(children ?? '');
      const id = toSlug(text, seen);
      return createElement(tag, { id }, children);
    };
  }

  return {
    h1: makeHeading('h1'),
    h2: makeHeading('h2'),
    h3: makeHeading('h3'),
    h4: makeHeading('h4'),
    h5: makeHeading('h5'),
    h6: makeHeading('h6'),
  };
}

// ── TOC Component ────────────────────────────────────────────────────────

interface MarkdownTocProps {
  headings: Heading[];
  isOpen: boolean;
  onToggle?: () => void;
}

export function MarkdownToc({ headings, isOpen, onToggle }: MarkdownTocProps) {
  if (headings.length === 0) return null;

  const minLevel = Math.min(...headings.map(h => h.level));

  const handleClick = useCallback((slug: string) => {
    const el = document.getElementById(slug);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className={`fv-md-toc${isOpen ? ' fv-md-toc--open' : ''}`}>
      <button className="fv-md-toc__toggle" onClick={onToggle} title="Table of Contents">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect x="2" y="3" width="12" height="1.5" rx="0.5" />
          <rect x="4" y="7" width="10" height="1.5" rx="0.5" />
          <rect x="4" y="11" width="10" height="1.5" rx="0.5" />
        </svg>
      </button>
      {isOpen && (
        <nav className="fv-md-toc__list">
          {headings.map((h, i) => {
            const slug = toSlug(h.text);
            return (
              <a
                key={i}
                className="fv-md-toc__item"
                style={{ paddingLeft: `${(h.level - minLevel) * 12 + 8}px` }}
                onClick={() => handleClick(slug)}
              >
                {h.text}
              </a>
            );
          })}
        </nav>
      )}
    </div>
  );
}
