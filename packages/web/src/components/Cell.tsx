import { memo } from 'react';
import type { Cell as CellData } from '@notebook-ai/shared';
import { CellOutput } from './CellOutput';
import { MarkdownBody } from './MarkdownBody';
import { useT } from '../i18n';

// ── Status indicator (non-running states only) ──────────────────────────────

const StatusIndicator = memo(function StatusIndicator({ status }: { status: CellData['status'] }) {
  const t = useT();
  if (status === 'idle' || status === 'completed' || status === 'running') return null;
  return (
    <span className={`cell-status cell-status-${status}`} aria-label={status}>
      {status === 'error' ? t('cell.error')
        : status === 'interrupted' ? t('cell.interrupted')
        : null}
    </span>
  );
});

// ── Main Cell component ─────────────────────────────────────────────────────

interface CellProps {
  cell: CellData;
  index: number;
  editMode?: boolean;
  pendingDelete?: boolean;
  onToggleDelete?: (cellId: string) => void;
}

export function Cell({ cell, index, editMode, pendingDelete, onToggleDelete }: CellProps) {
  const t = useT();
  if (cell.type !== 'prompt') return null;

  const execNum = cell.execution_count || index + 1;
  const hasResponse = cell.outputs.length > 0 || cell.status === 'running';

  return (
    <div
      className={`cell${pendingDelete ? ' cell--pending-delete' : ''}`}
      data-cell-id={cell.id}
    >
      {editMode && (
        <button
          className="cell-delete-btn"
          onClick={() => onToggleDelete?.(cell.id)}
          title={pendingDelete ? t('cell.undoDelete') : t('cell.markDelete')}
          aria-label={pendingDelete ? t('cell.undoDelete') : t('cell.markDelete')}
        >
          {pendingDelete ? '\u21A9' : '\u2715'}
        </button>
      )}

      {/* ── Section 1: User prompt — right aligned bubble ── */}
      <div className="cell-prompt-row">
        <span className="cell-index">[{execNum}]</span>
        <MarkdownBody content={cell.source} className="cell-prompt-source" />
      </div>

      {/* ── Divider ── */}
      {hasResponse && <div className="cell-response-divider" />}

      {/* ── Sections 2/3/4: AI response — left aligned ── */}
      {hasResponse && (
        <div className="cell-response-area">
          <StatusIndicator status={cell.status} />
          <CellOutput
            outputs={cell.outputs}
            isActiveCell={cell.status === 'running'}
            cellId={cell.id}
            cellStatus={cell.status}
            source={cell.source}
          />
        </div>
      )}

    </div>
  );
}
