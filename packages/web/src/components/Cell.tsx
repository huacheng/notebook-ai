import { memo } from 'react';
import type { Cell as CellData, PromptCell, ImageRef } from '@notebook-ai/shared';
import { CellOutput } from './CellOutput';
import { MarkdownBody } from './MarkdownBody';
import { useT } from '../i18n';
import { useCellLazyLoad, isCellStub, type CellStub } from '../hooks/useCellLazyLoad';
import { useStore } from '../store';

// ── Cell prompt images (renders image_refs from .images/ directory) ─────────

interface CellPromptImagesProps {
  imageRefs?: ImageRef[];
  sessionId: string | null;
}

const CellPromptImages = memo(function CellPromptImages({ imageRefs, sessionId }: CellPromptImagesProps) {
  if (!imageRefs || imageRefs.length === 0 || !sessionId) return null;

  return (
    <div className="cell-prompt-images">
      {imageRefs.map((ref, i) => (
        <img
          key={i}
          src={`/api/notebooks/${encodeURIComponent(sessionId)}/files/download?path=${encodeURIComponent(ref.path)}`}
          alt={`Prompt image ${i + 1}`}
          className="cell-prompt-image"
          loading="lazy"
        />
      ))}
    </div>
  );
});

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
  const sessionId = useStore((s) => s.sessionId);
  if (cell.type !== 'prompt') return null;

  // Lazy loading: detect if cell is a stub
  const isStub = isCellStub(cell);
  const { ref, isLoading } = useCellLazyLoad(cell.id, isStub);

  const execNum = cell.execution_count || index + 1;
  const hasResponse = !isStub && (cell.outputs.length > 0 || cell.status === 'running');
  const imageRefs = (cell as PromptCell).image_refs;

  return (
    <div
      ref={ref}
      className={`cell${pendingDelete ? ' cell--pending-delete' : ''}${isStub ? ' cell--stub' : ''}`}
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

      {/* ── Prompt images (from .images/ directory) ── */}
      {imageRefs && imageRefs.length > 0 && (
        <CellPromptImages imageRefs={imageRefs} sessionId={sessionId} />
      )}

      {/* ── Appended segments (frozen, greyed) ── */}
      {('segments' in cell) && (cell as PromptCell).segments && (cell as PromptCell).segments!.length > 0 && (
        <div className="cell-appended-segments">
          {(cell as PromptCell).segments!.map((seg, i) => (
            <div key={i} className="cell-segment-row">
              <span className="cell-segment-label">+</span>
              <MarkdownBody content={seg.text} className="cell-prompt-source cell-segment-frozen" />
            </div>
          ))}
        </div>
      )}

      {/* ── Stub loading indicator ── */}
      {isStub && (
        <div className="cell-stub-indicator">
          {isLoading ? (
            <span className="cell-stub-loading">Loading...</span>
          ) : (
            <span className="cell-stub-preview">
              {(cell as CellStub).output_count > 0 && `${(cell as CellStub).output_count} outputs`}
            </span>
          )}
        </div>
      )}

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
