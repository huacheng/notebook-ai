import { useRef, useEffect, useState, useCallback, type RefObject } from 'react';
import { useStore } from '../store';
import { Cell } from './Cell';
import { SliceView } from './SliceView';
import { loadDraft, saveDraft, clearDraft } from '../utils/promptDraft';
import { shouldShowScrollBtn } from '../utils/scrollToBottom';

// ── Notebook status bar ─────────────────────────────────────────────────────

function NotebookStatusBar() {
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
            title="Edit mode — select cells to delete"
          >
            Edit
          </button>
        ) : (
          <button
            className="notebook-statusbar-btn notebook-statusbar-edit-btn active"
            onClick={handleEditDone}
            disabled={editSavePhase === 'saving'}
            title={pendingDeletes.size > 0 ? `Done — delete ${pendingDeletes.size} cell(s)` : 'Done — exit edit mode'}
          >
            Done{pendingDeletes.size > 0 ? ` (${pendingDeletes.size})` : ''}
          </button>
        )}
        <button
          className="notebook-statusbar-btn notebook-statusbar-restart-btn"
          onClick={restartSession}
          disabled={!connected || isRestarting || editMode}
          title={isRestarting ? 'Restarting session…' : 'Restart agent session'}
        >
          {isRestarting ? '...' : 'Restart'}
        </button>
        <button
          className="notebook-statusbar-btn notebook-statusbar-rerun-btn"
          onClick={() => setShowRerunModal(true)}
          disabled={!connected || isRunning || isRestarting || editMode}
          title="Rerun all cells from scratch (clean context)"
        >
          Rerun
        </button>
        {isRunning && (
          <button
            className="notebook-statusbar-btn notebook-statusbar-esc-btn"
            onClick={interruptCell}
            title="Interrupt running cell (Esc)"
          >
            Esc
          </button>
        )}
        <button
          className="notebook-statusbar-btn"
          onClick={() => saveNotebook()}
          disabled={!connected || editMode}
          title={connected ? 'Save notebook' : 'Not connected'}
        >
          Save
        </button>
        <button
          className="notebook-statusbar-btn"
          onClick={handleExport}
          disabled={!sessionId || editMode}
          title={sessionId ? 'Export notebook as bundle' : 'No active session'}
        >
          Export
        </button>
        <button
          className={`notebook-statusbar-btn notebook-statusbar-slice-btn${inSlice ? ' active' : ''}`}
          onClick={() => setActiveTab(inSlice ? 'notebook' : 'slice')}
          disabled={editMode}
          title={inSlice ? 'Back to Notebook' : 'Open Slice view'}
        >
          {inSlice ? '◂ Notebook' : 'Slice ▸'}
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
  return (
    <div className="annotation-modal-overlay" onClick={onCancel}>
      <div className="annotation-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-lg)' }}>
          Delete {count} cell{count > 1 ? 's' : ''}?
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-xl) 0' }}>
          This will permanently remove the selected cell{count > 1 ? 's' : ''} and {count > 1 ? 'their' : 'its'} responses.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
          <button className="annotation-modal-btn" onClick={onCancel}>Cancel</button>
          <button className="annotation-modal-btn annotation-modal-btn--danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── Rerun confirm modal ─────────────────────────────────────────────────────

function RerunConfirmModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="annotation-modal-overlay" onClick={onCancel}>
      <div className="annotation-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-lg)' }}>
          Rerun all cells?
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-xl) 0' }}>
          This will clear all cell outputs, reset the agent session (clean context), and re-execute every cell from scratch.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
          <button className="annotation-modal-btn" onClick={onCancel}>Cancel</button>
          <button className="annotation-modal-btn annotation-modal-btn--danger" onClick={onConfirm}>Rerun</button>
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
  const submitPrompt = useStore((s) => s.submitPrompt);
  const sessionId = useStore((s) => s.sessionId);
  const notebook = useStore((s) => s.notebook);
  const isRunning = notebook?.cells.some((c) => c.status === 'running') ?? false;
  const editMode = useStore((s) => s.editMode);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);

  // Draft key: per-notebook (falls back to sessionId for compat)
  const draftKey = activeNotebookTabId || sessionId || '';

  const [text, setText] = useState(() => loadDraft(draftKey));
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function handleRun() {
    const source = text.trim();
    if (!source || isRunning) return;
    submitPrompt(source);
    setText('');
    clearDraft(draftKey);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleRun();
    }
  }

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!sessionId) {
      setUploadStatus({ phase: 'error', message: 'No active session — open a notebook first.' });
      return;
    }

    const fileCount = files.length;
    setUploadStatus({ phase: 'uploading', count: fileCount });
    setUploading(true);

    try {
      const formData = new FormData();
      for (const file of Array.from(files)) formData.append('files', file);
      const res = await fetch(`/api/notebooks/${sessionId}/files`, { method: 'POST', body: formData });

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
            <><span className="spinner" aria-hidden="true" /> Uploading {uploadStatus.count} file{uploadStatus.count > 1 ? 's' : ''}…</>
          )}
          {uploadStatus.phase === 'success' && <>✓ Attached: {uploadStatus.names.join(', ')}</>}
          {uploadStatus.phase === 'error' && <>✗ {uploadStatus.message}</>}
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
          onChange={(e) => { setText(e.target.value); resize(); }}
          onKeyDown={handleKeyDown}
          onDrop={(e) => {
            e.preventDefault();
            const dropped = e.dataTransfer.getData('text/plain');
            if (dropped) setText((prev) => prev ? `${prev}\n${dropped}` : dropped);
          }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          disabled={disabled}
          placeholder={editMode ? 'Exit edit mode to send prompts' : 'Enter a prompt… (Ctrl+Enter to run)'}
          rows={3}
          spellCheck={false}
        />
        <div className="notebook-input-actions">
          <button
            className="nb-attach-btn"
            title="Attach file to prompt"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? '…' : '+'}
          </button>
          <button
            className="nb-run-btn"
            onClick={handleRun}
            disabled={disabled || !text.trim()}
            title="Run (Ctrl+Enter)"
          >
            {isRunning ? '■' : '▶'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Restart overlay ──────────────────────────────────────────────────────────

function RestartOverlay() {
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
              Restarting session...
            </p>
          </div>
        )}
        {restartPhase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)', color: 'var(--color-completed)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              Session restarted
            </p>
          </div>
        )}
        {restartPhase === 'error' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)', color: 'var(--color-error)' }}>&#10007;</div>
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-md)' }}>
              Restart failed: {restartError}
            </p>
            <button
              className="notebook-statusbar-btn"
              onClick={() => useStore.getState().restartSession()}
              style={{ marginRight: 'var(--space-sm)' }}
            >
              Retry
            </button>
            <button
              className="notebook-statusbar-btn"
              onClick={() => useStore.setState({ restartPhase: 'idle', restartError: '' })}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit save overlay ────────────────────────────────────────────────────────

function EditSaveOverlay() {
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
              Saving changes...
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
              Retry
            </button>
            <button
              className="notebook-statusbar-btn"
              onClick={() => useStore.setState({ editSavePhase: 'idle', editSaveError: '' })}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Scroll-to-bottom floating button ─────────────────────────────────────────

function ScrollToBottomButton({ bottomRef }: { bottomRef: RefObject<HTMLDivElement | null> }) {
  const [visible, setVisible] = useState(false);
  const [rightPx, setRightPx] = useState(0);

  useEffect(() => {
    const scroller = bottomRef.current?.closest('.app-content') as HTMLElement | null;
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
      aria-label="Scroll to bottom"
    >
      ↓
    </button>
  );
}

// ── Main Notebook component ─────────────────────────────────────────────────

export function Notebook() {
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
    const { ws, sessionId } = useStore.getState();
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
    const BATCH = 10;
    const newOffset = Math.max(0, cellsOffset - BATCH);
    const limit = cellsOffset - newOffset;
    if (limit <= 0) return;
    ws.send(JSON.stringify({ type: 'load_cells', session_id: sessionId, offset: newOffset, limit }));
    useStore.setState({ loadingOlderCells: true });
  }, [cellsOffset]);

  return (
    <div className="notebook-container">
      <NotebookStatusBar />
      <RestartOverlay />
      <EditSaveOverlay />

      {activeTab === 'notebook' && (
        <>
          <div className="notebook-cells" ref={cellsContainerRef}>
            {cellsOffset > 0 && (
              <button
                className="notebook-load-more"
                onClick={handleLoadMore}
                disabled={loadingOlderCells}
              >
                {loadingOlderCells ? '加载中…' : `↑ ${cellsOffset} 条更早的对话`}
              </button>
            )}
            {cells.length === 0 && cellsOffset === 0 && (
              <div className="notebook-empty">
                <p>Send a prompt below to get started.</p>
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
