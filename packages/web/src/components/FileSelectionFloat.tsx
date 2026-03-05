import React from 'react';

interface FileSelectionFloatProps {
  x: number;
  y: number;
  onDelete: () => void;
  onReplace: () => void;
  onComment: () => void;
  onInsertAfter: () => void;
}

export function FileSelectionFloat({ x, y, onDelete, onReplace, onComment, onInsertAfter }: FileSelectionFloatProps) {
  // Use both onMouseDown (desktop) and onTouchStart (mobile) for reliable interaction
  const handler = (fn: () => void) => ({
    onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); fn(); },
    onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); fn(); },
  });
  return (
    <div className="fv-selection-float" style={{ top: y, left: x }}>
      <button className="fv-sf-btn fv-sf-delete" {...handler(onDelete)} title="Delete">−</button>
      <button className="fv-sf-btn fv-sf-replace" {...handler(onReplace)} title="Replace">⇄</button>
      <button className="fv-sf-btn fv-sf-comment" {...handler(onComment)} title="Comment">?</button>
      <button className="fv-sf-btn fv-sf-insert" {...handler(onInsertAfter)} title="Insert after">+</button>
    </div>
  );
}
