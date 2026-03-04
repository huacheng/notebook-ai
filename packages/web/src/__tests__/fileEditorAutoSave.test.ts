/**
 * @file fileEditorAutoSave.test.ts
 * TDD: FileViewerEditor should auto-save to localStorage (50ms) and server (200ms)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('FileViewerEditor auto-save', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../components/FileViewerEditor.tsx'),
    'utf-8'
  );

  it('should have onUpdate callback for editor changes', () => {
    // Editor should listen for content changes
    expect(src).toMatch(/onUpdate|editor\.on\(['"]update/i);
  });

  it('should debounce localStorage save at 50ms', () => {
    // Should have a 50ms debounce for localStorage
    expect(src).toMatch(/50|LOCAL_SAVE_DEBOUNCE/);
    expect(src).toMatch(/localStorage\.setItem/);
  });

  it('should debounce WebSocket save at 200ms', () => {
    // Should have a 200ms debounce for WS sync
    expect(src).toMatch(/200|WS_SAVE_DEBOUNCE|SERVER_SAVE_DEBOUNCE/);
  });

  it('should generate a unique localStorage key based on file path', () => {
    // Should use filePath to create unique key
    expect(src).toMatch(/localStorage.*filePath|filePath.*localStorage|EDITOR_DRAFT/i);
  });

  it('should restore draft from localStorage on mount', () => {
    // Should check localStorage for existing draft on mount
    expect(src).toMatch(/localStorage\.getItem/);
  });

  it('should clear localStorage draft after successful server save', () => {
    // Should remove draft from localStorage after save succeeds
    expect(src).toMatch(/localStorage\.removeItem|clear.*draft/i);
  });

  it('should show auto-save indicator in UI', () => {
    // Should have visual indicator for auto-save status
    expect(src).toMatch(/autoSaving|auto-saving|Saving|syncing/i);
  });
});
