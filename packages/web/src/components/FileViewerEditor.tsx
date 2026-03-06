import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Fragment, Slice, type Node as PmNode } from '@tiptap/pm/model';
import DOMPurify from 'dompurify';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useStore } from '../store';

// D2: Maximum content size that can be saved (1MB)
const MAX_EDITOR_CONTENT_SIZE = 1024 * 1024;

// Auto-save debounce intervals
const LOCAL_SAVE_DEBOUNCE = 50;
const SERVER_SAVE_DEBOUNCE = 200;

// Generate localStorage key for draft
const EDITOR_DRAFT_PREFIX = 'fv-editor-draft:';

/* ── TipTap Extensions ────────────────────────────────────── */

/** Render each space character as a translucent dot via inline decoration. */
const WhitespaceDisplay = Extension.create({
  name: 'whitespaceDisplay',
  addProseMirrorPlugins() {
    const key = new PluginKey('whitespaceDisplay');
    function build(doc: PmNode) {
      const decos: Decoration[] = [];
      doc.descendants((node: PmNode, pos: number) => {
        if (!node.isText || !node.text) return;
        for (let i = 0; i < node.text.length; i++) {
          if (node.text[i] === ' ') {
            decos.push(Decoration.inline(pos + i, pos + i + 1, { class: 'fv-ws-dot' }));
          }
        }
      });
      return DecorationSet.create(doc, decos);
    }
    return [new Plugin({
      key,
      state: {
        init(_, state) { return build(state.doc); },
        apply(tr, old) { return tr.docChanged ? build(tr.doc) : old; },
      },
      props: {
        decorations(state) { return key.getState(state); },
      },
    })];
  },
});

/** Convert Tab key to two spaces. */
const TabToSpaces = Extension.create({
  name: 'tabToSpaces',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        this.editor.commands.insertContent('  ');
        return true;
      },
    };
  },
});

/**
 * Prevent ProseMirror from converting pasted newlines into separate paragraphs
 * (which adds extra blank lines on save). Instead, insert hard breaks.
 */
const PasteAsPlainText = Extension.create({
  name: 'pasteAsPlainText',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('pasteAsPlainText'),
      props: {
        handlePaste(view, event) {
          const text = event.clipboardData?.getData('text/plain');
          if (!text) return false;
          event.preventDefault();
          const { schema, tr } = view.state;
          const lines = text.split(/\r?\n/);
          const nodes: PmNode[] = [];
          lines.forEach((line, i) => {
            if (i > 0) nodes.push(schema.nodes.hardBreak.create());
            if (line) nodes.push(schema.text(line));
          });
          const fragment = Fragment.from(nodes);
          view.dispatch(tr.replaceSelection(new Slice(fragment, 0, 0)));
          return true;
        },
      },
    })];
  },
});

/* ── Component ────────────────────────────────────────────── */

interface FileViewerEditorProps {
  content: string;
  format: 'text' | 'html';
  sessionId: string;
  filePath: string;
  source: 'workspace' | 'library' | 'deliverables';
  projectId?: string;
}

export function FileViewerEditor({ content, format, sessionId, filePath, source, projectId }: FileViewerEditorProps) {
  const ws = useStore((s) => s.ws);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [lineCount, setLineCount] = useState(1);

  // Compute effective session ID for WS messages (matches backend pseudo-session format)
  const effectiveSessionId = useMemo(() => {
    if (sessionId) return sessionId;
    if (projectId) return `__project_${projectId}__`;
    return '__library__';
  }, [sessionId, projectId]);

  // Refs for debounce timers
  const localSaveTimerRef = useRef<number | null>(null);
  const serverSaveTimerRef = useRef<number | null>(null);

  // Refs to hold latest values for onUpdate callback (avoids stale closure)
  const wsRef = useRef(ws);
  const effectiveSessionIdRef = useRef(effectiveSessionId);
  const filePathRef = useRef(filePath);
  const sourceRef = useRef(source);
  const projectIdRef = useRef(projectId);
  const formatRef = useRef(format);

  // Keep refs in sync
  useEffect(() => { wsRef.current = ws; }, [ws]);
  useEffect(() => { effectiveSessionIdRef.current = effectiveSessionId; }, [effectiveSessionId]);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);
  useEffect(() => { sourceRef.current = source; }, [source]);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);
  useEffect(() => { formatRef.current = format; }, [format]);

  // localStorage key based on filePath
  const draftKey = useMemo(() => `${EDITOR_DRAFT_PREFIX}${filePath}`, [filePath]);
  const draftKeyRef = useRef(draftKey);
  useEffect(() => { draftKeyRef.current = draftKey; }, [draftKey]);

  // Check for existing draft on mount
  const initialContent = useMemo(() => {
    const draft = localStorage.getItem(draftKey);
    if (draft) {
      return draft;
    }
    // D2: HTML-escape text content to prevent XSS via malicious file content
    return format === 'html'
      ? DOMPurify.sanitize(content)
      : `<pre><code>${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
  }, [draftKey, content, format]);

  const editor = useEditor({
    extensions: [StarterKit, WhitespaceDisplay, TabToSpaces],
    content: initialContent,
    onCreate: ({ editor: ed }) => {
      setLineCount(ed.getText().split('\n').length);
    },
    onUpdate: ({ editor: ed }) => {
      const fmt = formatRef.current;
      const currentContent = fmt === 'html' ? ed.getHTML() : ed.getText();

      setLineCount(ed.getText().split('\n').length);

      // D2: Skip save if content too large
      if (currentContent.length > MAX_EDITOR_CONTENT_SIZE) return;

      // 50ms debounce for localStorage
      if (localSaveTimerRef.current) {
        clearTimeout(localSaveTimerRef.current);
      }
      localSaveTimerRef.current = window.setTimeout(() => {
        localStorage.setItem(draftKeyRef.current, currentContent);
      }, LOCAL_SAVE_DEBOUNCE);

      // 200ms debounce for WebSocket save
      if (serverSaveTimerRef.current) {
        clearTimeout(serverSaveTimerRef.current);
      }
      serverSaveTimerRef.current = window.setTimeout(() => {
        const currentWs = wsRef.current;
        if (!currentWs) return;
        setAutoSaving(true);
        const msg: Record<string, string> = {
          type: 'file-save',
          session_id: effectiveSessionIdRef.current,
          path: filePathRef.current,
          source: sourceRef.current,
          content: currentContent,
          format: fmt,
        };
        if (projectIdRef.current) msg.project_id = projectIdRef.current;
        currentWs.send(JSON.stringify(msg));
      }, SERVER_SAVE_DEBOUNCE);
    },
  });

  // Handle WebSocket responses
  useEffect(() => {
    if (!ws) return;
    function handleMessage(event: MessageEvent) {
      let msg: { type: string; session_id?: string };
      try { msg = JSON.parse(event.data as string); } catch { return; }
      if (msg.session_id !== effectiveSessionId) return;
      if (msg.type === 'file-save-ok') {
        setSaving(false);
        setAutoSaving(false);
        setSaveStatus('saved');
        // Clear draft from localStorage after successful save
        localStorage.removeItem(draftKey);
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else if (msg.type === 'file-save-error') {
        setSaving(false);
        setAutoSaving(false);
        setSaveStatus('error');
      }
    }
    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, effectiveSessionId, draftKey]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
      if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    };
  }, []);

  const handleSave = useCallback(() => {
    if (!editor || !ws) return;
    const savedContent = format === 'html' ? editor.getHTML() : editor.getText();
    // D2: Validate content size before sending
    if (savedContent.length > MAX_EDITOR_CONTENT_SIZE) {
      alert(`Content too large (${(savedContent.length / 1024).toFixed(0)}KB, max 1MB)`);
      return;
    }
    setSaving(true);
    setSaveStatus('idle');
    const msg: Record<string, string> = {
      type: 'file-save',
      session_id: effectiveSessionId,
      path: filePath,
      source,
      content: savedContent,
      format,
    };
    if (projectId) msg.project_id = projectId;
    ws.send(JSON.stringify(msg));
  }, [editor, ws, effectiveSessionId, filePath, source, projectId, format]);

  return (
    <div className="fv-editor">
      <div className="fv-editor__toolbar">
        <button className="fv-editor__save" onClick={handleSave} disabled={saving || autoSaving}>
          {saving ? 'Saving…' : autoSaving ? 'Syncing…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error ✕' : 'Save'}
        </button>
      </div>
      <div className="fv-editor__body">
        <div className="fv-editor__gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="fv-editor__line-no">{i + 1}</div>
          ))}
        </div>
        <EditorContent editor={editor} className="fv-editor__content" />
      </div>
    </div>
  );
}
