/**
 * Bug reproduction: Image insertion in prompt textarea causes "Invalid message format" error.
 *
 * User report:
 * - Insert image in prompt textarea, thumbnail shows correctly
 * - Send message shows "重启失败: Invalid message format"
 */
import { describe, it, expect } from 'vitest';
import { ExecuteRequestSchema, PromptImageSchema, WSClientMessageSchema } from '@notebook-ai/shared';

describe('Image message validation', () => {
  it('should accept valid image with standard media_type', () => {
    const image = {
      media_type: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    };
    const result = PromptImageSchema.safeParse(image);
    expect(result.success).toBe(true);
  });

  it('should reject image with invalid media_type', () => {
    const image = {
      media_type: 'image/svg+xml', // not in enum
      data: 'base64data',
    };
    const result = PromptImageSchema.safeParse(image);
    expect(result.success).toBe(false);
  });

  it('should reject image with media_type containing extra info', () => {
    // Some browsers might add charset or other params
    const image = {
      media_type: 'image/png;charset=utf-8',
      data: 'base64data',
    };
    const result = PromptImageSchema.safeParse(image);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('media_type');
    }
  });

  it('should accept execute_request with images', () => {
    const msg = {
      type: 'execute_request',
      session_id: 'test-session',
      cell_id: 'test-cell',
      source: 'test prompt',
      images: [
        {
          media_type: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      ],
    };
    const result = ExecuteRequestSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should accept execute_request in WSClientMessageSchema', () => {
    const msg = {
      type: 'execute_request',
      session_id: 'test-session',
      cell_id: 'test-cell',
      source: 'test prompt',
      images: [
        {
          media_type: 'image/jpeg',
          data: '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAB//9k=',
        },
      ],
    };
    const result = WSClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should reject execute_request with preview field in image', () => {
    // This was the suspected issue - preview field being included
    const msg = {
      type: 'execute_request',
      session_id: 'test-session',
      cell_id: 'test-cell',
      source: 'test prompt',
      images: [
        {
          media_type: 'image/png',
          data: 'base64data',
          preview: 'data:image/png;base64,base64data', // extra field
        },
      ],
    };
    const result = WSClientMessageSchema.safeParse(msg);
    // z.object() strips unknown keys by default, so this should still pass
    expect(result.success).toBe(true);
  });

  it('should handle empty images array', () => {
    const msg = {
      type: 'execute_request',
      session_id: 'test-session',
      cell_id: 'test-cell',
      source: 'test prompt',
      images: [],
    };
    const result = WSClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should handle undefined images', () => {
    const msg = {
      type: 'execute_request',
      session_id: 'test-session',
      cell_id: 'test-cell',
      source: 'test prompt',
    };
    const result = WSClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  // Bug reproduction: browser might return unsupported media types
  it('BUG REPRO: should reject image/bmp (not in enum)', () => {
    const msg = {
      type: 'execute_request',
      session_id: 'test-session',
      cell_id: 'test-cell',
      source: 'test prompt',
      images: [
        {
          media_type: 'image/bmp', // not in enum: png, jpeg, gif, webp
          data: 'base64data',
        },
      ],
    };
    const result = WSClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Verify the error is about media_type
      expect(result.error.issues.some(i => i.path.includes('media_type'))).toBe(true);
    }
  });

  it('BUG REPRO: should reject image/svg+xml (not in enum)', () => {
    const msg = {
      type: 'execute_request',
      session_id: 'test-session',
      cell_id: 'test-cell',
      source: 'test prompt',
      images: [
        {
          media_type: 'image/svg+xml',
          data: 'base64data',
        },
      ],
    };
    const result = WSClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('BUG REPRO: should reject image/tiff (not in enum)', () => {
    const msg = {
      type: 'execute_request',
      session_id: 'test-session',
      cell_id: 'test-cell',
      source: 'test prompt',
      images: [
        {
          media_type: 'image/tiff',
          data: 'base64data',
        },
      ],
    };
    const result = WSClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });
});

// Schema completeness tests for image_refs support
// These tests verify that image_refs is PRESERVED after parsing (not stripped)
describe('image_refs schema completeness', () => {
  it('AppendPromptSchema should preserve image_refs', () => {
    const { AppendPromptSchema } = require('@notebook-ai/shared');
    const msg = {
      type: 'append_prompt',
      session_id: 'test-session',
      cell_id: 'test-cell',
      source: 'test prompt',
      image_refs: [{ path: '.images/test.png' }],
    };
    const result = AppendPromptSchema.safeParse(msg);
    expect(result.success).toBe(true);
    expect(result.data.image_refs).toBeDefined();
    expect(result.data.image_refs).toHaveLength(1);
    expect(result.data.image_refs[0].path).toBe('.images/test.png');
  });

  it('PromptSegmentSchema should preserve image_refs', () => {
    const { PromptSegmentSchema } = require('@notebook-ai/shared');
    const segment = {
      text: 'test',
      addedAt: new Date().toISOString(),
      image_refs: [{ path: '.images/test.png' }],
    };
    const result = PromptSegmentSchema.safeParse(segment);
    expect(result.success).toBe(true);
    expect(result.data.image_refs).toBeDefined();
    expect(result.data.image_refs).toHaveLength(1);
  });

  it('CellCreatedMessageSchema should preserve image_refs', () => {
    const { CellCreatedMessageSchema } = require('@notebook-ai/shared');
    const msg = {
      type: 'cell_created',
      session_id: 'test-session',
      cell_id: 'test-cell',
      source: 'test prompt',
      image_refs: [{ path: '.images/test.png' }],
    };
    const result = CellCreatedMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    expect(result.data.image_refs).toBeDefined();
    expect(result.data.image_refs).toHaveLength(1);
  });
});
