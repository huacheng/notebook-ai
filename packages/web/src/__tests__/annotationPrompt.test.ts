/**
 * annotationPrompt tests — JSONL annotation serialization + helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  isTaskSystemFile,
  resolveAbsolutePath,
  buildSingleAnnotationPrompt,
  buildAnnotationPrompt,
  buildSendPayload,
  canEditFile,
  type FileAnnotation,
} from '../types/fileAnnotations';

function makeAnn(overrides: Partial<FileAnnotation> & { type: FileAnnotation['type'] }): FileAnnotation {
  const { type, ...rest } = overrides;
  return {
    id: 'ann_test', file_path: 'f.md',
    selected_text: 'selected',
    absolute_path: '/home/u/ws/proj/.working/.target.md',
    cursor: 10,
    author: 'user', timestamp: '', updatedAt: 0,
    type,
    ...rest,
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
  it('produces valid JSON with correct fields (replace type)', () => {
    const ann = makeAnn({ type: 'replace', selected_text: 'selected', content: 'new text', cursor: 10 });
    const line = buildSingleAnnotationPrompt(ann);
    const obj = JSON.parse(line);
    expect(obj.type).toBe('replace');
    expect(obj.file).toBe('/home/u/ws/proj/.working/.target.md');
    expect(obj.selected).toBe('selected');
    expect(obj.replacement).toBe('new text');
    expect(obj.cursor).toBe(10);
    expect(obj.before).toBeUndefined();
    expect(obj.after).toBeUndefined();
  });

  it('includes cursor as numeric field in output', () => {
    const ann = makeAnn({ type: 'comment', content: 'note', cursor: 42 });
    const line = buildSingleAnnotationPrompt(ann);
    const obj = JSON.parse(line);
    expect(obj.cursor).toBe(42);
    expect(typeof obj.cursor).toBe('number');
  });

  it('cursor=0 is included (not omitted as falsy)', () => {
    const ann = makeAnn({ type: 'delete', cursor: 0 });
    const line = buildSingleAnnotationPrompt(ann);
    const obj = JSON.parse(line);
    expect(obj.cursor).toBe(0);
  });

  it('insert type has content field, no replacement/comment', () => {
    const ann = makeAnn({ type: 'insert', content: 'inserted text', cursor: 10 });
    const line = buildSingleAnnotationPrompt(ann);
    const obj = JSON.parse(line);
    expect(obj.type).toBe('insert');
    expect(obj.content).toBe('inserted text');
    expect(obj.replacement).toBeUndefined();
    expect(obj.comment).toBeUndefined();
  });

  it('delete type has no content/replacement/comment', () => {
    const ann = makeAnn({ type: 'delete', cursor: 10 });
    const line = buildSingleAnnotationPrompt(ann);
    const obj = JSON.parse(line);
    expect(obj.type).toBe('delete');
    expect(obj.content).toBeUndefined();
    expect(obj.replacement).toBeUndefined();
    expect(obj.comment).toBeUndefined();
  });

  it('escapes quotes, newlines, special chars', () => {
    const ann = makeAnn({
      type: 'comment',
      selected_text: '"quote\nnewline\t',
      content: 'has "quotes"',
      cursor: 6,
    });
    const line = buildSingleAnnotationPrompt(ann);
    // Must be valid JSON (JSON.parse would throw on invalid escape)
    const obj = JSON.parse(line);
    expect(obj.selected).toBe('"quote\nnewline\t');
    expect(obj.comment).toBe('has "quotes"');
  });
});

describe('buildAnnotationPrompt', () => {
  it('one line per annotation', () => {
    const anns = [
      makeAnn({ type: 'comment', content: 'a', cursor: 10 }),
      makeAnn({ type: 'delete', cursor: 10 }),
    ];
    const result = buildAnnotationPrompt(anns);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    // each line must be valid JSON
    lines.forEach((l) => expect(() => JSON.parse(l)).not.toThrow());
  });

  it('single annotation has no trailing newline', () => {
    const anns = [makeAnn({ type: 'comment', content: 'x', cursor: 10 })];
    const result = buildAnnotationPrompt(anns);
    expect(result.endsWith('\n')).toBe(false);
    expect(result.split('\n')).toHaveLength(1);
  });

  it('empty array returns empty string', () => {
    expect(buildAnnotationPrompt([])).toBe('');
  });
});

describe('buildSendPayload', () => {
  it('system file single annotation gets /task-ai:annotate prefix', () => {
    const ann = makeAnn({
      type: 'comment', content: 'fix this',
      absolute_path: '/home/u/ws/.working/.target.md', cursor: 10,
    });
    const result = buildSendPayload([ann]);
    expect(result.startsWith('/task-ai:annotate\n')).toBe(true);
    const jsonl = result.substring('/task-ai:annotate\n'.length);
    expect(() => JSON.parse(jsonl)).not.toThrow();
  });

  it('general file single annotation has no prefix', () => {
    const ann = makeAnn({
      type: 'comment', content: 'fix',
      absolute_path: '/home/u/ws/readme.md', cursor: 10,
    });
    const result = buildSendPayload([ann]);
    expect(result.startsWith('/task-ai:annotate')).toBe(false);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('system file batch gets prefix + multi-line JSONL', () => {
    const anns = [
      makeAnn({ type: 'comment', content: 'a', absolute_path: '/home/u/ws/.working/.plan.md', cursor: 10 }),
      makeAnn({ type: 'delete', absolute_path: '/home/u/ws/.working/.plan.md', cursor: 10 }),
    ];
    const result = buildSendPayload(anns);
    expect(result.startsWith('/task-ai:annotate\n')).toBe(true);
    const jsonl = result.substring('/task-ai:annotate\n'.length);
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(2);
    lines.forEach((l) => expect(() => JSON.parse(l)).not.toThrow());
  });

  it('general file batch has no prefix + multi-line JSONL', () => {
    const anns = [
      makeAnn({ type: 'comment', content: 'a', absolute_path: '/home/u/ws/file.ts', cursor: 10 }),
      makeAnn({ type: 'insert', content: 'b', absolute_path: '/home/u/ws/file.ts', cursor: 10 }),
    ];
    const result = buildSendPayload(anns);
    expect(result.startsWith('/task-ai:annotate')).toBe(false);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    lines.forEach((l) => expect(() => JSON.parse(l)).not.toThrow());
  });

  it('empty array returns empty string', () => {
    expect(buildSendPayload([])).toBe('');
  });
});

describe('canEditFile', () => {
  it('system file + text format returns false', () => {
    expect(canEditFile('text', '/home/u/ws/.working/.target.md')).toBe(false);
  });

  it('system file + html format returns false', () => {
    expect(canEditFile('html', '/home/u/ws/.working/.plan.md')).toBe(false);
  });

  it('general file + text format returns true', () => {
    expect(canEditFile('text', '/home/u/ws/readme.md')).toBe(true);
  });

  it('general file + html format returns true', () => {
    expect(canEditFile('html', '/home/u/ws/index.html')).toBe(true);
  });

  it('binary format always returns false', () => {
    expect(canEditFile('pdf-binary', '/home/u/ws/doc.pdf')).toBe(false);
    expect(canEditFile('docx-binary', '/home/u/ws/doc.docx')).toBe(false);
    expect(canEditFile('xlsx-binary', '/home/u/ws/data.xlsx')).toBe(false);
    expect(canEditFile('pptx-binary', '/home/u/ws/slides.pptx')).toBe(false);
  });

  it('unsupported format returns false', () => {
    expect(canEditFile('unsupported', '/home/u/ws/file.xyz')).toBe(false);
  });

  it('null format returns false', () => {
    expect(canEditFile(null, '/home/u/ws/file.txt')).toBe(false);
  });

  it('empty absolutePath returns true (non-system)', () => {
    expect(canEditFile('text', '')).toBe(true);
  });
});
