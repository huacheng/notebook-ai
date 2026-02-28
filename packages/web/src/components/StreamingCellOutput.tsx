import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';

export function StreamingText({ cellId, lastTextContent }: { cellId: string; lastTextContent?: string }) {
  const containerRef = useRef<HTMLPreElement>(null);
  const lastRendered = useRef('');

  useEffect(() => {
    const interval = setInterval(() => {
      const buf = useStore.getState().streamBuffer[cellId];
      if (!buf) return;
      // De-duplicate: if streamBuffer text equals an already-committed output, skip
      if (lastTextContent && buf.text === lastTextContent) {
        if (containerRef.current) containerRef.current.textContent = '';
        return;
      }
      if (buf.text !== lastRendered.current) {
        lastRendered.current = buf.text;
        if (containerRef.current) {
          containerRef.current.textContent = buf.text;
        }
      }
    }, 20);
    return () => clearInterval(interval);
  }, [cellId, lastTextContent]);

  return <pre ref={containerRef} className="output-text streaming" />;
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
