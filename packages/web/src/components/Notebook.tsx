import { useRef, useEffect, useState, useCallback, useMemo, type RefObject } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Cell } from './Cell';
import { SliceView } from './SliceView';
import { loadDraft, saveDraft, clearDraft } from '../utils/promptDraft';
import { shouldShowScrollBtn } from '../utils/scrollToBottom';
import { extractImagesFromClipboard, MAX_IMAGES, type PastedImage } from '../utils/pasteImages';
import { getCaretCoordinates } from '../utils/getCaretCoordinates';
import { useMention } from '../hooks/useMention';
import { MentionPopup } from './MentionPopup';
import { SlashCommandPlugin } from '../mention/SlashCommandPlugin';
import { FileTreePlugin } from '../mention/FileTreePlugin';
import { CellRefPlugin } from '../mention/CellRefPlugin';
import type { MentionPlugin } from '../mention/types';

// ── Notebook status bar ─────────────────────────────────────────────────────

function NotebookStatusBar() {
  const t = useT();
  const notebook = useStore((s) => s.notebook);
  const activeNotebookId = useStore((s) => s.activeNotebookId);
  const notebookList = useStore((s) => s.notebookList);
  const sessionId = useStore((s) => s.sessionId);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const saveNotebook = useStore((s) => s.saveNotebook);
  const restartSession = useStore((s) => s.restartSession);
  const rerunNotebook = useStore((s) => s.rerunNotebook);
  const interruptCell = useStore((s) => s.interruptCell);
  const restartPhase = useStore((s) => s.restartPhase);
  const wsStatus = useStore((s) => s.wsStatus);
  const connected = wsStatus === 'connected';
  const isRestarting = restartPhase === 'restarting' || restartPhase === 'done';

  const editMode = useStore((s) => s.editMode);
  const pendingDeletes = useStore((s) => s.pendingDeletes);
  const editSavePhase = useStore((s) => s.editSavePhase);
  const setEditMode = useStore((s) => s.setEditMode);

  const isRunning = notebook?.cells.some((c) => c.status === 'running') ?? false;

  const listTitle = notebookList.find((n) => n.id === activeNotebookId)?.title;
  const title = listTitle ?? notebook?.metadata.title ?? 'Untitled Notebook';
  const inSlice = activeTab === 'slice';

  const [showCommitModal, setShowCommitModal] = useState(false);
  const [showRerunModal, setShowRerunModal] = useState(false);

  function handleExport() {
    if (!sessionId) return;
    const url = `/api/notebooks/${encodeURIComponent(sessionId)}/export-zip`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleEditDone() {
    if (pendingDeletes.size === 0) {
      setEditMode(false);
      return;
    }
    setShowCommitModal(true);
  }

  return (
    <div className="notebook-statusbar">
      <span className="notebook-statusbar-title" title={title}>{title}</span>
      <div className="notebook-statusbar-actions">
        {!editMode ? (
          <button
            className="notebook-statusbar-btn notebook-statusbar-edit-btn"
            onClick={() => setEditMode(true)}
            disabled={!connected || isRunning || inSlice}
            title={t('status.editTitle')}
          >
            {t('status.edit')}
          </button>
        ) : (
          <button
            className="notebook-statusbar-btn notebook-statusbar-edit-btn active"
            onClick={handleEditDone}
            disabled={editSavePhase === 'saving'}
            title={pendingDeletes.size > 0 ? t('status.doneDeleteTitle', String(pendingDeletes.size)) : t('status.doneExitTitle')}
          >
            {t('status.done')}{pendingDeletes.size > 0 ? ` (${pendingDeletes.size})` : ''}
          </button>
        )}
        <button
          className="notebook-statusbar-btn notebook-statusbar-restart-btn"
          onClick={restartSession}
          disabled={!connected || isRestarting || editMode}
          title={isRestarting ? t('status.restarting') : t('status.restartTitle')}
        >
          {isRestarting ? '...' : t('status.restart')}
        </button>
        <button
          className="notebook-statusbar-btn notebook-statusbar-rerun-btn"
          onClick={() => setShowRerunModal(true)}
          disabled={!connected || isRunning || isRestarting || editMode}
          title={t('status.rerunTitle')}
        >
          {t('status.rerun')}
        </button>
        {isRunning && (
          <button
            className="notebook-statusbar-btn notebook-statusbar-esc-btn"
            onClick={interruptCell}
            title={t('status.escTitle')}
          >
            {t('status.esc')}
          </button>
        )}
        <button
          className="notebook-statusbar-btn"
          onClick={() => saveNotebook()}
          disabled={!connected || editMode}
          title={connected ? t('status.saveTitle') : t('status.notConnected')}
        >
          {t('status.save')}
        </button>
        <button
          className="notebook-statusbar-btn"
          onClick={handleExport}
          disabled={!sessionId || editMode}
          title={sessionId ? t('status.exportTitle') : t('status.noActiveSession')}
        >
          {t('status.export')}
        </button>
        <button
          className={`notebook-statusbar-btn notebook-statusbar-slice-btn${inSlice ? ' active' : ''}`}
          onClick={() => setActiveTab(inSlice ? 'notebook' : 'slice')}
          disabled={editMode}
          title={inSlice ? t('status.sliceBackTitle') : t('status.sliceOpenTitle')}
        >
          {inSlice ? t('status.sliceBack') : t('status.sliceOpen')}
        </button>
      </div>

      {showCommitModal && (
        <EditCommitModal
          count={pendingDeletes.size}
          onCancel={() => setShowCommitModal(false)}
          onConfirm={() => {
            setShowCommitModal(false);
            useStore.getState().commitEdits();
          }}
        />
      )}

      {showRerunModal && (
        <RerunConfirmModal
          onCancel={() => setShowRerunModal(false)}
          onConfirm={() => {
            setShowRerunModal(false);
            rerunNotebook();
          }}
        />
      )}
    </div>
  );
}

// ── Edit commit modal ───────────────────────────────────────────────────────

function EditCommitModal({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  return (
    <div className="annotation-modal-overlay" onClick={onCancel}>
      <div className="annotation-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-lg)' }}>
          {t('modal.deleteCells', String(count))}
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-xl) 0' }}>
          {t('modal.deleteCellsDesc')}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
          <button className="annotation-modal-btn" onClick={onCancel}>{t('modal.cancel')}</button>
          <button className="annotation-modal-btn annotation-modal-btn--danger" onClick={onConfirm}>{t('modal.delete')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Rerun confirm modal ─────────────────────────────────────────────────────

function RerunConfirmModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  return (
    <div className="annotation-modal-overlay" onClick={onCancel}>
      <div className="annotation-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-lg)' }}>
          {t('modal.rerunAll')}
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-xl) 0' }}>
          {t('modal.rerunAllDesc')}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
          <button className="annotation-modal-btn" onClick={onCancel}>{t('modal.cancel')}</button>
          <button className="annotation-modal-btn annotation-modal-btn--danger" onClick={onConfirm}>{t('modal.rerun')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Bottom input bar ────────────────────────────────────────────────────────

type UploadStatus =
  | { phase: 'uploading'; count: number }
  | { phase: 'success'; names: string[] }
  | { phase: 'error'; message: string };

function NotebookInputBar() {
  const t = useT();
  const submitPrompt = useStore((s) => s.submitPrompt);
  const sessionId = useStore((s) => s.sessionId);
  const authToken = useStore((s) => s.authToken);
  const notebook = useStore((s) => s.notebook);
  const isRunning = notebook?.cells.some((c) => c.status === 'running') ?? false;
  const editMode = useStore((s) => s.editMode);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  const pendingSuggestions = useStore((s) => s.pendingSuggestions);
  const clearPendingSuggestions = useStore((s) => s.clearPendingSuggestions);

  // Draft key: per-notebook (falls back to sessionId for compat)
  const draftKey = activeNotebookTabId || sessionId || '';

  const [text, setText] = useState(() => loadDraft(draftKey));
  const [images, setImages] = useState<PastedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mention system
  const plugins = useMemo(() => [SlashCommandPlugin, FileTreePlugin, CellRefPlugin] as MentionPlugin<unknown>[], []);
  const mention = useMention(plugins);
  const [caretPos, setCaretPos] = useState({ x: 0, y: 0 });

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => { resize(); }, [text, resize]);

  // Persist draft to localStorage (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDraft(draftKey, text), 50);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [text, draftKey]);

  // Restore draft when switching notebooks
  const prevDraftKey = useRef(draftKey);
  useEffect(() => {
    if (prevDraftKey.current !== draftKey) {
      prevDraftKey.current = draftKey;
      setText(loadDraft(draftKey));
    }
  }, [draftKey]);

  // Listen for annotation-forwarded prompt text
  useEffect(() => {
    function onAppend(e: Event) {
      const { text: appended } = (e as CustomEvent<{ text: string }>).detail;
      setText((prev) => prev ? `${prev}\n\n${appended}` : appended);
      textareaRef.current?.focus();
    }
    window.addEventListener('nb:appendPrompt', onAppend);
    return () => window.removeEventListener('nb:appendPrompt', onAppend);
  }, []);

  // Auto-dismiss upload status banners
  useEffect(() => {
    if (!uploadStatus || uploadStatus.phase === 'uploading') return;
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setUploadStatus(null), 4000);
    return () => { if (dismissTimer.current) clearTimeout(dismissTimer.current); };
  }, [uploadStatus]);

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = await extractImagesFromClipboard(e);
    if (pasted.length > 0) {
      e.preventDefault();
      setImages((prev) => [...prev, ...pasted].slice(0, MAX_IMAGES));
    }
  }

  function handleRun() {
    const source = text.trim();
    if ((!source && images.length === 0) || isRunning) return;
    const imgs = images.length > 0
      ? images.map(({ media_type, data }) => ({ media_type, data }))
      : undefined;
    submitPrompt(source || '(image)', imgs);
    setText('');
    setImages([]);
    clearDraft(draftKey);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Let mention system handle keys first (arrow up/down, enter, escape)
    if (mention.handleKeyDown(e, () => text, setText)) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleRun();
    }
  }

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!sessionId) {
      setUploadStatus({ phase: 'error', message: t('input.noSession') });
      return;
    }

    const fileCount = files.length;
    setUploadStatus({ phase: 'uploading', count: fileCount });
    setUploading(true);

    try {
      const formData = new FormData();
      for (const file of Array.from(files)) formData.append('files', file);
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`/api/notebooks/${sessionId}/files`, { method: 'POST', body: formData, headers });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Upload failed (${res.status})`);
      }

      const data = (await res.json()) as { uploaded: string[] };
      const names = data.uploaded;
      if (names.length > 0) {
        const refs = names.map((name) => `[file: ${name}]`).join('\n');
        setText((prev) => (prev ? `${prev}\n${refs}` : refs));
      }
      setUploadStatus({ phase: 'success', names });
    } catch (err) {
      setUploadStatus({ phase: 'error', message: String(err instanceof Error ? err.message : err) });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const disabled = isRunning || uploading || editMode;

  return (
    <div className="notebook-input-bar">
      {uploadStatus && (
        <div className={`upload-status upload-status-${uploadStatus.phase}`}>
          {uploadStatus.phase === 'uploading' && (
            <><span className="spinner" aria-hidden="true" /> {t('input.uploading', String(uploadStatus.count))}</>
          )}
          {uploadStatus.phase === 'success' && <>{t('input.attached', uploadStatus.names.join(', '))}</>}
          {uploadStatus.phase === 'error' && <>✗ {uploadStatus.message}</>}
        </div>
      )}
      {images.length > 0 && (
        <div className="nb-image-preview-strip">
          {images.map((img, i) => (
            <div key={i} className="nb-image-thumb">
              <img src={img.preview} alt={t('input.pasted', String(i + 1))} />
              <button className="nb-image-remove" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}
      {pendingSuggestions && !isRunning && (
        <div className="nb-suggestions">
          <span className="nb-suggestions-label">{t('input.suggestions')}</span>
          {pendingSuggestions.suggestions.map((s, i) => (
            <button key={i} className="nb-suggestion-btn" onClick={() => {
              submitPrompt(s);
              clearPendingSuggestions();
            }}>
              {s}
            </button>
          ))}
          <button className="nb-suggestion-dismiss" onClick={() => clearPendingSuggestions()}>×</button>
        </div>
      )}
      <div className="notebook-input-row">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFilesChange}
          tabIndex={-1}
        />
        <textarea
          ref={textareaRef}
          className="nb-input-textarea"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            resize();
            const pos = e.target.selectionStart ?? 0;
            mention.handleChange(e.target.value, pos);
            // Update caret position for popup (follow cursor)
            const coords = getCaretCoordinates(e.target, pos);
            setCaretPos({ x: coords.left, y: coords.top });
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={(e) => {
            e.preventDefault();
            const MAX_DROP = 10000;
            const dropped = e.dataTransfer.getData('text/plain').slice(0, MAX_DROP);
            if (dropped) setText((prev) => prev ? `${prev}\n${dropped}` : dropped);
          }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          disabled={disabled}
          placeholder={editMode ? t('input.editModePlaceholder') : t('input.placeholderWithHints')}
          rows={3}
          spellCheck={false}
        />
      </div>
      <div className="nb-cmd-toolbar">
        <div className="nb-cmd-btns">
          {[
            { cmd: 'task-ai:target', icon: '🎯' },
            { cmd: 'task-ai:research', icon: '🔍' },
            { cmd: 'task-ai:read', icon: '📖' },
            { cmd: 'task-ai:library search', icon: '📚' },
            { cmd: 'task-ai:auto', icon: '🤖' },
          ].map(({ cmd, icon }) => (
            <button
              key={cmd}
              className="nb-cmd-btn"
              title={t(`cmd.${cmd}`)}
              disabled={disabled}
              onClick={() => {
                setText((prev) => prev ? `${prev}\n/${cmd} ` : `/${cmd} `);
                textareaRef.current?.focus();
              }}
            >
              {icon} <span className="nb-cmd-name">/{cmd.split(':')[1]}</span>
            </button>
          ))}
        </div>
        <div className="nb-input-actions">
          <button
            className="nb-attach-btn"
            title={t('input.attachFile')}
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? '…' : '+'}
          </button>
          <button
            className="nb-run-btn"
            onClick={handleRun}
            disabled={disabled || (!text.trim() && images.length === 0)}
            title={t('input.run')}
          >
            {isRunning ? '■' : '▶'}
          </button>
        </div>
      </div>
      <MentionPopup
        state={mention.state}
        position={caretPos}
        onSelect={(i) => mention.selectItem(i, () => text, setText)}
      />
    </div>
  );
}

// ── Restart overlay ──────────────────────────────────────────────────────────

function RestartOverlay() {
  const t = useT();
  const restartPhase = useStore((s) => s.restartPhase);
  const restartError = useStore((s) => s.restartError);

  if (restartPhase === 'idle') return null;

  return (
    <div className="annotation-modal-overlay">
      <div className="annotation-modal" onClick={(e) => e.stopPropagation()}>
        {restartPhase === 'restarting' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div className="nb-delete-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
              {t('overlay.restarting')}
            </p>
          </div>
        )}
        {restartPhase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)', color: 'var(--color-completed)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {t('overlay.restarted')}
            </p>
          </div>
        )}
        {restartPhase === 'error' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)', color: 'var(--color-error)' }}>&#10007;</div>
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-md)' }}>
              {t('overlay.restartFailed', restartError)}
            </p>
            <button
              className="notebook-statusbar-btn"
              onClick={() => useStore.getState().restartSession()}
              style={{ marginRight: 'var(--space-sm)' }}
            >
              {t('overlay.retry')}
            </button>
            <button
              className="notebook-statusbar-btn"
              onClick={() => useStore.setState({ restartPhase: 'idle', restartError: '' })}
            >
              {t('overlay.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit save overlay ────────────────────────────────────────────────────────

function EditSaveOverlay() {
  const t = useT();
  const editSavePhase = useStore((s) => s.editSavePhase);
  const editSaveError = useStore((s) => s.editSaveError);

  if (editSavePhase === 'idle') return null;

  return (
    <div className="annotation-modal-overlay">
      <div className="annotation-modal" onClick={(e) => e.stopPropagation()}>
        {editSavePhase === 'saving' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div className="nb-delete-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
              {t('overlay.saving')}
            </p>
          </div>
        )}
        {editSavePhase === 'error' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)', color: 'var(--color-error)' }}>&#10007;</div>
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-md)' }}>
              {editSaveError}
            </p>
            <button
              className="notebook-statusbar-btn"
              onClick={() => useStore.getState().commitEdits()}
              style={{ marginRight: 'var(--space-sm)' }}
            >
              {t('overlay.retry')}
            </button>
            <button
              className="notebook-statusbar-btn"
              onClick={() => useStore.setState({ editSavePhase: 'idle', editSaveError: '' })}
            >
              {t('modal.cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Scroll-to-bottom floating button ─────────────────────────────────────────

function ScrollToBottomButton({ bottomRef }: { bottomRef: RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [rightPx, setRightPx] = useState(0);

  useEffect(() => {
    const scroller = (
      bottomRef.current?.closest('.notebook-split-pane')
      ?? bottomRef.current?.closest('.app-content')
    ) as HTMLElement | null;
    if (!scroller) return;

    const updateVisibility = () => {
      setVisible(shouldShowScrollBtn(
        scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight,
      ));
    };

    const updatePosition = () => {
      const rect = scroller.getBoundingClientRect();
      // 12px inset from right edge of .app-content (scrollbar is 5px, leaves 7px gap)
      setRightPx(window.innerWidth - rect.right + 12);
    };

    scroller.addEventListener('scroll', updateVisibility, { passive: true });
    const ro = new ResizeObserver(updatePosition);
    ro.observe(scroller);

    updateVisibility();
    updatePosition();

    return () => {
      scroller.removeEventListener('scroll', updateVisibility);
      ro.disconnect();
    };
  }, [bottomRef]);

  if (!visible) return null;

  return (
    <button
      className="scroll-to-bottom"
      style={{ right: rightPx }}
      onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
      aria-label={t('notebook.scrollToBottom')}
    >
      ↓
    </button>
  );
}

// ── Main Notebook component ─────────────────────────────────────────────────

export function Notebook() {
  const t = useT();
  const notebook = useStore((s) => s.notebook);
  const activeTab = useStore((s) => s.activeTab);
  const editMode = useStore((s) => s.editMode);
  const pendingDeletes = useStore((s) => s.pendingDeletes);
  const togglePendingDelete = useStore((s) => s.togglePendingDelete);
  const cellsOffset = useStore((s) => s.cellsOffset);
  const loadingOlderCells = useStore((s) => s.loadingOlderCells);
  const cells = notebook?.cells ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);
  const cellsContainerRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef(0);

  // Scroll to bottom whenever a new cell is appended (not when loading older)
  const prevCellsLenRef = useRef(cells.length);
  useEffect(() => {
    // Only auto-scroll when cells grow at the tail (new prompt), not on prepend
    if (cells.length > prevCellsLenRef.current && cellsOffset === useStore.getState().cellsOffset) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevCellsLenRef.current = cells.length;
  }, [cells.length, cellsOffset]);

  // Scroll position preservation after prepending older cells
  useEffect(() => {
    const el = cellsContainerRef.current?.parentElement;
    if (!el) return;
    const prevHeight = prevHeightRef.current;
    if (prevHeight > 0 && el.scrollHeight > prevHeight) {
      el.scrollTop += el.scrollHeight - prevHeight;
    }
    prevHeightRef.current = el.scrollHeight;
  }, [cells.length, cellsOffset]);

  const handleLoadMore = useCallback(() => {
    const { ws, sessionId, loadingOlderCells: isLoading } = useStore.getState();
    if (isLoading || !ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
    const BATCH = 5;
    const newOffset = Math.max(0, cellsOffset - BATCH);
    const limit = cellsOffset - newOffset;
    if (limit <= 0) return;
    ws.send(JSON.stringify({ type: 'load_cells', session_id: sessionId, offset: newOffset, limit }));
    useStore.setState({ loadingOlderCells: true });
  }, [cellsOffset]);

  // IntersectionObserver: auto-load older cells when sentinel becomes visible
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || cellsOffset <= 0) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) handleLoadMore(); },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cellsOffset, handleLoadMore]);

  return (
    <div className="notebook-container">
      <NotebookStatusBar />
      <RestartOverlay />
      <EditSaveOverlay />

      {activeTab === 'notebook' && (
        <>
          <div className="notebook-cells" ref={cellsContainerRef}>
            {cellsOffset > 0 && (
              <div ref={sentinelRef} className="notebook-load-more">
                {loadingOlderCells ? t('notebook.loading') : t('notebook.olderCells', String(cellsOffset))}
              </div>
            )}
            {cells.length === 0 && cellsOffset === 0 && (
              <div className="notebook-empty">
                <p>{t('notebook.empty')}</p>
              </div>
            )}
            {cells.map((cell, i) => (
              <Cell
                key={cell.id}
                cell={cell}
                index={cellsOffset + i}
                editMode={editMode}
                pendingDelete={pendingDeletes.has(cell.id)}
                onToggleDelete={togglePendingDelete}
              />
            ))}
            <div ref={bottomRef} />
          </div>

          <NotebookInputBar />
          <ScrollToBottomButton bottomRef={bottomRef} />
        </>
      )}

      {activeTab === 'slice' && <SliceView />}
    </div>
  );
}
