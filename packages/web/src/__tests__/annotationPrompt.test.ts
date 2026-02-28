/**
 * annotationPrompt tests — JSONL annotation serialization + helpers.
 */

import { describe, it, expect } from 'vitest';
import { isTaskSystemFile, resolveAbsolutePath } from '../types/fileAnnotations';

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

describe('resolveAbsolutePath', () => {
  it('workspace: workspaceDir + "/" + path', () => {
    expect(resolveAbsolutePath('workspace', 'src/main.ts', '/home/u/ws', null))
      .toBe('/home/u/ws/src/main.ts');
  });

  it('workspace: system file inside .working/', () => {
    expect(resolveAbsolutePath('workspace', '.working/.target.md', '/home/u/ws', null))
      .toBe('/home/u/ws/.working/.target.md');
  });

  it('library: uses activeProjectPath parent as root', () => {
    expect(resolveAbsolutePath('library', 'refs/api.md', null, '/home/u/ws/.library/proj/notebook.json'))
      .toBe('/home/u/ws/.library/proj/.library/refs/api.md');
  });

  it('library: works with both workspaceDir and activeProjectPath', () => {
    expect(resolveAbsolutePath('library', 'refs/api.md', '/home/u/ws', '/home/u/ws/.library/proj/notebook.json'))
      .toBe('/home/u/ws/.library/proj/.library/refs/api.md');
  });

  it('deliverables: workspaceDir + "/.deliverables/" + path', () => {
    expect(resolveAbsolutePath('deliverables', 'report.pdf', '/home/u/ws', null))
      .toBe('/home/u/ws/.deliverables/report.pdf');
  });

  it('returns empty string when no dir info', () => {
    expect(resolveAbsolutePath('workspace', 'file.ts', null, null)).toBe('');
    expect(resolveAbsolutePath('library', 'file.ts', null, null)).toBe('');
    expect(resolveAbsolutePath('deliverables', 'file.ts', null, null)).toBe('');
  });
});
