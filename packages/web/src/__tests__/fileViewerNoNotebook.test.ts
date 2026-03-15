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

  it('App.tsx should always render FileViewer (persistent split layout)', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../App.tsx'),
      'utf-8'
    );

    // FileViewer is always rendered in the split layout (no conditional)
    expect(src).toContain('<FileViewer />');
    // Should NOT have conditional hasActiveFile gating
    expect(src).not.toContain('hasActiveFile ? (');
  });
});
