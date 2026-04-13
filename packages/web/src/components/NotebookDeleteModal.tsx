/**
 * NotebookDeleteModal — Delete modal for notebooks with worktree branches.
 *
 * Provides two options:
 * 1. Save Deliverables & Delete — copy .deliverables/ to master, then delete
 * 2. Delete Only — delete without merging (branch work will be lost)
 */

import { useState, useRef, useEffect } from 'react';
import { useT } from '../i18n';
import { runDeleteFlow, type DeletePhase } from './deleteFlow';

export interface NotebookDeleteModalProps {
  name: string;
  branchName: string;
  /** When true, show reset semantics ("重置") instead of delete ("删除"). */
  isDefault?: boolean;
  onMergeDelete: () => Promise<void>;
  onDeleteOnly: () => Promise<void>;
  onCancel: () => void;
  onDone?: () => void;
}

export function NotebookDeleteModal({
  name,
  branchName,
  isDefault = false,
  onMergeDelete,
  onDeleteOnly,
  onCancel,
  onDone,
}: NotebookDeleteModalProps) {
  const t = useT();
  const [phase, setPhase] = useState<DeletePhase>('confirm');
  const [errorMsg, setErrorMsg] = useState('');
  const [selected, setSelected] = useState<'merge' | 'delete-only' | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const handleConfirm = () => {
    if (!selected) return;
    const action = selected === 'merge' ? onMergeDelete : onDeleteOnly;
    runDeleteFlow(action, {
      setPhase,
      setErrorMsg,
      onDone: () => setTimeout(() => onDoneRef.current?.(), 800),
    });
  };

  // Close on Escape
  useEffect(() => {
    if (phase !== 'confirm') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel, phase]);

  if (phase === 'deleting') {
    return (
      <div className="annotation-modal-overlay">
        <div className="annotation-modal nb-delete-modal">
          <div className="nb-delete-status">
            <div className="nb-delete-spinner" />
            <span>{t('delete.deleting')}</span>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="annotation-modal-overlay">
        <div className="annotation-modal nb-delete-modal">
          <div className="nb-delete-status nb-delete-success">
            <span style={{ fontSize: '24px' }}>&#10003;</span>
            <span>{t('delete.success')}</span>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="annotation-modal-overlay">
        <div className="annotation-modal nb-delete-modal">
          <div className="nb-delete-status nb-delete-error">
            {errorMsg}
          </div>
          <div className="annotation-modal-actions">
            <button className="annotation-modal-btn" onClick={onCancel}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="annotation-modal-overlay" onClick={onCancel}>
      <div className="annotation-modal nb-delete-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="annotation-modal-title">
          {isDefault ? `重置 "${name}"？` : t('delete.confirmTitle', name)}
        </h3>
        <p className="nb-delete-desc">
          This notebook has an associated branch: <code>{branchName}</code>
        </p>

        <div className="nb-delete-options">
          <div
            className={`nb-delete-option-card ${selected === 'merge' ? 'selected' : ''}`}
            onClick={() => setSelected('merge')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setSelected('merge')}
          >
            <div className="nb-delete-option-title">Save Deliverables & Delete</div>
            <div className="nb-delete-option-desc">
              Copy <code>.deliverables/</code> to master, then delete the notebook and branch.
            </div>
          </div>

          <div
            className={`nb-delete-option-card danger ${selected === 'delete-only' ? 'selected' : ''}`}
            onClick={() => setSelected('delete-only')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setSelected('delete-only')}
          >
            <div className="nb-delete-option-title">Delete Only</div>
            <div className="nb-delete-option-desc">
              Delete without merging. Branch work will be lost.
            </div>
          </div>
        </div>

        <div className="annotation-modal-actions">
          <button className="annotation-modal-btn" onClick={onCancel}>
            {t('modal.cancel')}
          </button>
          <button
            className={`annotation-modal-btn annotation-modal-btn--danger ${!selected ? 'disabled' : ''}`}
            onClick={handleConfirm}
            disabled={!selected}
          >
            {t('modal.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
