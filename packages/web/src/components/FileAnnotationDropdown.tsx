import { useState, useEffect, useRef } from 'react';
import type { FileAnnotations } from '../types/fileAnnotations';

interface FileAnnotationDropdownProps {
  annotations: FileAnnotations;
  onSendAll: () => void;
  onSendSingle: (id: string) => void;
  onRemove: (id: string) => void;
  onCancelAll?: () => void;
  onScrollTo?: (id: string) => void;
  isSent: (id: string) => boolean;
  sendableCount: number;
}

const TYPE_SYMBOL: Record<string, string> = {
  insert: '+', delete: '−', replace: '⇄', comment: '?',
};

export function FileAnnotationDropdown({ annotations, onSendAll, onSendSingle, onRemove, onCancelAll, onScrollTo, isSent, sendableCount }: FileAnnotationDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = annotations.items.length;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (count === 0) return null;

  return (
    <div ref={ref} className="fv-ann-dropdown">
      <button className="fv-ann-dropdown__trigger" onClick={() => setOpen((v) => !v)}>
        {count} annotation{count !== 1 ? 's' : ''} ▾
      </button>
      {open && (
        <div className="fv-ann-dropdown__panel">
          <div className="fv-ann-dropdown__header">
            <button className="fv-ann-dropdown__send-all" onClick={onSendAll} disabled={sendableCount === 0}>
              {sendableCount === 0 ? 'All Sent' : `Send All (${sendableCount})`}
            </button>
            {onCancelAll && (
              <button className="fv-ann-dropdown__cancel-all" onClick={onCancelAll}>Cancel All</button>
            )}
          </div>
          <div className="fv-ann-dropdown__list">
            {annotations.items.map((a) => (
              <div key={a.id} className="fv-ann-dropdown__item">
                <span className={`fv-ann-dropdown__type fv-ann-dropdown__type--${a.type}`}>
                  {TYPE_SYMBOL[a.type]}
                </span>
                <span
                  className={`fv-ann-dropdown__text${onScrollTo ? ' fv-ann-dropdown__text--clickable' : ''}`}
                  onClick={onScrollTo ? () => onScrollTo(a.id) : undefined}
                >
                  {(a.content ?? a.selected_text).slice(0, 60)}
                </span>
                <button className="fv-ann-dropdown__btn" onClick={() => onSendSingle(a.id)} disabled={isSent(a.id)}>
                  {isSent(a.id) ? '✓' : 'Send'}
                </button>
                <button className="fv-ann-dropdown__btn fv-ann-dropdown__btn--danger" onClick={() => onRemove(a.id)}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
