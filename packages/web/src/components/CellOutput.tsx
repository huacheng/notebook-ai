import { useState, useEffect, useRef } from 'react';
import type { CellOutput as CellOutputItem } from '@notebook-ai/shared';
import { StreamingText, StreamingThinking } from './StreamingCellOutput';
import { InteractiveOptions } from './InteractiveOptions';
import { isAskUserQuestion } from '../utils/interactiveOptions';
import type { AskQuestion } from '../utils/interactiveOptions';
import { useStore } from '../store';
import { formatTime, formatTokens } from '../utils/runningStatus';

// ── SVG sanitizer ────────────────────────────────────────────────────────────

const DANGEROUS_TAGS = /(<script[\s\S]*?<\/script>|<script[^>]*\/>)/gi;
const DANGEROUS_ATTRS = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
const JAVASCRIPT_HREF = /\s+(?:href|xlink:href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi;

function sanitizeSvg(svg: string): string {
  return svg
    .replace(DANGEROUS_TAGS, '')
    .replace(DANGEROUS_ATTRS, '')
    .replace(JAVASCRIPT_HREF, '');
}

// ── Response renderers ───────────────────────────────────────────────────────

function TextOutputView({ content }: { content: string }) {
  return <pre className="output-text">{content}</pre>;
}

function ErrorOutputView({ message }: { message: string }) {
  return (
    <div className="output-error">
      <span className="output-error-icon">✕</span>
      <pre className="output-error-message">{message}</pre>
    </div>
  );
}

function ChartOutputView({ chart_type, svg }: { chart_type: string; svg?: string }) {
  if (svg) {
    return (
      <div
        className="output-chart"
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }}
      />
    );
  }
  return (
    <div className="output-chart output-chart-placeholder">
      <span>Chart ({chart_type}) — visualization will render here</span>
    </div>
  );
}

// ── Inline thinking (single block, collapsible) ─────────────────────────────

type ThinkingItem = Extract<CellOutputItem, { type: 'thinking' }>;

function InlineThinking({ item }: { item: ThinkingItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="output-thinking">
      <button
        className="output-collapsible-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible-icon">{open ? '▼' : '▶'}</span>
        Thinking
      </button>
      {open && (
        <div className="output-thinking-content">
          <pre className="output-thinking-text">{item.content}</pre>
        </div>
      )}
    </div>
  );
}

// ── Tool row (unchanged) ────────────────────────────────────────────────────

type ToolItem = Extract<CellOutputItem, { type: 'tool_use' }>;

/** Truncate to first N lines, append "…" if truncated */
function previewLines(text: string, maxLines = 2): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + '\n…';
}

function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);

  const inputKeys = Object.keys(item.input);
  const firstVal = inputKeys.length > 0 ? String(Object.values(item.input)[0]) : '';
  const shortVal = firstVal.length > 50 ? firstVal.slice(0, 50) + '…' : firstVal;
  const summary = shortVal || `${inputKeys.length} params`;

  const hasResult = item.result !== undefined;
  const isError = item.is_error ?? false;
  const pending = !hasResult;
  const statusClass = hasResult ? (isError ? 'tool-result-error' : 'tool-result-ok') : '';

  return (
    <div className={`output-tool-use${statusClass ? ` ${statusClass}` : ''}`}>
      <button
        className="output-collapsible-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible-icon">{open ? '▼' : '▶'}</span>
        <code className="tool-use-name">{item.name}</code>
        {!open && <span className="collapsible-summary">{summary}</span>}
        {pending && <span className="spinner tool-use-spinner" aria-hidden="true" />}
        {hasResult && !open && (
          <span className={isError ? 'tool-use-fail' : 'tool-use-done'}>
            {isError ? '✗' : '✓'}
          </span>
        )}
      </button>

      {/* Result preview (visible without expanding) */}
      {hasResult && !open && (
        <pre className={`tool-use-result-preview${isError ? ' tool-use-result-preview-error' : ''}`}>
          {previewLines(item.result!, 2)}
        </pre>
      )}

      {open && (
        <div className="tool-use-details">
          <div className="tool-use-section">
            <span className="tool-use-section-label">Input</span>
            <pre className="tool-use-json">{JSON.stringify(item.input, null, 2)}</pre>
          </div>
          {hasResult && (
            <div className={`tool-use-section${isError ? ' tool-use-section-error' : ''}`}>
              <span className="tool-use-section-label">{isError ? 'Error' : 'Result'}</span>
              <pre className="tool-use-result">{item.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Interactive options wrapper ──────────────────────────────────────────────

function InteractiveOptionsWrapper({ item }: { item: ToolItem }) {
  const submitPrompt = useStore((s) => s.submitPrompt);
  const questions = (item.input as { questions: AskQuestion[] }).questions;

  return (
    <InteractiveOptions
      questions={questions}
      onSelect={(answer) => submitPrompt(answer)}
    />
  );
}

// ── RunningStatus bar ───────────────────────────────────────────────────────

function RunningStatus({ cellId, outputs }: { cellId: string; outputs: CellOutputItem[] }) {
  const startRef = useRef(Date.now());
  const thinkStartRef = useRef<number | null>(null);
  const thinkAccum = useRef(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    startRef.current = Date.now();
    thinkStartRef.current = null;
    thinkAccum.current = 0;
  }, [cellId]);

  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // Read store non-reactively each render (driven by tick)
  const buf = useStore.getState().streamBuffer[cellId];
  const hasThinkingStream = buf && buf.thinking.length > 0;

  // Track thinking time
  if (hasThinkingStream && thinkStartRef.current === null) {
    thinkStartRef.current = Date.now();
  } else if (!hasThinkingStream && thinkStartRef.current !== null) {
    thinkAccum.current += (Date.now() - thinkStartRef.current) / 1000;
    thinkStartRef.current = null;
  }

  const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
  const totalChars = (buf?.text.length ?? 0) + (buf?.thinking.length ?? 0)
    + outputs.reduce((s, o) => s + ('content' in o ? (o as { content: string }).content.length : 0), 0);
  const tokens = Math.floor(totalChars / 4);
  const toolCount = outputs.filter((o) => o.type === 'tool_use' && !isAskUserQuestion(o as ToolItem)).length;
  const thinkSec = Math.floor(
    thinkAccum.current + (thinkStartRef.current ? (Date.now() - thinkStartRef.current) / 1000 : 0),
  );

  const isThinking = hasThinkingStream;

  // Build metrics string
  const parts: string[] = [];
  if (tokens > 0) parts.push(`↑ ${formatTokens(tokens)}`);
  if (toolCount > 0) parts.push(`${toolCount} tool use${toolCount > 1 ? 's' : ''}`);
  if (thinkSec > 0 && !isThinking) parts.push(`thought for ${formatTime(thinkSec)}`);

  const label = isThinking ? 'Thinking…' : 'Running…';
  const metrics = parts.length > 0 ? ` (${formatTime(elapsed)} · ${parts.join(' · ')})` : ` (${formatTime(elapsed)})`;

  return (
    <span className="cell-status cell-status-running" aria-label="running">
      <span className="spinner" aria-hidden="true" />
      {label}
      <span className="cell-status-metrics">{metrics}</span>
    </span>
  );
}

// ── Timeline: render outputs in chronological order ─────────────────────────

function TimelineOutputs({ outputs }: { outputs: CellOutputItem[] }) {
  return (
    <>
      {outputs.map((output, i) => {
        if (output.type === 'thinking') return <InlineThinking key={i} item={output} />;
        if (output.type === 'tool_use') {
          if (isAskUserQuestion(output)) {
            return <InteractiveOptionsWrapper key={output.tool_use_id ?? i} item={output} />;
          }
          return <ToolRow key={output.tool_use_id ?? i} item={output} />;
        }
        if (output.type === 'text') return <TextOutputView key={i} content={output.content} />;
        if (output.type === 'error') return <ErrorOutputView key={i} message={output.message} />;
        if (output.type === 'chart') return <ChartOutputView key={i} chart_type={output.chart_type} svg={output.svg} />;
        return null;
      })}
    </>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

interface CellOutputProps {
  outputs: CellOutputItem[];
  isActiveCell?: boolean;
  cellId?: string;
  cellStatus?: string;
}

export function CellOutput({ outputs, cellId, cellStatus }: CellOutputProps) {
  const isRunning = cellStatus === 'running';
  const timelineRef = useRef<HTMLDivElement>(null);

  const hasStaticOutput = outputs.length > 0;
  const hasStreaming = isRunning && cellId;

  // Auto-scroll timeline window to bottom during streaming
  useEffect(() => {
    if (!hasStreaming) return;
    const iv = setInterval(() => {
      const el = timelineRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 200);
    return () => clearInterval(iv);
  }, [hasStreaming]);

  if (!hasStaticOutput && !hasStreaming) return null;

  // ── Streaming branch: timeline window + status bar ──
  if (hasStreaming) {
    // Check if streamBuffer has content not yet in outputs (for de-duplication)
    const lastThinking = outputs.filter((o) => o.type === 'thinking').at(-1);
    const lastText = outputs.filter((o) => o.type === 'text').at(-1);

    return (
      <div className="cell-output-area">
        <div className="cell-timeline-window" ref={timelineRef}>
          <TimelineOutputs outputs={outputs} />
          <StreamingThinking cellId={cellId} lastThinkingContent={lastThinking?.type === 'thinking' ? lastThinking.content : undefined} />
          <StreamingText cellId={cellId} lastTextContent={lastText?.type === 'text' ? lastText.content : undefined} />
        </div>
        <RunningStatus cellId={cellId} outputs={outputs} />
      </div>
    );
  }

  // ── Completed branch: same timeline layout ──
  return (
    <div className="cell-output-area">
      <TimelineOutputs outputs={outputs} />
    </div>
  );
}
