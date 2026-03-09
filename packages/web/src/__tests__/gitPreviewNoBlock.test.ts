/**
 * Test: Git preview should NOT block Notebook rendering in split-view.
 * Annotation send should be disabled when no active notebook.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Git preview no longer blocks split-view', () => {
  it('should NOT show split-notebook-overlay when gitTabOpen', () => {
    const appSrc = fs.readFileSync(
      path.resolve(__dirname, '../../src/App.tsx'), 'utf-8'
    );
    // The overlay that blocks notebook when git is active should be removed
    expect(appSrc).not.toContain('split-notebook-overlay');
  });

  it('should NOT have app.gitActive i18n key usage in App.tsx', () => {
    const appSrc = fs.readFileSync(
      path.resolve(__dirname, '../../src/App.tsx'), 'utf-8'
    );
    expect(appSrc).not.toContain('app.gitActive');
  });
});

describe('Annotation send requires active notebook', () => {
  it('FileAnnotationDropdown reads sessionId from store to determine hasNotebook', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../components/FileAnnotationDropdown.tsx'), 'utf-8'
    );
    expect(src).toContain('sessionId');
    expect(src).toContain('hasNotebook');
  });

  it('Send buttons are disabled when !hasNotebook', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../components/FileAnnotationDropdown.tsx'), 'utf-8'
    );
    expect(src).toMatch(/disabled=\{.*!hasNotebook/);
  });
});
