/**
 * D2/D6 tests: Annotation field length limits and constants
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_SELECTED_TEXT_LENGTH,
  MAX_ANNOTATION_CONTENT_LENGTH,
  truncateSelectedText,
  truncateAnnotationContent,
} from '../types/fileAnnotations';

describe('annotation length constants - D6', () => {
  it('MAX_SELECTED_TEXT_LENGTH should be exported and positive', () => {
    expect(typeof MAX_SELECTED_TEXT_LENGTH).toBe('number');
    expect(MAX_SELECTED_TEXT_LENGTH).toBeGreaterThan(0);
    expect(MAX_SELECTED_TEXT_LENGTH).toBe(80); // current known value
  });

  it('MAX_ANNOTATION_CONTENT_LENGTH should be exported and positive', () => {
    expect(typeof MAX_ANNOTATION_CONTENT_LENGTH).toBe('number');
    expect(MAX_ANNOTATION_CONTENT_LENGTH).toBeGreaterThan(0);
    expect(MAX_ANNOTATION_CONTENT_LENGTH).toBe(10000); // 10KB text limit
  });
});

describe('truncateSelectedText - D6', () => {
  it('returns unchanged text when under limit', () => {
    const short = 'hello world';
    expect(truncateSelectedText(short)).toBe(short);
  });

  it('truncates text exceeding MAX_SELECTED_TEXT_LENGTH', () => {
    const long = 'x'.repeat(100);
    const result = truncateSelectedText(long);
    expect(result.length).toBe(MAX_SELECTED_TEXT_LENGTH);
    expect(result).toBe('x'.repeat(80));
  });

  it('handles exact limit length', () => {
    const exact = 'y'.repeat(MAX_SELECTED_TEXT_LENGTH);
    expect(truncateSelectedText(exact)).toBe(exact);
  });

  it('handles empty string', () => {
    expect(truncateSelectedText('')).toBe('');
  });
});

describe('truncateAnnotationContent - D2', () => {
  it('returns unchanged content when under limit', () => {
    const short = 'This is a short comment.';
    expect(truncateAnnotationContent(short)).toBe(short);
  });

  it('truncates content exceeding MAX_ANNOTATION_CONTENT_LENGTH', () => {
    const long = 'z'.repeat(15000);
    const result = truncateAnnotationContent(long);
    expect(result.length).toBe(MAX_ANNOTATION_CONTENT_LENGTH);
  });

  it('handles undefined content', () => {
    expect(truncateAnnotationContent(undefined)).toBeUndefined();
  });

  it('handles empty string', () => {
    expect(truncateAnnotationContent('')).toBe('');
  });
});
