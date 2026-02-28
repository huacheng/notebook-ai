import { useState, useRef, useEffect, useCallback } from 'react';
import type { FileAnnotation } from '../types/fileAnnotations';

interface FileAnnotationCardProps {
  annotation: FileAnnotation;
  onEdit: (id: string, content: string) => void;
  onRemove: (id: string) => void;
  onSend: (id: string) => void;
  isSent: boolean;
}

const TYPE_META = {
  insert:  { label: 'Insert',  color: 'var(--color-completed)' },
  delete:  { label: 'Delete',  color: 'var(--color-error)' },
  replace: { label: 'Replace', color: 'var(--color-primary)' },
  comment: { label: 'Comment', color: '#d97706' },
} as const;

export function FileAnnotationCard({ annotation, onEdit, onRemove, onSend, isSent: sent }: FileAnnotationCardProps) {
  const meta = TYPE_META[annotation.type];
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = useCallback(() => {
    setEditing(true);
    setEditText(annotation.content ?? annotation.selected_text);
  }, [annotation]);

  const saveEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed) onEdit(annotation.id, trimmed);
    else onRemove(annotation.id);
    setEditing(false);
  }, [editText, annotation.id, onEdit, onRemove]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        const el = editRef.current;
        if (el) { el.focus({ preventScroll: true }); el.selectionStart = el.selectionEnd = el.value.length; }
      });
    }
  }, [editing]);

  return (
    <div className={`fv-ann-card fv-ann-card--${annotation.type}${sent ? ' fv-ann-card--sent' : ''}`}>
      <span className="fv-ann-card__type" style={{ color: meta.color }}>{meta.label}</span>
      <span className="fv-ann-card__anchor">&ldquo;{annotation.selected_text.slice(0, 50)}&rdquo;</span>
      {annotation.content && !editing && (
        <span className="fv-ann-card__content" onDoubleClick={startEdit} title="Double-click to edit">
          {annotation.content}
        </span>
      )}
      {editing && (
        <textarea
          ref={editRef}
          className="fv-ann-card__textarea"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          }}
          onBlur={saveEdit}
          rows={3}
        />
      )}
      <div className="fv-ann-card__actions">
        <button
          className={`fv-ann-card__btn${sent ? ' fv-ann-card__btn--sent' : ''}`}
          onClick={() => onSend(annotation.id)}
          disabled={sent}
        >
          {sent ? '✓ Sent' : 'Send'}
        </button>
        <button className="fv-ann-card__btn" onClick={startEdit}>✎</button>
        <button className="fv-ann-card__btn fv-ann-card__btn--danger" onClick={() => onRemove(annotation.id)}>×</button>
      </div>
    </div>
  );
}
