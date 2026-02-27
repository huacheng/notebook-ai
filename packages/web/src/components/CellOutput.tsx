import { useState } from 'react';
import type { CellOutput as CellOutputItem } from '@notebook-ai/shared';
import { StreamingText, StreamingThinking } from './StreamingCellOutput';
import { InteractiveOptions } from './InteractiveOptions';
import { isAskUserQuestion } from '../utils/interactiveOptions';
import type { AskQuestion } from '../utils/interactiveOptions';
import { useStore } from '../store';

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

// ── Panel: Thinking ──────────────────────────────────────────────────────────

type ThinkingItem = Extract<CellOutputItem, { type: 'thinking' }>;

function ThinkingPanel({ items }: { items: ThinkingItem[] }) {
  const [open, setOpen] = useState(false);
  const combined = items.map((i) => i.content).join('\n\n---\n\n');
  return (
    <div className="output-thinking">
      <button
        className="output-collapsible-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible-icon">{open ? '▼' : '▶'}</span>
        Thinking
        <span className="cell-panel-tab-count">{items.length}</span>
      </button>
      {open && (
        <div className="output-thinking-content">
          <pre className="output-thinking-text">{combined}</pre>
        </div>
      )}
    </div>
  );
}

// ── Panel: Tools ─────────────────────────────────────────────────────────────

type ToolItem = Extract<CellOutputItem, { type: 'tool_use' }>;

function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);

  const inputKeys = Object.keys(item.input);
  const firstVal = inputKeys.length > 0 ? String(Object.values(item.input)[0]) : '';
  const shortVal = firstVal.length > 50 ? firstVal.slice(0, 50) + '…' : firstVal;
  const summary = shortVal || `${inputKeys.length} params`;

  const hasResult = item.result !== undefined;
  const isError = item.is_error ?? false;
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
        {hasResult && !open && (
          <span className={isError ? 'tool-use-fail' : 'tool-use-done'}>
            {isError ? '✗' : '✓'}
          </span>
        )}
      </button>

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

function ToolsPanel({ items }: { items: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const errorCount = items.filter((i) => i.is_error).length;
  const doneCount  = items.filter((i) => i.result !== undefined && !i.is_error).length;

  return (
    <div className="output-thinking">
      <button
        className="output-collapsible-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible-icon">{open ? '▼' : '▶'}</span>
        Tools
        <span className="cell-panel-tab-count">{items.length}</span>
        {doneCount  > 0 && <span className="tool-use-done"  style={{ marginLeft: 4 }}>✓{doneCount}</span>}
        {errorCount > 0 && <span className="tool-use-fail"  style={{ marginLeft: 4 }}>✗{errorCount}</span>}
      </button>
      {open && (
        <div className="output-thinking-content">
          <div className="cell-panel-tools">
            {items.map((item, i) => (
              <ToolRow key={i} item={item} />
            ))}
          </div>
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

// ── Public component ─────────────────────────────────────────────────────────

interface CellOutputProps {
  outputs: CellOutputItem[];
  isActiveCell?: boolean;
  cellId?: string;
  cellStatus?: string;
}

export function CellOutput({ outputs, cellId, cellStatus }: CellOutputProps) {
  const isRunning = cellStatus === 'running';

  const hasStaticOutput = outputs.length > 0;
  const hasStreaming = isRunning && cellId;

  if (!hasStaticOutput && !hasStreaming) return null;

  // ── Streaming branch: flat rendering (unchanged) ──
  if (hasStreaming) {
    const allToolItems = outputs.filter(
      (o): o is ToolItem => o.type === 'tool_use',
    );
    const interactiveItems = allToolItems.filter(isAskUserQuestion);
    const toolItems = allToolItems.filter((i) => !isAskUserQuestion(i));

    return (
      <div className="cell-output-area">
        <StreamingThinking cellId={cellId} />
        {toolItems.length > 0 && <ToolsPanel items={toolItems} />}
        {interactiveItems.map((item, i) => (
          <InteractiveOptionsWrapper key={item.tool_use_id ?? i} item={item} />
        ))}
        <StreamingText cellId={cellId} />
      </div>
    );
  }

  // ── Completed branch: aggregated display ──
  const thinkingItems = outputs.filter(
    (o): o is ThinkingItem => o.type === 'thinking',
  );
  const allToolItems = outputs.filter(
    (o): o is ToolItem => o.type === 'tool_use',
  );
  const interactiveItems = allToolItems.filter(isAskUserQuestion);
  const toolItems = allToolItems.filter((i) => !isAskUserQuestion(i));
  const responseItems = outputs.filter(
    (o) => o.type === 'text' || o.type === 'error' || o.type === 'chart',
  );

  return (
    <div className="cell-output-area">
      {thinkingItems.length > 0 && <ThinkingPanel items={thinkingItems} />}

      {toolItems.length > 0 && <ToolsPanel items={toolItems} />}

      {interactiveItems.map((item, i) => (
        <InteractiveOptionsWrapper key={item.tool_use_id ?? i} item={item} />
      ))}

      {responseItems.length > 0 && (
        <div className="cell-response">
          {responseItems.map((item, i) => {
            if (item.type === 'text')  return <TextOutputView  key={i} content={item.content} />;
            if (item.type === 'error') return <ErrorOutputView key={i} message={item.message} />;
            if (item.type === 'chart') return <ChartOutputView key={i} chart_type={item.chart_type} svg={item.svg} />;
            return null;
          })}
        </div>
      )}
    </div>
  );
}
