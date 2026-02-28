import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { MarkdownRenderer } from './MarkdownRenderer';

export function StreamingText({ cellId, lastTextContent }: { cellId: string; lastTextContent?: string }) {
  const [text, setText] = useState(() => {
    const buf = useStore.getState().streamBuffer[cellId];
    return buf?.text ?? '';
  });

  useEffect(() => {
    let lastRendered = '';
    const interval = setInterval(() => {
      const buf = useStore.getState().streamBuffer[cellId];
      if (!buf) return;
      // De-duplicate: if streamBuffer text equals an already-committed output, skip
      if (lastTextContent && buf.text === lastTextContent) {
        if (lastRendered !== '') {
          lastRendered = '';
          setText('');
        }
        return;
      }
      if (buf.text !== lastRendered) {
        lastRendered = buf.text;
        setText(buf.text);
      }
    }, 100); // 100ms for markdown rendering performance
    return () => clearInterval(interval);
  }, [cellId, lastTextContent]);

  return (
    <div className="streaming-text-area">
      <MarkdownRenderer content={text} className="output-text-md streaming" />
    </div>
  );
}

export function StreamingThinking({ cellId, lastThinkingContent }: { cellId: string; lastThinkingContent?: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLPreElement>(null);
  const lastRendered = useRef('');

  useEffect(() => {
    const interval = setInterval(() => {
      const buf = useStore.getState().streamBuffer[cellId];
      if (!buf) return;
      // De-duplicate: if streamBuffer thinking equals an already-committed output, skip
      if (lastThinkingContent && buf.thinking === lastThinkingContent) {
        if (containerRef.current) containerRef.current.textContent = '';
        return;
      }
      if (buf.thinking !== lastRendered.current) {
        lastRendered.current = buf.thinking;
        if (containerRef.current) {
          containerRef.current.textContent = buf.thinking;
        }
      }
    }, 20);
    return () => clearInterval(interval);
  }, [cellId, lastThinkingContent]);

  return (
    <div className="output-thinking streaming">
      <button
        className="output-collapsible-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible-icon">{open ? '▼' : '▶'}</span>
        Thinking…
        <span className="spinner" aria-hidden="true" style={{ marginLeft: 6 }} />
      </button>
      {open && (
        <div className="output-thinking-content">
          <pre ref={containerRef} className="output-thinking-text" />
        </div>
      )}
    </div>
  );
}
