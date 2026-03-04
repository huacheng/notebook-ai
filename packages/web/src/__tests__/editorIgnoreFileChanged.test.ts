import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * When in edit mode, the editor should not re-render when receiving
 * file-changed-* messages from the backend. This prevents:
 * 1. Flashing/spinner when the editor's own save triggers a file-changed notification
 * 2. Loss of editor content when external changes overwrite user's work
 */
describe('FileViewer edit mode ignores file-changed notifications', () => {
  const fileViewerSrc = readFileSync(
    path.resolve(__dirname, '../components/FileViewer.tsx'),
    'utf-8',
  );

  it('should pass suppressChanges prop to useFileStream when in edit mode', () => {
    // FileViewer should pass a flag to useFileStream indicating edit mode
    // This flag tells useFileStream to ignore file-changed-* messages
    expect(fileViewerSrc).toMatch(/useFileStream\([^)]*,\s*(mode\s*===\s*['"]edit['"]|suppressChanges)/);
  });

  const useFileStreamSrc = readFileSync(
    path.resolve(__dirname, '../hooks/useFileStream.ts'),
    'utf-8',
  );

  it('useFileStream should accept a suppressChanges parameter', () => {
    // The hook signature should include a flag to suppress file-changed handling
    expect(useFileStreamSrc).toMatch(/suppressChanges/);
  });

  it('should skip file-changed-meta when suppressChanges is true', () => {
    // When suppressChanges is true, file-changed-meta should be ignored
    // Look for conditional that checks this flag before processing file-changed-meta
    expect(useFileStreamSrc).toMatch(/suppressChanges.*file-changed-meta|file-changed-meta.*suppressChanges/s);
  });
});
