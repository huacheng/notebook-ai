// Annotation highlight pure functions — session-level transient state

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationHighlight {
  rects: Rect[];
  bottomY: number;
  type: 'insert' | 'delete' | 'replace' | 'comment';
  capturedScale: number;
}

export type HighlightsMap = Record<string, AnnotationHighlight>;

/** Convert DOMRect-like client rects to container-relative coordinates. */
export function captureSelectionRects(
  clientRects: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  containerRect: { left: number; top: number },
  scrollTop: number,
  scrollLeft: number,
): Rect[] {
  const result: Rect[] = [];
  for (const r of clientRects) {
    if (r.width <= 0 || r.height <= 0) continue;
    result.push({
      x: r.x - containerRect.left + scrollLeft,
      y: r.y - containerRect.top + scrollTop,
      width: r.width,
      height: r.height,
    });
  }
  return result;
}

/** Compute the bottom Y position (lowest rect bottom + 8px gap). */
export function computeBottomY(rects: ReadonlyArray<Rect>): number {
  if (rects.length === 0) return 0;
  let maxBottom = 0;
  for (const r of rects) {
    const bottom = r.y + r.height;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return maxBottom + 8;
}

/** Add or overwrite a highlight entry. */
export function addHighlight(
  map: HighlightsMap,
  id: string,
  rects: Rect[],
  type: AnnotationHighlight['type'],
  scale: number = 1.0,
): HighlightsMap {
  return { ...map, [id]: { rects, bottomY: computeBottomY(rects), type, capturedScale: scale } };
}

/** Remove a highlight entry (returns same ref if id not present). */
export function removeHighlight(map: HighlightsMap, id: string): HighlightsMap {
  if (!(id in map)) return map;
  const { [id]: _, ...rest } = map;
  return rest;
}

export function rekeyHighlight(map: HighlightsMap, oldId: string, newId: string): HighlightsMap {
  if (!(oldId in map)) return map;
  const { [oldId]: entry, ...rest } = map;
  return { ...rest, [newId]: entry };
}

const TYPE_SYMBOLS: Record<string, string> = {
  insert: '+',
  delete: 'Delete',
  replace: '⇄',
  comment: '💬',
};

const MAX_CONTENT_LEN = 30;

/** Format the inline tag label for a highlight. */
export function formatTagLabel(type: string, content?: string): string {
  if (type === 'delete') return 'Delete';
  const sym = TYPE_SYMBOLS[type] ?? type;
  if (!content) return sym;
  const preview = content.length > MAX_CONTENT_LEN
    ? content.slice(0, MAX_CONTENT_LEN) + '...'
    : content;
  return `${sym} ${preview}`;
}

/** Compute the vertical midpoint of a highlight's rects (for connecting line anchor). */
export function computeMarginAnchor(rects: ReadonlyArray<Rect>): number {
  if (rects.length === 0) return 0;
  const firstMid = rects[0].y + rects[0].height / 2;
  const lastR = rects[rects.length - 1];
  const lastMid = lastR.y + lastR.height / 2;
  return (firstMid + lastMid) / 2;
}

/** Scale a single rect by a ratio. */
export function scaleRect(r: Rect, ratio: number): Rect {
  if (ratio === 1) return r;
  return { x: r.x * ratio, y: r.y * ratio, width: r.width * ratio, height: r.height * ratio };
}

/**
 * Scale a rect by ratio, but exclude a fixed offset (e.g. container padding)
 * that doesn't participate in content scaling.
 * Formula: newPos = offset + (capturedPos - offset) * ratio
 */
export function scaleRectWithOffset(r: Rect, ratio: number, offsetX: number, offsetY: number): Rect {
  if (ratio === 1) return r;
  return {
    x: offsetX + (r.x - offsetX) * ratio,
    y: offsetY + (r.y - offsetY) * ratio,
    width: r.width * ratio,
    height: r.height * ratio,
  };
}

/** Scale all coordinates in a highlight by a ratio. */
export function scaleHighlightCoords(hl: AnnotationHighlight, ratio: number): { rects: Rect[]; bottomY: number } {
  if (ratio === 1) return { rects: hl.rects, bottomY: hl.bottomY };
  const rects = hl.rects.map(r => scaleRect(r, ratio));
  return { rects, bottomY: hl.bottomY * ratio };
}

/** Scale all coordinates with a fixed offset excluded from scaling. */
export function scaleHighlightCoordsWithOffset(
  hl: AnnotationHighlight,
  ratio: number,
  offsetX: number,
  offsetY: number,
): { rects: Rect[]; bottomY: number } {
  if (ratio === 1) return { rects: hl.rects, bottomY: hl.bottomY };
  const rects = hl.rects.map(r => scaleRectWithOffset(r, ratio, offsetX, offsetY));
  const bottomY = offsetY + (hl.bottomY - offsetY) * ratio;
  return { rects, bottomY };
}

/** Compute adjusted scrollTop when zoom scale changes, keeping content position stable. */
export function computeZoomScrollTop(
  oldScrollTop: number,
  oldScale: number,
  newScale: number,
  paddingY: number,
): number {
  if (oldScale === newScale) return oldScrollTop;
  if (oldScrollTop <= 0) return 0;
  const ratio = newScale / oldScale;
  return paddingY + (oldScrollTop - paddingY) * ratio;
}

/** Rebuild HighlightsMap from persisted annotation data (for restoring highlights after re-open). */
export function rebuildHighlightsFromAnnotations(
  annotations: ReadonlyArray<{
    id: string;
    type: AnnotationHighlight['type'];
    highlightRects?: Rect[];
    capturedScale?: number;
  }>,
): HighlightsMap {
  const map: HighlightsMap = {};
  for (const ann of annotations) {
    if (!ann.highlightRects || ann.highlightRects.length === 0) continue;
    map[ann.id] = {
      rects: ann.highlightRects,
      bottomY: computeBottomY(ann.highlightRects),
      type: ann.type,
      capturedScale: ann.capturedScale ?? 1.0,
    };
  }
  return map;
}

/** Compute scroll target Y for a given annotation's highlight. */
export function computeScrollTarget(
  highlights: HighlightsMap,
  annotationId: string,
  containerHeight: number,
): number | null {
  const hl = highlights[annotationId];
  if (!hl || hl.rects.length === 0) return null;
  const topY = Math.min(...hl.rects.map((r) => r.y));
  return Math.max(0, topY - containerHeight / 4);
}
