import { useState, useEffect } from 'react';
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
      // Buffer flushed (execution complete) → clear text
      if (!buf) {
        if (lastRendered !== '') {
          lastRendered = '';
          setText('');
        }
        return;
      }
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
    }, 50);
    return () => clearInterval(interval);
  }, [cellId, lastTextContent]);

  return (
    <div className="streaming-text-area">
      <MarkdownRenderer content={text} className="output-text-md streaming" />
    </div>
  );
}

/** Max lines shown in collapsed (preview) mode */
const PREVIEW_LINES = 4;

function lastNLines(text: string, n: number): string {
  const lines = text.split('\n');
  return lines.length <= n ? text : lines.slice(-n).join('\n');
}

export function StreamingThinking({ cellId, lastThinkingContent }: { cellId: string; lastThinkingContent?: string }) {
  const [open, setOpen] = useState(false);
  const [thinking, setThinking] = useState(() => {
    const buf = useStore.getState().streamBuffer[cellId];
    return buf?.thinking ?? '';
  });

  useEffect(() => {
    let lastRendered = '';
    const interval = setInterval(() => {
      const buf = useStore.getState().streamBuffer[cellId];
      // Buffer flushed (execution complete) → clear thinking
      if (!buf) {
        if (lastRendered !== '') {
          lastRendered = '';
          setThinking('');
        }
        return;
      }
      if (lastThinkingContent && buf.thinking === lastThinkingContent) {
        if (lastRendered !== '') {
          lastRendered = '';
          setThinking('');
        }
        return;
      }
      if (buf.thinking !== lastRendered) {
        lastRendered = buf.thinking;
        setThinking(buf.thinking);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [cellId, lastThinkingContent]);

  if (!thinking) return null;

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
      <div className="output-thinking-content">
        <pre className="output-thinking-text">
          {open ? thinking : lastNLines(thinking, PREVIEW_LINES)}
        </pre>
      </div>
    </div>
  );
}
