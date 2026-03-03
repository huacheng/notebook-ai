import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import DOMPurify from 'dompurify';
import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store';

// D2: Maximum content size that can be saved (1MB)
const MAX_EDITOR_CONTENT_SIZE = 1024 * 1024;

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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const editor = useEditor({
    extensions: [StarterKit],
    // D2: HTML-escape text content to prevent XSS via malicious file content
    content: format === 'html' ? DOMPurify.sanitize(content) : `<pre><code>${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`,
  });

  useEffect(() => {
    if (!ws) return;
    function handleMessage(event: MessageEvent) {
      let msg: { type: string; session_id?: string };
      try { msg = JSON.parse(event.data as string); } catch { return; }
      if (msg.session_id !== sessionId) return;
      if (msg.type === 'file-save-ok') {
        setSaving(false);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else if (msg.type === 'file-save-error') {
        setSaving(false);
        setSaveStatus('error');
      }
    }
    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, sessionId]);

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
      session_id: sessionId,
      path: filePath,
      source,
      content: savedContent,
    };
    if (projectId) msg.project_id = projectId;
    ws.send(JSON.stringify(msg));
  }, [editor, ws, sessionId, filePath, source, projectId, format]);

  return (
    <div className="fv-editor">
      <div className="fv-editor__toolbar">
        <button className="fv-editor__save" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error ✕' : 'Save'}
        </button>
      </div>
      <EditorContent editor={editor} className="fv-editor__content" />
    </div>
  );
}
