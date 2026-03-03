import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { loadDraft, saveDraft, clearDraft } from '../../utils/promptDraft';
import { extractImagesFromClipboard, MAX_IMAGES, type PastedImage } from '../../utils/pasteImages';
import { getCaretCoordinates } from '../../utils/getCaretCoordinates';
import { useMention } from '../../hooks/useMention';
import { MentionPopup } from '../MentionPopup';
import { SlashCommandPlugin } from '../../mention/SlashCommandPlugin';
import { FileTreePlugin } from '../../mention/FileTreePlugin';
import { CellRefPlugin } from '../../mention/CellRefPlugin';
import { createHistoryPlugin, saveToHistory } from '../../mention/HistoryPlugin';
import type { MentionPlugin } from '../../mention/types';

interface UploadStatus {
  phase: 'uploading' | 'success' | 'error';
  count?: number;
  names?: string[];
  message?: string;
}

interface InputBarProps {
  /** Whether this is mobile layout (fixed bottom, horizontal scroll toolbar) */
  mobile?: boolean;
  /** Whether the input is in edit mode */
  editMode?: boolean;
}

/**
 * Shared InputBar component for both desktop and mobile.
 * Contains textarea, mention system (/ @ #), command toolbar, and file upload.
 */
export function InputBar({ mobile = false, editMode = false }: InputBarProps) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submitPrompt = useStore((s) => s.submitPrompt);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  const sessionId = useStore((s) => s.sessionId);
  const notebook = useStore((s) => s.notebook);
  const authToken = useStore((s) => s.authToken);
  const pendingSuggestions = useStore((s) => s.pendingSuggestions);
  const clearPendingSuggestions = useStore((s) => s.clearPendingSuggestions);

  // Draft key: per-notebook
  const draftKey = activeNotebookTabId || sessionId || '';
  const [text, setText] = useState(() => loadDraft(draftKey));
  const [images, setImages] = useState<PastedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);

  // Mention system with all triggers: / @ #
  // SlashCommandPlugin handles /history with navigation to history list
  const historyPlugin = useMemo(() => createHistoryPlugin(), []);
  const plugins = useMemo(() => [SlashCommandPlugin, FileTreePlugin, CellRefPlugin, historyPlugin] as MentionPlugin<unknown>[], [historyPlugin]);
  const mention = useMention(plugins);
  const [caretPos, setCaretPos] = useState({ x: 0, y: 0 });

  // Check if any cell is running
  const isRunning = notebook?.cells.some(
    (c) => c.status === 'running' || c.status === 'pending'
  );

  const disabled = isRunning || uploading || editMode;

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = mobile ? 120 : 200;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [mobile]);

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
    // Save to prompt history before submitting
    if (source) saveToHistory(source);
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
    // Mobile: Enter submits, Desktop: Ctrl/Cmd+Enter submits
    if (mobile) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleRun();
      }
    } else {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleRun();
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    resize();
    const pos = e.target.selectionStart ?? 0;
    mention.handleChange(e.target.value, pos);
    // Update caret position for popup (follow cursor)
    const coords = getCaretCoordinates(e.target, pos);
    setCaretPos({ x: coords.left, y: coords.top });
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

  const insertCommand = (cmd: string) => {
    setText((prev) => prev ? `${prev}\n/${cmd} ` : `/${cmd} `);
    textareaRef.current?.focus();
  };

  // Command shortcuts
  const commands = [
    { cmd: 'task-ai:target', icon: '🎯' },
    { cmd: 'task-ai:research', icon: '🔍' },
    { cmd: 'task-ai:read', icon: '📖' },
    { cmd: 'task-ai:library search', icon: '📚' },
    { cmd: 'task-ai:auto', icon: '🤖' },
  ];

  const containerClass = mobile
    ? 'notebook-input-bar notebook-input-bar--mobile'
    : 'notebook-input-bar';

  return (
    <div className={containerClass}>
      {uploadStatus && (
        <div className={`upload-status upload-status-${uploadStatus.phase}`}>
          {uploadStatus.phase === 'uploading' && (
            <><span className="spinner" aria-hidden="true" /> {t('input.uploading', String(uploadStatus.count))}</>
          )}
          {uploadStatus.phase === 'success' && <>{t('input.attached', uploadStatus.names?.join(', ') ?? '')}</>}
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
          onChange={handleChange}
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
          rows={mobile ? 1 : 3}
          spellCheck={false}
        />
      </div>
      <div className="nb-cmd-toolbar">
        <div className="nb-cmd-btns">
          {commands.map(({ cmd, icon }) => (
            <button
              key={cmd}
              className="nb-cmd-btn"
              title={t(`cmd.${cmd}`)}
              disabled={disabled}
              onClick={() => insertCommand(cmd)}
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
