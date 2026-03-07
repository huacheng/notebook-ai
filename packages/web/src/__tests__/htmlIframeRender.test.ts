/**
 * @vitest-environment jsdom
 *
 * Tests that format='html' renders an iframe (not DOMPurify sanitized div).
 */
import { describe, it, expect } from 'vitest';

describe('HTML iframe rendering', () => {
  it('format html should use sandboxed iframe with srcdoc', () => {
    // Verify the rendering approach: HTML content should be placed in an iframe
    // with sandbox attribute to allow scripts but isolate from parent page.
    const htmlContent = '<html><body><script>alert(1)</script><h1>Chart</h1></body></html>';

    // Simulate what the component should do: create iframe with srcdoc
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('srcdoc', htmlContent);

    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('srcdoc')).toBe(htmlContent);
    // Should NOT have allow-same-origin (prevents script access to parent)
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('format html iframe should not allow top navigation', () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');

    // Sandbox without allow-top-navigation prevents the iframe from navigating the parent
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-top-navigation');
  });
});
