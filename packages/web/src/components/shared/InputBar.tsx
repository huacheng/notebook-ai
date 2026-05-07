import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { loadDraft, saveDraft, clearDraft } from '../../utils/promptDraft';
import { extractImagesFromClipboard, uploadPromptImage, MAX_IMAGES, type ImageRef } from '../../utils/pasteImages';
import { getCaretCoordinates } from '../../utils/getCaretCoordinates';
import { useMention } from '../../hooks/useMention';
import { useVoiceInput } from '../../hooks/useVoiceInput';
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
  const lineNumRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cmdBtnsRef = useRef<HTMLDivElement>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropCaretRef = useRef<number | null>(null);

  const submitPrompt = useStore((s) => s.submitPrompt);
  const appendPrompt = useStore((s) => s.appendPrompt);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  const sessionId = useStore((s) => s.sessionId);
  const notebook = useStore((s) => s.notebook);
  const pendingSuggestions = useStore((s) => s.pendingSuggestions);
  const clearPendingSuggestions = useStore((s) => s.clearPendingSuggestions);

  // Draft key: per-notebook
  const draftKey = activeNotebookTabId || sessionId || '';
  const [text, setText] = useState(() => loadDraft(draftKey));
  const [images, setImages] = useState<ImageRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);

  // Mention system with all triggers: / @ #
  // SlashCommandPlugin handles /history with navigation to history list
  const historyPlugin = useMemo(() => createHistoryPlugin(), []);
  const plugins = useMemo(() => [SlashCommandPlugin, FileTreePlugin, CellRefPlugin, historyPlugin] as MentionPlugin<unknown>[], [historyPlugin]);
  const mention = useMention(plugins);
  const [caretPos, setCaretPos] = useState({ x: 0, y: 0 });

  // Voice input
  const { isSupported: voiceSupported, isListening, interimTranscript, start: startVoice, stop: stopVoice, error: voiceError, requestPermission } = useVoiceInput({
    onResult: (result) => {
      setText((prev) => prev + result);
    },
  });
  const toggleVoice = useCallback(() => {
    if (isListening) {
      stopVoice();
    } else {
      startVoice();
    }
  }, [isListening, startVoice, stopVoice]);

  // Handle voice permission request (click on ⚠️)
  const handleVoicePermission = useCallback(async () => {
    const granted = await requestPermission();
    if (granted) {
      startVoice();
    }
  }, [requestPermission, startVoice]);

  // Check if any cell is running
  const isRunning = notebook?.cells.some(
    (c) => c.status === 'running' || c.status === 'pending'
  );

  // Don't disable input when running - allow appending prompts to running cell
  const disabled = uploading || editMode;

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = mobile ? 120 : 200;
    const newHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${newHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
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
    const { images: pasted, skippedTypes } = await extractImagesFromClipboard(e);
    if (pasted.length > 0 || skippedTypes.length > 0) {
      e.preventDefault();
    }
    if (skippedTypes.length > 0) {
      setUploadStatus({
        phase: 'error',
        message: t('input.unsupportedImageType', skippedTypes.join(', ')),
      });
    }
    if (pasted.length > 0 && sessionId) {
      // Upload images immediately to server
      setUploadStatus({ phase: 'uploading', count: pasted.length });
      try {
        const uploaded: ImageRef[] = [];
        for (const img of pasted) {
          const ref = await uploadPromptImage(sessionId, img);
          uploaded.push(ref);
        }
        setImages((prev) => [...prev, ...uploaded].slice(0, MAX_IMAGES));
        setUploadStatus(null);
      } catch (err) {
        setUploadStatus({
          phase: 'error',
          message: String(err instanceof Error ? err.message : err),
        });
      }
    }
  }

  function handleRun() {
    const source = text.trim();
    if (!source && images.length === 0) return;
    // Save to prompt history before submitting
    if (source) saveToHistory(source);
    const imageRefs = images.length > 0
      ? images.map(({ path }) => ({ path }))
      : undefined;
    // If running, append to the running cell instead of creating a new one
    if (isRunning) {
      const runningCell = notebook?.cells.find((c) => c.status === 'running' || c.status === 'pending');
      if (runningCell) {
        appendPrompt(runningCell.id, source || '(image)', undefined, imageRefs);
      }
    } else {
      submitPrompt(source || '(image)', undefined, imageRefs);
    }
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

  const directSubmitCommand = (cmd: string) => {
    const source = `/${cmd} `;
    saveToHistory(source);
    // If running, append to running cell instead of creating a new one
    if (isRunning) {
      const runningCell = notebook?.cells.find((c) => c.status === 'running' || c.status === 'pending');
      if (runningCell) {
        appendPrompt(runningCell.id, source);
        return;
      }
    }
    submitPrompt(source);
  };

  // Line numbers derived from text content
  const lineNumbers = text.split('\n').length;

  // Convert vertical scroll to horizontal scroll on command toolbar
  // Must use native event listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = cmdBtnsRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (el.scrollWidth > el.clientWidth) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Command shortcuts
  const commands: { cmd: string; icon: string; args?: string; label?: string }[] = [
    { cmd: 'task-ai:auto', icon: '🤖', args: 'load' },
    { cmd: 'task-ai:research', icon: '🔍' },
    { cmd: 'task-ai:read', icon: '📖' },
    { cmd: 'task-ai:highlight', icon: '💡' },
    { cmd: 'task-ai:check', icon: '✅', args: 'Audit-and-Fix', label: 'check+fix' },
    { cmd: 'ralph-loop:ralph-loop', icon: '🔄', label: 'ralph-loop' },
    { cmd: 'ralph-loop:cancel-ralph', icon: '🚫', label: 'ralph-cancel' },
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
        {isListening && (
          <div className="voice-listening-indicator">
            <span className="voice-listening-dot" />
            <span className="voice-interim-text">{interimTranscript || 'Starting...'}</span>
          </div>
        )}
        {voiceError && !isListening && (
          <div className="voice-listening-indicator" style={{ background: 'var(--bg-error)' }}>
            <span>❌ {voiceError}</span>
          </div>
        )}
        <div className="nb-line-numbers" ref={lineNumRef} aria-hidden="true">
          {Array.from({ length: lineNumbers }, (_, i) => (
            <span key={i} className="nb-line-number">{i + 1}</span>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className="nb-input-textarea"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onScroll={() => {
            if (textareaRef.current && lineNumRef.current) {
              lineNumRef.current.scrollTop = textareaRef.current.scrollTop;
            }
          }}
          onDrop={(e) => {
            const MAX_DROP = 10000;
            const dropped = e.dataTransfer.getData('text/plain').slice(0, MAX_DROP);
            if (!dropped) { e.preventDefault(); return; }
            e.preventDefault();
            const el = textareaRef.current;
            if (!el) return;
            // dropCaretRef was set by onDragOver to track cursor at drop point
            const pos = dropCaretRef.current ?? el.selectionStart ?? el.value.length;
            const before = el.value.slice(0, pos);
            const after = el.value.slice(pos);
            setText(before + dropped + after);
            requestAnimationFrame(() => {
              const cursorPos = pos + dropped.length;
              el.setSelectionRange(cursorPos, cursorPos);
              el.focus();
            });
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            // Move caret to drag position for visual feedback + capture drop position
            const el = textareaRef.current;
            if (!el) return;
            el.focus();
            // After focus, browser may update selectionStart based on mouse position
            dropCaretRef.current = el.selectionStart;
          }}
          disabled={disabled}
          placeholder={editMode ? t('input.editModePlaceholder') : t('input.placeholderWithHints')}
          rows={mobile ? 1 : 3}
          spellCheck={false}
        />
      </div>
      <div className="nb-cmd-toolbar">
        <div className="nb-cmd-btns" ref={cmdBtnsRef}>
          {commands.map(({ cmd, icon, args, label }) => {
            const full = args ? `${cmd} ${args}` : cmd;
            const key = args ? `${cmd}--${label ?? args}` : cmd;
            return (
              <button
                key={key}
                className="nb-cmd-btn"
                title={args ? `/${full}` : t(`cmd.${cmd}`)}
                disabled={disabled}
                onClick={() => cmd === 'task-ai:auto' ? directSubmitCommand(full) : insertCommand(full)}
              >
                {icon} <span className="nb-cmd-name">/{label ?? cmd.split(':')[1]}</span>
              </button>
            );
          })}
        </div>
        <div className="nb-input-actions">
          {voiceSupported && (
            <button
              className={`voice-input-btn ${isListening ? 'voice-input-btn--active' : ''}`}
              title={voiceError || (isListening ? t('input.stopVoice') : t('input.startVoice'))}
              disabled={disabled}
              onClick={toggleVoice}
            >
              {isListening ? '🔴' : '🎤'}
            </button>
          )}
          {voiceError && (
            <button
              className="voice-error"
              title={voiceError + ' (click to retry)'}
              onClick={handleVoicePermission}
            >
              ⚠️
            </button>
          )}
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
