import { useEffect, useRef } from 'react';
import { useStore } from '../store';

export function StreamingText({ cellId }: { cellId: string }) {
  const containerRef = useRef<HTMLPreElement>(null);
  const lastRendered = useRef('');

  useEffect(() => {
    const interval = setInterval(() => {
      const buf = useStore.getState().streamBuffer[cellId];
      if (!buf) return;
      if (buf.text !== lastRendered.current) {
        lastRendered.current = buf.text;
        if (containerRef.current) {
          containerRef.current.textContent = buf.text;
        }
      }
    }, 20);
    return () => clearInterval(interval);
  }, [cellId]);

  return <pre ref={containerRef} className="output-text streaming" />;
}

export function StreamingThinking({ cellId }: { cellId: string }) {
  const containerRef = useRef<HTMLPreElement>(null);
  const lastRendered = useRef('');

  useEffect(() => {
    const interval = setInterval(() => {
      const buf = useStore.getState().streamBuffer[cellId];
      if (!buf) return;
      if (buf.thinking !== lastRendered.current) {
        lastRendered.current = buf.thinking;
        if (containerRef.current) {
          containerRef.current.textContent = buf.thinking;
        }
      }
    }, 20);
    return () => clearInterval(interval);
  }, [cellId]);

  return (
    <div className="output-thinking streaming">
      <div className="output-thinking-header-streaming">Thinking…</div>
      <div className="output-thinking-content">
        <pre ref={containerRef} className="output-thinking-text" />
      </div>
    </div>
  );
}
