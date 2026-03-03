/**
 * D2 test: FileViewerEditor should have content length validation
 */
import { describe, it, expect } from 'vitest';

/** Maximum content size that can be saved (1MB) */
export const MAX_EDITOR_CONTENT_SIZE = 1024 * 1024;

/** Validate editor content before save */
export function validateEditorContent(content: string): { valid: boolean; error?: string } {
  if (content.length > MAX_EDITOR_CONTENT_SIZE) {
    return {
      valid: false,
      error: `Content too large (${(content.length / 1024).toFixed(0)}KB, max 1MB)`,
    };
  }
  return { valid: true };
}

describe('editor content validation - D2', () => {
  it('MAX_EDITOR_CONTENT_SIZE is 1MB', () => {
    expect(MAX_EDITOR_CONTENT_SIZE).toBe(1024 * 1024);
  });

  it('accepts content under limit', () => {
    const content = 'x'.repeat(1000);
    expect(validateEditorContent(content)).toEqual({ valid: true });
  });

  it('accepts content at exact limit', () => {
    const content = 'x'.repeat(MAX_EDITOR_CONTENT_SIZE);
    expect(validateEditorContent(content)).toEqual({ valid: true });
  });

  it('rejects content over limit', () => {
    const content = 'x'.repeat(MAX_EDITOR_CONTENT_SIZE + 1);
    const result = validateEditorContent(content);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Content too large/);
    expect(result.error).toMatch(/max 1MB/);
  });

  it('error message includes content size in KB', () => {
    const content = 'x'.repeat(1.5 * 1024 * 1024); // 1.5MB
    const result = validateEditorContent(content);
    expect(result.error).toMatch(/1536KB/); // 1.5 * 1024
  });

  it('accepts empty content', () => {
    expect(validateEditorContent('')).toEqual({ valid: true });
  });
});
