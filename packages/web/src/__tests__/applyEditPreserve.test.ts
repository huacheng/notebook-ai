/**
 * D1 regression test: applyEdit must preserve highlightRects and capturedScale
 * when editing an annotation's content.
 */
import { describe, it, expect } from 'vitest';
import { applyEdit, type FileAnnotation } from '../types/fileAnnotations';

describe('applyEdit preserves visual attributes - D1', () => {
  const baseAnnotation: FileAnnotation = {
    id: 'ann-1',
    type: 'comment',
    file_path: 'test.md',
    absolute_path: '/workspace/test.md',
    selected_text: 'hello world',
    content: 'original comment',
    cursor: 42,
    author: 'user',
    timestamp: '2026-03-03T00:00:00Z',
    updatedAt: 1000,
    highlightRects: [{ x: 100, y: 200, width: 300, height: 20 }],
    capturedScale: 1.5,
  };

  it('preserves highlightRects when editing content', () => {
    const items = [baseAnnotation];
    const result = applyEdit(items, 'ann-1', 'new comment', 'ann-2');

    expect(result[0].highlightRects).toEqual(baseAnnotation.highlightRects);
  });

  it('preserves capturedScale when editing content', () => {
    const items = [baseAnnotation];
    const result = applyEdit(items, 'ann-1', 'new comment', 'ann-2');

    expect(result[0].capturedScale).toBe(1.5);
  });

  it('updates content and id correctly', () => {
    const items = [baseAnnotation];
    const result = applyEdit(items, 'ann-1', 'new comment', 'ann-2');

    expect(result[0].id).toBe('ann-2');
    expect(result[0].content).toBe('new comment');
  });

  it('updates updatedAt timestamp', () => {
    const items = [baseAnnotation];
    const before = Date.now();
    const result = applyEdit(items, 'ann-1', 'new comment', 'ann-2');
    const after = Date.now();

    expect(result[0].updatedAt).toBeGreaterThanOrEqual(before);
    expect(result[0].updatedAt).toBeLessThanOrEqual(after);
  });

  it('preserves other annotation properties', () => {
    const items = [baseAnnotation];
    const result = applyEdit(items, 'ann-1', 'new comment', 'ann-2');

    expect(result[0].type).toBe('comment');
    expect(result[0].file_path).toBe('test.md');
    expect(result[0].selected_text).toBe('hello world');
    expect(result[0].cursor).toBe(42);
  });

  it('does not affect other annotations in the list', () => {
    const other: FileAnnotation = {
      ...baseAnnotation,
      id: 'ann-other',
      content: 'other content',
    };
    const items = [baseAnnotation, other];
    const result = applyEdit(items, 'ann-1', 'new comment', 'ann-2');

    expect(result[1]).toEqual(other);
  });
});
