/**
 * D3 Reliability: useFileStream should handle LZ4 decompression errors gracefully
 * and update state to reflect the error instead of silently failing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('useFileStream LZ4 decompression error handling', () => {
  const hookSrc = () => readFileSync(
    path.resolve(__dirname, '../hooks/useFileStream.ts'),
    'utf-8'
  );

  it('should handle file-chunk-compressed decompression errors with state update', () => {
    const src = hookSrc();
    // The catch block for file-chunk-compressed should call setState to notify user of error
    // Just console.error is insufficient - users need feedback
    const chunkCompressedCatch = src.match(
      /case\s+['"]file-chunk-compressed['"][\s\S]*?catch\s*\([^)]*\)\s*\{([\s\S]*?)\}/
    );
    expect(chunkCompressedCatch).toBeTruthy();
    const catchBody = chunkCompressedCatch![1];
    // Must call setState to update error status, not just log
    expect(catchBody).toMatch(/setState/);
  });

  it('should handle file-changed-chunk-compressed decompression errors with state update', () => {
    const src = hookSrc();
    // The catch block for file-changed-chunk-compressed should call setState
    const changedChunkCatch = src.match(
      /case\s+['"]file-changed-chunk-compressed['"][\s\S]*?catch\s*\([^)]*\)\s*\{([\s\S]*?)\}/
    );
    expect(changedChunkCatch).toBeTruthy();
    const catchBody = changedChunkCatch![1];
    // Must call setState to update error status
    expect(catchBody).toMatch(/setState/);
  });
});
