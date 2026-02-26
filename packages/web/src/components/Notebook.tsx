import { useRef, useEffect, useState, useCallback } from 'react';
import { useStore } from '../store';
import { Cell } from './Cell';
import { SliceView } from './SliceView';

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
  const sessionRestarting = useStore((s) => s.sessionRestarting);
  const wsStatus = useStore((s) => s.wsStatus);
  const connected = wsStatus === 'connected';

  const listTitle = notebookList.find((n) => n.id === activeNotebookId)?.title;
  const title = listTitle ?? notebook?.metadata.title ?? 'Untitled Notebook';
  const inSlice = activeTab === 'slice';

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

  return (
    <div className="notebook-statusbar">
      <span className="notebook-statusbar-title" title={title}>{title}</span>
      <div className="notebook-statusbar-actions">
        <button
          className="notebook-statusbar-btn notebook-statusbar-restart-btn"
          onClick={restartSession}
          disabled={!connected || sessionRestarting}
          title={sessionRestarting ? 'Restarting session…' : 'Restart agent session'}
        >
          {sessionRestarting ? '...' : 'Restart'}
        </button>
        <button
          className="notebook-statusbar-btn"
          onClick={() => saveNotebook()}
          disabled={!connected}
          title={connected ? 'Save notebook' : 'Not connected'}
        >
          Save
        </button>
        <button
          className="notebook-statusbar-btn"
          onClick={handleExport}
          disabled={!sessionId}
          title={sessionId ? 'Export notebook as bundle' : 'No active session'}
        >
          Export
        </button>
        <button
          className={`notebook-statusbar-btn notebook-statusbar-slice-btn${inSlice ? ' active' : ''}`}
          onClick={() => setActiveTab(inSlice ? 'notebook' : 'slice')}
          title={inSlice ? 'Back to Notebook' : 'Open Slice view'}
        >
          {inSlice ? '◂ Notebook' : 'Slice ▸'}
        </button>
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

  const [text, setText] = useState('');
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

  const disabled = isRunning || uploading;

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
          placeholder="Enter a prompt… (Ctrl+Enter to run)"
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

// ── Main Notebook component ─────────────────────────────────────────────────

export function Notebook() {
  const notebook = useStore((s) => s.notebook);
  const activeTab = useStore((s) => s.activeTab);
  const cells = notebook?.cells ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever a new cell is added
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [cells.length]);

  return (
    <div className="notebook-container">
      <NotebookStatusBar />

      {activeTab === 'notebook' && (
        <>
          <div className="notebook-cells">
            {cells.length === 0 && (
              <div className="notebook-empty">
                <p>Send a prompt below to get started.</p>
              </div>
            )}
            {cells.map((cell, index) => (
              <Cell key={cell.id} cell={cell} index={index} />
            ))}
            <div ref={bottomRef} />
          </div>

          <NotebookInputBar />
        </>
      )}

      {activeTab === 'slice' && <SliceView />}
    </div>
  );
}
