import { describe, it, expect } from 'vitest';
import { collectAnnotationIds, filterSendable } from '../types/fileAnnotations';
import type { FileAnnotation } from '../types/fileAnnotations';

function makeAnn(id: string, overrides?: Partial<FileAnnotation>): FileAnnotation {
  return {
    id,
    type: 'comment',
    file_path: 'test.md',
    absolute_path: '/tmp/test.md',
    selected_text: 'hello',
    content: 'a comment',
    cursor: 0,
    author: 'user',
    timestamp: new Date().toISOString(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('collectAnnotationIds', () => {
  it('returns empty set for empty array', () => {
    expect(collectAnnotationIds([])).toEqual(new Set());
  });
  it('collects all IDs', () => {
    const items = [makeAnn('a1'), makeAnn('a2'), makeAnn('a3')];
    expect(collectAnnotationIds(items)).toEqual(new Set(['a1', 'a2', 'a3']));
  });
});

describe('filterSendable', () => {
  it('returns all items when baseline is empty', () => {
    const items = [makeAnn('a1'), makeAnn('a2')];
    const result = filterSendable(items, new Set());
    expect(result.map(a => a.id)).toEqual(['a1', 'a2']);
  });
  it('excludes items in baseline', () => {
    const items = [makeAnn('a1'), makeAnn('a2'), makeAnn('a3')];
    const baseline = new Set(['a1', 'a3']);
    const result = filterSendable(items, baseline);
    expect(result.map(a => a.id)).toEqual(['a2']);
  });
  it('returns empty when all in baseline', () => {
    const items = [makeAnn('a1')];
    const result = filterSendable(items, new Set(['a1']));
    expect(result).toEqual([]);
  });
});

describe('annotation lifecycle: create → send → edit → resend', () => {
  it('full lifecycle via baseline set', () => {
    const baseline = new Set<string>();
    const ann = makeAnn('ann_1');

    // 1. New annotation — sendable (not in baseline)
    expect(baseline.has(ann.id)).toBe(false);
    expect(filterSendable([ann], baseline)).toHaveLength(1);

    // 2. Send — add to baseline → not sendable
    baseline.add(ann.id);
    expect(filterSendable([ann], baseline)).toHaveLength(0);

    // 3. Edit — generate new ID → sendable again
    const edited = { ...ann, id: 'ann_2', content: 'edited' };
    expect(baseline.has(edited.id)).toBe(false);
    expect(filterSendable([edited], baseline)).toHaveLength(1);

    // 4. Resend — add new ID to baseline → not sendable
    baseline.add(edited.id);
    expect(filterSendable([edited], baseline)).toHaveLength(0);
  });

  it('send all seeds baseline with all current IDs', () => {
    const items = [makeAnn('a1'), makeAnn('a2'), makeAnn('a3')];
    const baseline = collectAnnotationIds(items);

    // All sent
    expect(filterSendable(items, baseline)).toHaveLength(0);

    // Edit one — new ID escapes baseline
    const edited = [{ ...items[0], id: 'a1_v2' }, items[1], items[2]];
    expect(filterSendable(edited, baseline)).toHaveLength(1);
    expect(filterSendable(edited, baseline)[0].id).toBe('a1_v2');
  });
});
