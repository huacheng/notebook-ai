import { useRef, useEffect, useState, useCallback, type RefObject } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Cell } from './Cell';
import { SlideView } from './SlideView';
import { shouldShowScrollBtn } from '../utils/scrollToBottom';
import { InputBar } from './shared/InputBar';
import { PhaseProgressBar, ScorePanel } from './TimerStatusBar';

// ── Timer toggle button ─────────────────────────────────────────────────────

function TimerToggleButton() {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const sessionId = useStore((s) => s.sessionId);
  const timerMode = useStore((s) => s.timerMode);
  const wsStatus = useStore((s) => s.wsStatus);
  const connected = wsStatus === 'connected';

  const handleToggle = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
    if (timerMode) {
      ws.send(JSON.stringify({ type: 'timer_stop', session_id: sessionId }));
      useStore.setState({ timerMode: false, timerIterationCount: 0 });
    } else {
      ws.send(JSON.stringify({ type: 'timer_start', session_id: sessionId }));
      useStore.setState({ timerMode: true, timerIterationCount: 0 });
    }
  };

  return (
    <button
      className={`notebook-statusbar-btn notebook-statusbar-timer-btn${timerMode ? ' active' : ''}`}
      onClick={handleToggle}
      disabled={!connected}
      title={timerMode ? t('status.timerStopTitle') : t('status.timerStartTitle')}
    >
      {t('status.timer')}
    </button>
  );
}

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
  const clearSession = useStore((s) => s.clearSession);
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
  const inSlide = activeTab === 'slide';

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
            disabled={!connected || isRunning || inSlide}
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
          className="notebook-statusbar-btn notebook-statusbar-clear-btn"
          onClick={clearSession}
          disabled={!connected || isRestarting || editMode}
          title={t('status.clearTitle')}
        >
          {t('status.clear')}
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
        <TimerToggleButton />
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
          className={`notebook-statusbar-btn notebook-statusbar-slide-btn${inSlide ? ' active' : ''}`}
          onClick={() => setActiveTab(inSlide ? 'notebook' : 'slide')}
          disabled={editMode}
          title={inSlide ? t('status.slideBackTitle') : t('status.slideOpenTitle')}
        >
          {inSlide ? t('status.slideBack') : t('status.slideOpen')}
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

/**
 * Notebook input bar - uses the shared InputBar component.
 */
function NotebookInputBar() {
  const editMode = useStore((s) => s.editMode);
  return <InputBar editMode={editMode} />;
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
      bottomRef.current?.closest('.notebook-cells')
      ?? bottomRef.current?.closest('.notebook-split-pane')
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
  const sessionNotice = useStore((s) => s.sessionNotice);
  const clearSessionNotice = useStore((s) => s.clearSessionNotice);
  const cellsOffset = useStore((s) => s.cellsOffset);
  const loadingOlderCells = useStore((s) => s.loadingOlderCells);
  const taskStatus = useStore((s) => s.taskStatus);
  const timerMode = useStore((s) => s.timerMode);
  const timerIterationCount = useStore((s) => s.timerIterationCount);
  const timerPaused = useStore((s) => s.timerPaused);
  const autoStatus = useStore((s) => s.autoStatus);
  const [scoreExpanded, setScoreExpanded] = useState(false);
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
    const el = cellsContainerRef.current;
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
    const BATCH = 2; // D4: Load 2 cells at a time for smoother scroll experience
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
      {/* Task lifecycle status bar — always visible when .status.json exists */}
      {(taskStatus || autoStatus.phase) && (
        <div className="timer-status-container">
          <PhaseProgressBar
            phase={(taskStatus as any)?.step ?? autoStatus.phase}
            phaseProgress={autoStatus.phaseProgress}
          />
          {autoStatus.checkScore && (
            <ScorePanel
              checkScore={autoStatus.checkScore}
              expanded={scoreExpanded}
              onToggle={() => setScoreExpanded(!scoreExpanded)}
            />
          )}
          {timerMode && (
            <span
              className={`timer-beat-badge${timerPaused ? ' paused' : ''}`}
              title={timerPaused ? 'Timer paused (rate limit cooldown)' : 'Timer heartbeat active'}
            >
              {timerPaused ? 'paused' : `beat:${timerIterationCount}`}
            </span>
          )}
        </div>
      )}
      {sessionNotice && (
        <div className="session-notice">
          <span>{sessionNotice}</span>
          <button className="session-notice-close" onClick={clearSessionNotice}>✕</button>
        </div>
      )}
      <RestartOverlay />
      <EditSaveOverlay />

      {activeTab === 'notebook' && (
        <>
          <div className="notebook-cells" ref={cellsContainerRef}>
            {cellsOffset > 0 && (
              <div ref={sentinelRef} className="notebook-load-more-sentinel">
                {loadingOlderCells && <div className="nb-delete-spinner" style={{ width: 16, height: 16 }} />}
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

      {activeTab === 'slide' && <SlideView />}
    </div>
  );
}
