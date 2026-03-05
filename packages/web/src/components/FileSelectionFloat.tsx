import React, { useRef, useEffect, useState } from 'react';

interface FileSelectionFloatProps {
  x: number;
  y: number;
  onDelete: () => void;
  onReplace: () => void;
  onComment: () => void;
  onInsertAfter: () => void;
}

export function FileSelectionFloat({ x, y, onDelete, onReplace, onComment, onInsertAfter }: FileSelectionFloatProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [adjustedX, setAdjustedX] = useState(x);

  // Clamp position so the float doesn't overflow the container
  useEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const parentWidth = parent.clientWidth;
    const elWidth = el.offsetWidth;
    if (x + elWidth > parentWidth - 4) {
      setAdjustedX(Math.max(4, parentWidth - elWidth - 4));
    }
  }, [x]);

  // Use both onMouseDown (desktop) and onTouchStart (mobile) for reliable interaction
  const handler = (fn: () => void) => ({
    onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); fn(); },
    onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); fn(); },
  });
  return (
    <div ref={ref} className="fv-selection-float" style={{ top: y, left: adjustedX }}>
      <button className="fv-sf-btn fv-sf-delete" {...handler(onDelete)} title="Delete">−</button>
      <button className="fv-sf-btn fv-sf-replace" {...handler(onReplace)} title="Replace">⇄</button>
      <button className="fv-sf-btn fv-sf-comment" {...handler(onComment)} title="Comment">?</button>
      <button className="fv-sf-btn fv-sf-insert" {...handler(onInsertAfter)} title="Insert after">+</button>
    </div>
  );
}
