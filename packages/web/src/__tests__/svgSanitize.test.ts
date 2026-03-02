// @vitest-environment jsdom
/**
 * D2-7 regression: SVG sanitization must use DOMPurify instead of regex
 * to cover iframe, object, CSS injection, and other attack vectors.
 */
import { describe, it, expect } from 'vitest';
import DOMPurify from 'dompurify';

/**
 * The sanitizeSvg function that should be used in CellOutput.tsx.
 * Uses DOMPurify with SVG profile for robust sanitization.
 */
function sanitizeSvgWithDOMPurify(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}

// Regex-based sanitizer (current, incomplete) — used to demonstrate the gap
const DANGEROUS_TAGS = /(<script[\s\S]*?<\/script>|<script[^>]*\/>)/gi;
const DANGEROUS_ATTRS = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
const JAVASCRIPT_HREF = /\s+(?:href|xlink:href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi;

function sanitizeSvgRegex(svg: string): string {
  return svg
    .replace(DANGEROUS_TAGS, '')
    .replace(DANGEROUS_ATTRS, '')
    .replace(JAVASCRIPT_HREF, '');
}

describe('ImageRenderer SVG blob sanitization (P1-3)', () => {
  it('should sanitize SVG content with DOMPurify before creating blob URL', () => {
    // Read the source code to verify ImageRenderer sanitizes SVGs
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../components/FileViewerRender.tsx'),
      'utf-8',
    );
    const fnStart = src.indexOf('function ImageRenderer');
    const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
    const block = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 800);
    expect(block).toContain('DOMPurify.sanitize');
  });
});

describe('SVG sanitization (D2-7)', () => {
  // ── Vectors that the regex misses but DOMPurify catches ──

  it('should strip <iframe> elements (regex misses this)', () => {
    const malicious = '<svg><foreignObject><iframe src="https://evil.com"></iframe></foreignObject></svg>';
    const regexResult = sanitizeSvgRegex(malicious);
    const purifyResult = sanitizeSvgWithDOMPurify(malicious);

    // Regex does NOT catch iframe
    expect(regexResult).toContain('iframe');
    // DOMPurify DOES catch iframe
    expect(purifyResult).not.toContain('iframe');
  });

  it('should strip <object> elements (regex misses this)', () => {
    const malicious = '<svg><foreignObject><object data="javascript:alert(1)"></object></foreignObject></svg>';
    const regexResult = sanitizeSvgRegex(malicious);
    const purifyResult = sanitizeSvgWithDOMPurify(malicious);

    expect(regexResult).toContain('object');
    expect(purifyResult).not.toContain('<object');
  });

  it('should strip <embed> elements (regex misses this)', () => {
    const malicious = '<svg><foreignObject><embed src="evil.swf"></embed></foreignObject></svg>';
    const regexResult = sanitizeSvgRegex(malicious);
    const purifyResult = sanitizeSvgWithDOMPurify(malicious);

    expect(regexResult).toContain('embed');
    expect(purifyResult).not.toContain('<embed');
  });

  // ── Standard vectors both should catch ──

  it('should strip script tags', () => {
    const malicious = '<svg><script>alert("xss")</script><rect width="100" height="100"/></svg>';
    const purifyResult = sanitizeSvgWithDOMPurify(malicious);
    expect(purifyResult).not.toContain('<script');
    expect(purifyResult).toContain('rect');
  });

  it('should strip on* event attributes', () => {
    const malicious = '<svg><rect onclick="alert(1)" width="100" height="100"/></svg>';
    const purifyResult = sanitizeSvgWithDOMPurify(malicious);
    expect(purifyResult).not.toContain('onclick');
  });

  it('should preserve legitimate SVG content', () => {
    const safe = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/><text x="10" y="50">Hello</text></svg>';
    const purifyResult = sanitizeSvgWithDOMPurify(safe);
    expect(purifyResult).toContain('circle');
    expect(purifyResult).toContain('Hello');
    expect(purifyResult).toContain('viewBox');
  });
});
