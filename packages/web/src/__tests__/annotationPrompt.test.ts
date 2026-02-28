/**
 * annotationPrompt tests — JSONL annotation serialization + helpers.
 */

import { describe, it, expect } from 'vitest';
import { isTaskSystemFile } from '../types/fileAnnotations';

describe('isTaskSystemFile', () => {
  it('detects dotfile inside .working/ (.target.md)', () => {
    expect(isTaskSystemFile('/home/u/ws/proj/.working/.target.md')).toBe(true);
  });

  it('detects dotfile inside .working/ (.plan.md)', () => {
    expect(isTaskSystemFile('/home/u/ws/proj/.working/.plan.md')).toBe(true);
  });

  it('rejects non-dotfile inside .working/ (notes.md)', () => {
    expect(isTaskSystemFile('/home/u/ws/proj/.working/notes.md')).toBe(false);
  });

  it('rejects dotfile outside .working/', () => {
    expect(isTaskSystemFile('/home/u/ws/proj/.hidden-file.md')).toBe(false);
  });

  it('rejects normal files', () => {
    expect(isTaskSystemFile('/home/u/ws/proj/readme.md')).toBe(false);
  });

  it('handles .working/ subdirs — only leaf filename matters', () => {
    expect(isTaskSystemFile('/home/u/ws/proj/.working/sub/dir/.plan.md')).toBe(true);
    expect(isTaskSystemFile('/home/u/ws/proj/.working/sub/dir/notes.md')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isTaskSystemFile('')).toBe(false);
  });
});
