import { describe, it, expect } from 'vitest';
import { computeSourceCursor } from '../types/fileAnnotations';

// Signature: computeSourceCursor(selectedText, renderedOffset, renderedTextLen, sourceText): number

describe('computeSourceCursor', () => {
  it('text === source (plain text/code): offset unchanged', () => {
    const source = 'hello world foo bar';
    // rendered text is identical to source
    expect(computeSourceCursor('world', 6, source.length, source)).toBe(6);
  });

  it('unique match: returns source position even when offset differs', () => {
    // markdown: "# Title\nHello" renders as "Title\nHello" (stripped "#  ")
    const source = '# Title\nHello';
    const rendered = 'Title\nHello';
    // "Hello" is at rendered offset 6, but in source at offset 8
    expect(computeSourceCursor('Hello', 6, rendered.length, source)).toBe(8);
  });

  it('multiple matches: picks closest by proportion', () => {
    // "ab" appears at 0, 10, 20
    const source = 'ab--------ab--------ab';
    const rendered = source; // plain text, same
    // renderedOffset=20 → proportion ≈ 0.91 → est ≈ 20 → closest is 20
    expect(computeSourceCursor('ab', 20, rendered.length, source)).toBe(20);
    // renderedOffset=10 → proportion ≈ 0.45 → est ≈ 10 → closest is 10
    expect(computeSourceCursor('ab', 10, rendered.length, source)).toBe(10);
    // renderedOffset=0 → proportion = 0 → est = 0 → closest is 0
    expect(computeSourceCursor('ab', 0, rendered.length, source)).toBe(0);
  });

  it('zero matches: falls back to proportional estimate', () => {
    const source = 'abcdefghijklmnopqrstuvwxyz'; // 26 chars
    const rendered = 'ABCDEFGHIJKLM'; // 13 chars, different text
    // renderedOffset=6, proportion=6/13 ≈ 0.46 → est = round(0.46*26) = 12
    expect(computeSourceCursor('XYZ', 6, 13, source)).toBe(12);
  });

  it('renderedTextLen=0 → returns 0', () => {
    expect(computeSourceCursor('anything', 0, 0, 'source text')).toBe(0);
  });

  it('empty selectedText → proportional estimate', () => {
    const source = '0123456789'; // 10 chars
    // renderedOffset=5, renderedTextLen=10 → proportion=0.5 → est=5
    expect(computeSourceCursor('', 5, 10, source)).toBe(5);
  });

  it('empty selectedText with different lengths → proportional scaling', () => {
    const source = '0123456789abcdef'; // 16 chars
    // renderedOffset=4, renderedTextLen=8 → proportion=0.5 → est=round(0.5*16)=8
    expect(computeSourceCursor('', 4, 8, source)).toBe(8);
  });
});
