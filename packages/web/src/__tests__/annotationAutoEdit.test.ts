/**
 * Annotation editing flow tests.
 *
 * Desired behavior:
 * 1. User selects text → selection float appears at (x, y)
 * 2. User clicks action button (Replace/Comment/Insert) →
 *    annotation created, selection float replaced by edit float at same (x, y)
 * 3. User types content → save → edit float dismissed
 * 4. Delete action: no edit float (no content needed)
 *
 * Key invariant: editing happens IN-PLACE (near selected text),
 * NOT at the bottom of the document in annotation cards.
 */

import { describe, it, expect } from 'vitest';

// ── Pure logic extracted from FileViewerRender ───────────────────────────

type AnnotationType = 'insert' | 'delete' | 'replace' | 'comment';

interface SelectionFloat {
  x: number;
  y: number;
  text: string;
}

interface EditFloat {
  x: number;
  y: number;
  annotationId: string;
}

function needsEditFloat(type: AnnotationType): boolean {
  return type !== 'delete';
}

/**
 * Simulate the state transition when an annotation action button is clicked.
 * Returns the new editFloat state (null for delete, positioned for others).
 */
function onAnnotationAction(
  type: AnnotationType,
  selectionFloat: SelectionFloat,
  annotationId: string,
): { editFloat: EditFloat | null; selectionFloat: null } {
  return {
    selectionFloat: null, // always dismiss selection float
    editFloat: needsEditFloat(type)
      ? { x: selectionFloat.x, y: selectionFloat.y, annotationId }
      : null,
  };
}

/**
 * Simulate saving the edit float.
 */
function onEditFloatSave(
  editFloat: EditFloat | null,
  content: string,
): { editFloat: null; shouldUpdate: boolean } {
  return {
    editFloat: null,
    shouldUpdate: editFloat !== null && content.trim().length > 0,
  };
}

/**
 * Simulate canceling the edit float (Escape / Cancel button).
 * Should remove the pending annotation since the user abandoned editing.
 */
function onEditFloatCancel(
  editFloat: EditFloat | null,
  annotations: string[],
): { editFloat: null; annotations: string[] } {
  return {
    editFloat: null,
    annotations: editFloat
      ? annotations.filter((id) => id !== editFloat.annotationId)
      : annotations,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('annotation edit float — state transitions', () => {
  const SELECTION: SelectionFloat = { x: 100, y: 200, text: 'selected text' };

  describe('action button click', () => {
    it('insert → creates editFloat at selection position', () => {
      const result = onAnnotationAction('insert', SELECTION, 'ann_1');
      expect(result.selectionFloat).toBeNull();
      expect(result.editFloat).toEqual({ x: 100, y: 200, annotationId: 'ann_1' });
    });

    it('replace → creates editFloat at selection position', () => {
      const result = onAnnotationAction('replace', SELECTION, 'ann_2');
      expect(result.editFloat).toEqual({ x: 100, y: 200, annotationId: 'ann_2' });
    });

    it('comment → creates editFloat at selection position', () => {
      const result = onAnnotationAction('comment', SELECTION, 'ann_3');
      expect(result.editFloat).toEqual({ x: 100, y: 200, annotationId: 'ann_3' });
    });

    it('delete → no editFloat (no content needed)', () => {
      const result = onAnnotationAction('delete', SELECTION, 'ann_4');
      expect(result.selectionFloat).toBeNull();
      expect(result.editFloat).toBeNull();
    });

    it('always dismisses selection float', () => {
      for (const type of ['insert', 'replace', 'comment', 'delete'] as AnnotationType[]) {
        const result = onAnnotationAction(type, SELECTION, 'ann');
        expect(result.selectionFloat).toBeNull();
      }
    });
  });

  describe('edit float save', () => {
    const EDIT: EditFloat = { x: 100, y: 200, annotationId: 'ann_1' };

    it('save with content → clears editFloat + shouldUpdate', () => {
      const result = onEditFloatSave(EDIT, 'new content');
      expect(result.editFloat).toBeNull();
      expect(result.shouldUpdate).toBe(true);
    });

    it('save with empty string → clears editFloat + no update', () => {
      const result = onEditFloatSave(EDIT, '');
      expect(result.editFloat).toBeNull();
      expect(result.shouldUpdate).toBe(false);
    });

    it('save with whitespace only → clears editFloat + no update', () => {
      const result = onEditFloatSave(EDIT, '   ');
      expect(result.editFloat).toBeNull();
      expect(result.shouldUpdate).toBe(false);
    });

    it('save when editFloat is null → no update', () => {
      const result = onEditFloatSave(null, 'content');
      expect(result.shouldUpdate).toBe(false);
    });
  });

  describe('edit float cancel', () => {
    const EDIT: EditFloat = { x: 100, y: 200, annotationId: 'ann_1' };

    it('cancel → clears editFloat', () => {
      const result = onEditFloatCancel(EDIT, ['ann_1', 'ann_2']);
      expect(result.editFloat).toBeNull();
    });

    it('cancel → removes the pending annotation from the list', () => {
      const result = onEditFloatCancel(EDIT, ['ann_1', 'ann_2']);
      expect(result.annotations).toEqual(['ann_2']);
      expect(result.annotations).not.toContain('ann_1');
    });

    it('cancel with null editFloat → annotations unchanged', () => {
      const result = onEditFloatCancel(null, ['ann_1', 'ann_2']);
      expect(result.annotations).toEqual(['ann_1', 'ann_2']);
    });
  });

  describe('edit float position matches selection', () => {
    it('editFloat inherits exact (x, y) from selection float', () => {
      const sel: SelectionFloat = { x: 350, y: 42, text: 'foo' };
      const result = onAnnotationAction('comment', sel, 'ann_5');
      expect(result.editFloat!.x).toBe(350);
      expect(result.editFloat!.y).toBe(42);
    });
  });
});

describe('needsEditFloat', () => {
  it.each(['replace', 'comment', 'insert'] as AnnotationType[])('%s → true', (type) => {
    expect(needsEditFloat(type)).toBe(true);
  });

  it('delete → false', () => {
    expect(needsEditFloat('delete')).toBe(false);
  });
});

// ── Float positioning pure functions ────────────────────────────────────

/** Calculate float position in container absolute coordinates */
function calcFloatPosition(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number },
  scrollTop: number,
  scrollLeft: number,
): { x: number; y: number } {
  return {
    x: clientX - containerRect.left + scrollLeft,
    y: clientY - containerRect.top + scrollTop,
  };
}

/** Calculate edit float position — below the selection */
function calcEditFloatPosition(
  selectionBottomY: number,
  floatX: number,
): { x: number; y: number } {
  return { x: floatX, y: selectionBottomY + 8 };
}

describe('calcFloatPosition — viewport→absolute coordinate conversion', () => {
  it('no scroll: position = clientXY - containerXY', () => {
    const result = calcFloatPosition(400, 300, { left: 100, top: 50 }, 0, 0);
    expect(result).toEqual({ x: 300, y: 250 });
  });

  it('with scrollTop: adds scrollTop offset', () => {
    const result = calcFloatPosition(400, 300, { left: 100, top: 50 }, 1000, 0);
    expect(result).toEqual({ x: 300, y: 1250 });
  });

  it('with scrollLeft: adds scrollLeft offset', () => {
    const result = calcFloatPosition(400, 300, { left: 100, top: 50 }, 0, 200);
    expect(result).toEqual({ x: 500, y: 250 });
  });

  it('with both scrollTop and scrollLeft', () => {
    const result = calcFloatPosition(400, 300, { left: 100, top: 50 }, 1000, 200);
    expect(result).toEqual({ x: 500, y: 1250 });
  });
});

describe('calcEditFloatPosition — below selection with gap', () => {
  it('y = selectionBottom + 8px gap', () => {
    const result = calcEditFloatPosition(500, 150);
    expect(result).toEqual({ x: 150, y: 508 });
  });

  it('preserves x from float', () => {
    const result = calcEditFloatPosition(200, 42);
    expect(result.x).toBe(42);
  });
});

// ── Highlight pure function tests ─────────────────────────────────────

import {
  captureSelectionRects,
  computeBottomY,
  addHighlight,
  removeHighlight,
  formatTagLabel,
  computeScrollTarget,
  computeMarginAnchor,
  scaleRect,
  scaleHighlightCoords,
  scaleRectWithOffset,
  scaleHighlightCoordsWithOffset,
  computeZoomScrollTop,
  rebuildHighlightsFromAnnotations,
} from '../utils/annotationHighlight';
import type { HighlightsMap } from '../utils/annotationHighlight';

describe('captureSelectionRects', () => {
  const CONTAINER = { left: 100, top: 50, width: 600, height: 400 };

  it('no scroll: position = clientRect - containerRect', () => {
    const clientRects = [{ x: 200, y: 100, width: 120, height: 20 }];
    const result = captureSelectionRects(clientRects, CONTAINER, 0, 0);
    expect(result).toEqual([{ x: 100, y: 50, width: 120, height: 20 }]);
  });

  it('with scroll: adds scrollTop/scrollLeft', () => {
    const clientRects = [{ x: 200, y: 100, width: 120, height: 20 }];
    const result = captureSelectionRects(clientRects, CONTAINER, 500, 30);
    expect(result).toEqual([{ x: 130, y: 550, width: 120, height: 20 }]);
  });

  it('filters zero-size rects', () => {
    const clientRects = [
      { x: 200, y: 100, width: 120, height: 20 },
      { x: 200, y: 120, width: 0, height: 20 },
      { x: 200, y: 140, width: 120, height: 0 },
    ];
    const result = captureSelectionRects(clientRects, CONTAINER, 0, 0);
    expect(result).toHaveLength(1);
  });

  it('empty array returns empty', () => {
    expect(captureSelectionRects([], CONTAINER, 0, 0)).toEqual([]);
  });
});

describe('computeBottomY', () => {
  it('single rect: y + height + 8', () => {
    expect(computeBottomY([{ x: 0, y: 100, width: 50, height: 20 }])).toBe(128);
  });

  it('multiple rects: takes max bottom + 8', () => {
    const rects = [
      { x: 0, y: 100, width: 50, height: 20 },
      { x: 0, y: 200, width: 50, height: 30 },
      { x: 0, y: 150, width: 50, height: 10 },
    ];
    expect(computeBottomY(rects)).toBe(238); // 200+30+8
  });

  it('empty array returns 0', () => {
    expect(computeBottomY([])).toBe(0);
  });
});

describe('addHighlight / removeHighlight', () => {
  const RECTS = [{ x: 10, y: 20, width: 100, height: 16 }];

  it('adds to empty map with default scale 1.0', () => {
    const result = addHighlight({}, 'a1', RECTS, 'comment');
    expect(result.a1).toEqual({ rects: RECTS, bottomY: 44, type: 'comment', capturedScale: 1.0 });
  });

  it('stores capturedScale when provided', () => {
    const result = addHighlight({}, 'a1', RECTS, 'comment', 1.5);
    expect(result.a1.capturedScale).toBe(1.5);
  });

  it('overwrites same id', () => {
    const m1 = addHighlight({}, 'a1', RECTS, 'comment');
    const newRects = [{ x: 0, y: 0, width: 50, height: 10 }];
    const m2 = addHighlight(m1, 'a1', newRects, 'replace', 2.0);
    expect(m2.a1.type).toBe('replace');
    expect(m2.a1.rects).toEqual(newRects);
    expect(m2.a1.capturedScale).toBe(2.0);
  });

  it('multiple entries coexist', () => {
    let m: HighlightsMap = {};
    m = addHighlight(m, 'a1', RECTS, 'comment');
    m = addHighlight(m, 'a2', RECTS, 'delete');
    expect(Object.keys(m)).toHaveLength(2);
  });

  it('remove deletes entry, others unaffected', () => {
    let m: HighlightsMap = {};
    m = addHighlight(m, 'a1', RECTS, 'comment');
    m = addHighlight(m, 'a2', RECTS, 'delete');
    const result = removeHighlight(m, 'a1');
    expect(result.a1).toBeUndefined();
    expect(result.a2).toBeDefined();
  });

  it('remove non-existent id returns same map', () => {
    const m = addHighlight({}, 'a1', RECTS, 'comment');
    const result = removeHighlight(m, 'nope');
    expect(result).toEqual(m);
  });
});

describe('formatTagLabel', () => {
  it('delete → "Delete" (no content preview)', () => {
    expect(formatTagLabel('delete')).toBe('Delete');
    expect(formatTagLabel('delete', 'ignored')).toBe('Delete');
  });

  it('replace + long content → truncated with ...', () => {
    const long = 'Replace this with something that is very long text here';
    const label = formatTagLabel('replace', long);
    expect(label.startsWith('⇄ ')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(35); // "⇄ " + 30 + "..."
    expect(label.endsWith('...')).toBe(true);
  });

  it('comment + short content → no truncation', () => {
    expect(formatTagLabel('comment', 'short')).toBe('💬 short');
  });

  it('no content → type symbol only', () => {
    expect(formatTagLabel('insert')).toBe('+');
    expect(formatTagLabel('replace')).toBe('⇄');
    expect(formatTagLabel('comment')).toBe('💬');
  });
});

describe('computeMarginAnchor', () => {
  it('single rect → midpoint Y', () => {
    const rects = [{ x: 50, y: 100, width: 200, height: 20 }];
    expect(computeMarginAnchor(rects)).toBe(110); // 100 + 20/2
  });

  it('multiple rects → average of first and last midpoints', () => {
    const rects = [
      { x: 50, y: 100, width: 200, height: 20 },
      { x: 50, y: 140, width: 200, height: 20 },
    ];
    // first mid = 110, last mid = 150, average = 130
    expect(computeMarginAnchor(rects)).toBe(130);
  });

  it('rightmost X of all rects', () => {
    const rects = [
      { x: 50, y: 100, width: 200, height: 20 },
      { x: 100, y: 120, width: 300, height: 20 },
    ];
    expect(computeMarginAnchor(rects)).toBe(120); // avg mid Y
  });

  it('empty rects → 0', () => {
    expect(computeMarginAnchor([])).toBe(0);
  });
});

describe('computeScrollTarget', () => {
  const RECTS = [{ x: 10, y: 500, width: 100, height: 16 }];

  it('has highlight → topRect.y - containerHeight/4, min 0', () => {
    const map: HighlightsMap = { a1: { rects: RECTS, bottomY: 524, type: 'comment', capturedScale: 1 } };
    const target = computeScrollTarget(map, 'a1', 800);
    expect(target).toBe(500 - 200); // 500 - 800/4
  });

  it('clamps to 0 when rect near top', () => {
    const nearTop = [{ x: 10, y: 50, width: 100, height: 16 }];
    const map: HighlightsMap = { a1: { rects: nearTop, bottomY: 74, type: 'comment', capturedScale: 1 } };
    const target = computeScrollTarget(map, 'a1', 800);
    expect(target).toBe(0); // 50 - 200 < 0 → 0
  });

  it('no highlight → null', () => {
    expect(computeScrollTarget({}, 'a1', 800)).toBeNull();
  });
});

describe('scaleRect — proportional scaling of a single rect', () => {
  const RECT = { x: 100, y: 200, width: 300, height: 20 };

  it('ratio 1.0 → unchanged', () => {
    expect(scaleRect(RECT, 1.0)).toEqual(RECT);
  });

  it('ratio 2.0 → doubles all values', () => {
    expect(scaleRect(RECT, 2.0)).toEqual({ x: 200, y: 400, width: 600, height: 40 });
  });

  it('ratio 0.5 → halves all values', () => {
    expect(scaleRect(RECT, 0.5)).toEqual({ x: 50, y: 100, width: 150, height: 10 });
  });
});

describe('scaleHighlightCoords — apply ratio to all rects/bottomY', () => {
  it('scales rects and bottomY proportionally', () => {
    const hl = { rects: [{ x: 10, y: 20, width: 100, height: 16 }], bottomY: 44, type: 'comment' as const, capturedScale: 1.0 };
    const scaled = scaleHighlightCoords(hl, 2.0);
    expect(scaled.rects).toEqual([{ x: 20, y: 40, width: 200, height: 32 }]);
    expect(scaled.bottomY).toBe(88);
  });

  it('ratio 1.0 → same values', () => {
    const hl = { rects: [{ x: 10, y: 20, width: 100, height: 16 }], bottomY: 44, type: 'delete' as const, capturedScale: 1.0 };
    const scaled = scaleHighlightCoords(hl, 1.0);
    expect(scaled.rects).toEqual(hl.rects);
    expect(scaled.bottomY).toBe(hl.bottomY);
  });

  it('multiple rects all scale', () => {
    const hl = {
      rects: [
        { x: 0, y: 0, width: 100, height: 10 },
        { x: 50, y: 20, width: 200, height: 10 },
      ],
      bottomY: 38,
      type: 'replace' as const,
      capturedScale: 1.0,
    };
    const scaled = scaleHighlightCoords(hl, 1.5);
    expect(scaled.rects[0]).toEqual({ x: 0, y: 0, width: 150, height: 15 });
    expect(scaled.rects[1]).toEqual({ x: 75, y: 30, width: 300, height: 15 });
    expect(scaled.bottomY).toBe(57);
  });
});

describe('scaleRectWithOffset — excludes fixed padding from scaling', () => {
  const RECT = { x: 124, y: 520, width: 300, height: 20 };
  // Container padding: left=24, top=20
  // So content starts at (24, 20). Position within content = (100, 500).

  it('ratio 1.0 → unchanged', () => {
    expect(scaleRectWithOffset(RECT, 1.0, 24, 20)).toEqual(RECT);
  });

  it('ratio 1.5 → scales content portion only', () => {
    // x: 24 + (124-24)*1.5 = 24 + 150 = 174
    // y: 20 + (520-20)*1.5 = 20 + 750 = 770
    const result = scaleRectWithOffset(RECT, 1.5, 24, 20);
    expect(result).toEqual({ x: 174, y: 770, width: 450, height: 30 });
  });

  it('ratio 2.0 → doubles content portion, padding stays fixed', () => {
    // x: 24 + (124-24)*2 = 24 + 200 = 224
    // y: 20 + (520-20)*2 = 20 + 1000 = 1020
    const result = scaleRectWithOffset(RECT, 2.0, 24, 20);
    expect(result).toEqual({ x: 224, y: 1020, width: 600, height: 40 });
  });
});

describe('scaleHighlightCoordsWithOffset — applies offset-aware scaling to all rects', () => {
  it('scales rects and bottomY with padding offset', () => {
    const hl = {
      rects: [{ x: 124, y: 520, width: 300, height: 20 }],
      bottomY: 548, // 520 + 20 + 8
      type: 'comment' as const,
      capturedScale: 1.0,
    };
    const scaled = scaleHighlightCoordsWithOffset(hl, 1.5, 24, 20);
    expect(scaled.rects[0]).toEqual({ x: 174, y: 770, width: 450, height: 30 });
    // bottomY: 20 + (548-20)*1.5 = 20 + 792 = 812
    expect(scaled.bottomY).toBe(812);
  });

  it('capturedScale=pdfScale: at capture zoom ratio=1, at different zoom scales proportionally', () => {
    // 在 zoom 1.5 时创建 → capturedScale=1.5 → 显示在 zoom 1.5: ratio=1.0
    const capturedZoom = 1.5;
    const hl = addHighlight({}, 'a1', [{ x: 174, y: 770, width: 450, height: 30 }], 'comment', capturedZoom);
    expect(hl.a1.capturedScale).toBe(1.5);
    const sameZoomRatio = capturedZoom / hl.a1.capturedScale;
    expect(sameZoomRatio).toBe(1.0);

    // 显示在 zoom 2.0 → ratio = 2.0/1.5 ≈ 1.333
    const displayZoom = 2.0;
    const crossZoomRatio = displayZoom / hl.a1.capturedScale;
    const result = scaleHighlightCoordsWithOffset(hl.a1, crossZoomRatio, 24, 20);
    // x: 24 + (174-24)*1.333 = 24 + 200 = 224
    expect(result.rects[0].x).toBeCloseTo(224, 0);
    expect(result.rects[0].width).toBeCloseTo(600, 0);
  });

  it('capturedScale=1 is WRONG for non-1.0 zoom: causes double-scaling', () => {
    // 在 zoom 1.5 时创建，getClientRects 返回已 zoom 的坐标
    // 内部文本位置 P=100 → container-relative = 24 + 100*1.5 = 174
    const capturedX = 174;
    const capturedZoom = 1.5;

    // 正确: capturedScale=pdfScale → 同 zoom 下 ratio=1, 无缩放
    const correctHl = addHighlight({}, 'a1', [{ x: capturedX, y: 50, width: 450, height: 30 }], 'comment', capturedZoom);
    const correctRatio = capturedZoom / correctHl.a1.capturedScale; // 1.0
    const correctResult = scaleHighlightCoordsWithOffset(correctHl.a1, correctRatio, 24, 20);
    expect(correctResult.rects[0].x).toBe(capturedX); // 不变 ✓

    // 错误: capturedScale=1 → 同 zoom 下 ratio=1.5, 双重缩放!
    const wrongHl = addHighlight({}, 'a1', [{ x: capturedX, y: 50, width: 450, height: 30 }], 'comment', 1);
    const wrongRatio = capturedZoom / wrongHl.a1.capturedScale; // 1.5
    const wrongResult = scaleHighlightCoordsWithOffset(wrongHl.a1, wrongRatio, 24, 20);
    // x = 24 + (174-24)*1.5 = 24 + 225 = 249 ← 偏移了!
    expect(wrongResult.rects[0].x).toBeCloseTo(249, 0);
    expect(wrongResult.rects[0].x).not.toBeCloseTo(capturedX, 0); // 证明双重缩放
  });
});

describe('computeZoomScrollTop — adjusts scroll position on zoom change', () => {
  it('scales scrollTop proportionally around padding offset', () => {
    // scrollTop=520, oldScale=1.0, newScale=1.5, paddingY=20
    // newScroll = 20 + (520 - 20) * (1.5 / 1.0) = 20 + 750 = 770
    const result = computeZoomScrollTop(520, 1.0, 1.5, 20);
    expect(result).toBe(770);
  });

  it('returns 0 when scrollTop is at origin', () => {
    const result = computeZoomScrollTop(0, 1.0, 2.0, 20);
    expect(result).toBe(0);
  });

  it('keeps scrollTop unchanged when scale ratio is 1', () => {
    const result = computeZoomScrollTop(300, 1.5, 1.5, 20);
    expect(result).toBe(300);
  });

  it('zooming out reduces scrollTop', () => {
    // scrollTop=770, oldScale=1.5, newScale=1.0
    // newScroll = 20 + (770-20)*(1.0/1.5) = 20 + 500 = 520
    const result = computeZoomScrollTop(770, 1.5, 1.0, 20);
    expect(result).toBeCloseTo(520, 0);
  });
});

describe('rebuildHighlightsFromAnnotations — restores highlights from persisted data', () => {
  it('rebuilds HighlightsMap from annotations with rects', () => {
    const annotations = [
      { id: 'a1', type: 'comment' as const, highlightRects: [{ x: 100, y: 200, width: 300, height: 20 }], capturedScale: 1.5 },
      { id: 'a2', type: 'replace' as const, highlightRects: [{ x: 50, y: 80, width: 200, height: 15 }], capturedScale: 1.0 },
    ];
    const result = rebuildHighlightsFromAnnotations(annotations);
    expect(Object.keys(result)).toEqual(['a1', 'a2']);
    expect(result.a1.rects).toEqual([{ x: 100, y: 200, width: 300, height: 20 }]);
    expect(result.a1.capturedScale).toBe(1.5);
    expect(result.a1.type).toBe('comment');
    expect(result.a2.capturedScale).toBe(1.0);
  });

  it('skips annotations without rects', () => {
    const annotations = [
      { id: 'a1', type: 'comment' as const },
      { id: 'a2', type: 'replace' as const, highlightRects: [{ x: 10, y: 20, width: 100, height: 12 }], capturedScale: 1.0 },
    ];
    const result = rebuildHighlightsFromAnnotations(annotations);
    expect(Object.keys(result)).toEqual(['a2']);
  });

  it('returns empty map for empty annotations', () => {
    const result = rebuildHighlightsFromAnnotations([]);
    expect(result).toEqual({});
  });
});
