/**
 * @file fileViewerNoNotebook.test.ts
 * Regression test: FileViewer should open even when no notebook is active
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('FileViewer without active notebook', () => {
  it('should NOT require activeNotebookTabId to open file', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/ProjectSidebar.tsx'),
      'utf-8'
    );

    // The code should NOT have early return based on activeNotebookTabId
    // when opening a file in FileViewer
    expect(src).not.toContain("if (!activeNotebookTabId) return;");
  });

  it('App.tsx should render FileViewer when hasActiveFile is true regardless of notebook', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../App.tsx'),
      'utf-8'
    );

    // FileViewer should be rendered when hasActiveFile is true
    // The condition should be `hasActiveFile ? ( <FileViewer />` not dependent on hasNotebook
    expect(src).toContain('hasActiveFile ? (');
    expect(src).toContain('<FileViewer />');
  });
});
