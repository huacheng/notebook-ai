/**
 * @file fileViewerNoNotebook.test.ts
 * Regression test: FileViewer should open even when no notebook is active
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('FileViewer without active notebook', () => {
  it('should NOT require activeNotebookTabId to open file in ProjectSidebar', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/ProjectSidebar.tsx'),
      'utf-8'
    );

    // The code should NOT have early return based on activeNotebookTabId
    // when opening a file in FileViewer (both FileBrowser and Library sections)
    expect(src).not.toContain("if (!useStore.getState().activeNotebookTabId) return;");
  });

  it('should NOT require activeNotebookTabId to open file in RightPanel (Deliverables)', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/RightPanel.tsx'),
      'utf-8'
    );

    // Deliverables panel should also allow opening files without active notebook
    expect(src).not.toContain("if (!useStore.getState().activeNotebookTabId) return;");
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
