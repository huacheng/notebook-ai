import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../hooks/useFileStream.ts'),
  'utf-8',
);

/**
 * useFileStream should handle server-pushed file updates:
 * - file-changed-meta: start of push update
 * - file-changed-chunk / file-changed-chunk-compressed: content chunks
 * - file-changed-end: end of push update
 * - file-deleted: file was removed
 *
 * This enables live updates without frontend polling/GET requests.
 */
describe('useFileStream live push update handling', () => {
  it('should handle file-changed-meta message type', () => {
    expect(src).toContain("case 'file-changed-meta':");
  });

  it('should handle file-changed-chunk message type', () => {
    expect(src).toContain("case 'file-changed-chunk':");
  });

  it('should handle file-changed-chunk-compressed message type', () => {
    expect(src).toContain("case 'file-changed-chunk-compressed':");
  });

  it('should handle file-changed-end message type', () => {
    expect(src).toContain("case 'file-changed-end':");
  });

  it('should handle file-deleted message type', () => {
    expect(src).toContain("case 'file-deleted':");
  });

  it('should update state when receiving file-changed messages', () => {
    // The message handler should call setState with new content
    expect(src).toContain('file-changed');
    // Should update content or trigger a refresh
    const hasStateUpdate = src.includes("setState") && src.includes("file-changed");
    expect(hasStateUpdate).toBe(true);
  });
});
