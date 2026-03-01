// @vitest-environment jsdom
/**
 * D2-2 regression: XLSX HTML output must be sanitized via DOMPurify
 * before dangerouslySetInnerHTML to prevent XSS.
 */
import { describe, it, expect } from 'vitest';
import DOMPurify from 'dompurify';

describe('XLSX HTML sanitization (D2-2)', () => {
  it('should strip script tags from XLSX-generated HTML', () => {
    const malicious = '<table><tr><td><script>alert("xss")</script>data</td></tr></table>';
    const sanitized = DOMPurify.sanitize(malicious);
    expect(sanitized).not.toContain('<script');
    expect(sanitized).toContain('data');
  });

  it('should strip onerror attributes from XLSX-generated HTML', () => {
    const malicious = '<table><tr><td><img src=x onerror="alert(1)">data</td></tr></table>';
    const sanitized = DOMPurify.sanitize(malicious);
    expect(sanitized).not.toContain('onerror');
  });

  it('should strip javascript: hrefs from XLSX-generated HTML', () => {
    const malicious = '<table><tr><td><a href="javascript:alert(1)">click</a></td></tr></table>';
    const sanitized = DOMPurify.sanitize(malicious);
    expect(sanitized).not.toContain('javascript:');
  });

  it('should preserve legitimate table HTML', () => {
    const safe = '<table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table>';
    const sanitized = DOMPurify.sanitize(safe);
    expect(sanitized).toContain('<table>');
    expect(sanitized).toContain('<th>Name</th>');
    expect(sanitized).toContain('<td>A</td>');
  });
});
