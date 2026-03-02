/**
 * useCellLazyLoad - Hook for lazy loading cell content on visibility
 *
 * Uses Intersection Observer to detect when a cell stub becomes visible,
 * then requests the full cell content from the server.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../store';

/** D6: Named constant for preload distance (pixels before entering viewport) */
const PRELOAD_MARGIN = '200px';

export interface CellStub {
  id: string;
  type: string;
  source_preview: string;
  output_count: number;
  status: string;
  _stub: true;
}

/**
 * Check if a cell object is a stub (not fully loaded)
 */
export function isCellStub(cell: unknown): cell is CellStub {
  return (
    typeof cell === 'object' &&
    cell !== null &&
    '_stub' in cell &&
    (cell as CellStub)._stub === true
  );
}

/**
 * Hook to trigger lazy loading when a cell stub becomes visible
 *
 * @param cellId - The cell ID to potentially load
 * @param isStub - Whether this cell is a stub that needs loading
 * @returns ref to attach to the cell element
 */
export function useCellLazyLoad(cellId: string, isStub: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const requestCellLoad = useStore((s) => s.requestCellLoad);
  const loadingCellIds = useStore((s) => s.loadingCellIds);

  const isLoading = loadingCellIds.has(cellId);

  useEffect(() => {
    if (!isStub || isLoading) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          requestCellLoad(cellId);
          observer.disconnect();
        }
      },
      {
        root: null, // viewport
        rootMargin: PRELOAD_MARGIN, // preload slightly before visible
        threshold: 0,
      }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [cellId, isStub, isLoading, requestCellLoad]);

  return { ref, isLoading };
}
