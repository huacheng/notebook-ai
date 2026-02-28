/**
 * annotationPrompt tests — JSONL annotation serialization + helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  isTaskSystemFile,
  resolveAbsolutePath,
  buildSingleAnnotationPrompt,
  buildAnnotationPrompt,
  type FileAnnotation,
} from '../types/fileAnnotations';

function makeAnn(overrides: Partial<FileAnnotation> & { type: FileAnnotation['type'] }): FileAnnotation {
  return {
    id: 'ann_test', type: 'comment', file_path: 'f.md',
    selected_text: 'selected',
    absolute_path: '/home/u/ws/proj/.working/.target.md',
    textOffset: 10,
    author: 'user', timestamp: '', updatedAt: 0,
    ...overrides,
  };
}

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

describe('buildSingleAnnotationPrompt', () => {
  const fullText = '0123456789selected0123456789012345678901234567890123456789';
  //                 0         10      18

  it('produces valid JSON with correct fields (replace type)', () => {
    const ann = makeAnn({ type: 'replace', selected_text: 'selected', content: 'new text', textOffset: 10 });
    const line = buildSingleAnnotationPrompt(ann, fullText);
    const obj = JSON.parse(line);
    expect(obj.type).toBe('replace');
    expect(obj.file).toBe('/home/u/ws/proj/.working/.target.md');
    expect(obj.selected_text).toBe('selected');
    expect(obj.replacement).toBe('new text');
    expect(obj.before).toBe('0123456789');
    expect(obj.after).toHaveLength(40);
  });

  it('caps before/after at 40 chars', () => {
    const longText = 'A'.repeat(60) + 'selected' + 'B'.repeat(60);
    const ann = makeAnn({ type: 'comment', selected_text: 'selected', content: 'note', textOffset: 60 });
    const line = buildSingleAnnotationPrompt(ann, longText);
    const obj = JSON.parse(line);
    expect(obj.before.length).toBeLessThanOrEqual(40);
    expect(obj.after.length).toBeLessThanOrEqual(40);
  });

  it('insert type has content field, no replacement/comment', () => {
    const ann = makeAnn({ type: 'insert', content: 'inserted text', textOffset: 10 });
    const line = buildSingleAnnotationPrompt(ann, fullText);
    const obj = JSON.parse(line);
    expect(obj.type).toBe('insert');
    expect(obj.content).toBe('inserted text');
    expect(obj.replacement).toBeUndefined();
    expect(obj.comment).toBeUndefined();
  });

  it('delete type has no content/replacement/comment', () => {
    const ann = makeAnn({ type: 'delete', textOffset: 10 });
    const line = buildSingleAnnotationPrompt(ann, fullText);
    const obj = JSON.parse(line);
    expect(obj.type).toBe('delete');
    expect(obj.content).toBeUndefined();
    expect(obj.replacement).toBeUndefined();
    expect(obj.comment).toBeUndefined();
  });

  it('textOffset=0 means before is empty', () => {
    const ann = makeAnn({ type: 'comment', content: 'hi', textOffset: 0 });
    const line = buildSingleAnnotationPrompt(ann, fullText);
    const obj = JSON.parse(line);
    expect(obj.before).toBe('');
  });

  it('selection at end means after is empty', () => {
    const text = 'hello world';
    const ann = makeAnn({ type: 'comment', selected_text: 'world', content: 'note', textOffset: 6 });
    const line = buildSingleAnnotationPrompt(ann, text);
    const obj = JSON.parse(line);
    expect(obj.after).toBe('');
  });

  it('escapes quotes, newlines, special chars', () => {
    const text = 'before"quote\nnewline\tafter';
    const ann = makeAnn({
      type: 'comment',
      selected_text: '"quote\nnewline\t',
      content: 'has "quotes"',
      textOffset: 6,
    });
    const line = buildSingleAnnotationPrompt(ann, text);
    // Must be valid JSON (JSON.parse would throw on invalid escape)
    const obj = JSON.parse(line);
    expect(obj.selected_text).toBe('"quote\nnewline\t');
    expect(obj.comment).toBe('has "quotes"');
  });
});

describe('buildAnnotationPrompt', () => {
  const fullText = '0123456789selected0123456789012345678901234567890123456789';

  it('one line per annotation', () => {
    const anns = [
      makeAnn({ type: 'comment', content: 'a', textOffset: 10 }),
      makeAnn({ type: 'delete', textOffset: 10 }),
    ];
    const result = buildAnnotationPrompt(anns, fullText);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    // each line must be valid JSON
    lines.forEach((l) => expect(() => JSON.parse(l)).not.toThrow());
  });

  it('single annotation has no trailing newline', () => {
    const anns = [makeAnn({ type: 'comment', content: 'x', textOffset: 10 })];
    const result = buildAnnotationPrompt(anns, fullText);
    expect(result.endsWith('\n')).toBe(false);
    expect(result.split('\n')).toHaveLength(1);
  });

  it('empty array returns empty string', () => {
    expect(buildAnnotationPrompt([], fullText)).toBe('');
  });
});
