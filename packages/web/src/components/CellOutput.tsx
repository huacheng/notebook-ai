import { useState, useEffect, useRef } from 'react';
import type { CellOutput as CellOutputItem } from '@notebook-ai/shared';
import { StreamingText, StreamingThinking } from './StreamingCellOutput';
import { InteractiveOptions } from './InteractiveOptions';
import { isAskUserQuestion, isClaudeCodeAutoResponse } from '../utils/interactiveOptions';
import type { AskQuestion } from '../utils/interactiveOptions';
import { useStore } from '../store';
import { formatTime, formatTokens, estimateTokens, getStatusLabelKey } from '../utils/runningStatus';
import { useT } from '../i18n';
import { MarkdownRenderer } from './MarkdownRenderer';
import { buildTimelineItems } from '../utils/timelineItems';
import { thinkingGroupProps, toolsGroupProps } from '../utils/groupProps';

import DOMPurify from 'dompurify';

// ── SVG sanitizer (DOMPurify-based for robust XSS prevention) ───────────────

function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}

// ── Response renderers ───────────────────────────────────────────────────────

export function TextOutputView({ content }: { content: string }) {
  return <MarkdownRenderer content={content} className="output-text-md" />;
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
    <div className="tl-block tl-block--thinking">
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

function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);

  const inputKeys = Object.keys(item.input);
  const firstVal = inputKeys.length > 0 ? String(Object.values(item.input)[0]) : '';
  const shortVal = firstVal.length > 50 ? firstVal.slice(0, 50) + '…' : firstVal;
  const summary = shortVal || `${inputKeys.length} params`;

  const hasResult = item.result !== undefined;
  const isError = item.is_error ?? false;
  const pending = !hasResult;

  const classes = ['tl-block', 'tl-block--tool'];
  if (hasResult) classes.push(isError ? 'tool-result-error' : 'tool-result-ok');
  if (pending) classes.push('tl-block--pending');

  return (
    <div className={classes.join(' ')}>
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

// ── Collapsible groups (completed branch) ───────────────────────────────────

function ThinkingGroup({ items }: { items: ThinkingItem[] }) {
  const [open, setOpen] = useState(false);
  const { label } = thinkingGroupProps(items);
  return (
    <div className="tl-group tl-group--thinking">
      <button
        className="tl-group-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible-icon">{open ? '▼' : '▶'}</span>
        {label}
      </button>
      {open && (
        <div className="tl-group-body tl-group-body--scroll">
          <pre className="output-thinking-text">
            {items.map((item) => item.content).join('\n\n')}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolsGroup({ items }: { items: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const { label } = toolsGroupProps(items);
  return (
    <div className="tl-group tl-group--tools">
      <button
        className="tl-group-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible-icon">{open ? '▼' : '▶'}</span>
        {label}
      </button>
      {open && (
        <div className="tl-group-body tl-group-body--scroll">
          {items.map((item, i) => {
            if (isAskUserQuestion(item)) return null;
            return <ToolRow key={item.tool_use_id ?? i} item={item} />;
          })}
        </div>
      )}
    </div>
  );
}

// ── Interactive options wrapper ──────────────────────────────────────────────

function InteractiveOptionsWrapper({ item, cellId }: { item: ToolItem; cellId?: string }) {
  const submitToolResult = useStore((s) => s.submitToolResult);
  const updateToolResultLocal = useStore((s) => s.updateToolResultLocal);
  const submitPrompt = useStore((s) => s.submitPrompt);
  const sessionId = useStore((s) => s.sessionId);
  const questions = (item.input as { questions?: AskQuestion[] })?.questions ?? [];

  // If item.result exists AND it's not the Claude Code auto-response, the question has been answered
  // Also check isActive: if isActive === false, the question is frozen (answered on another device/session)
  const isAutoResponse = isClaudeCodeAutoResponse(item.result, item.is_error);
  const isAnswered = (item.result !== undefined && !isAutoResponse) || item.isActive === false;

  return (
    <InteractiveOptions
      questions={questions}
      initialAnswered={isAnswered}
      onSelect={(answer) => {
        if (isAutoResponse) {
          // D1/D3: Persist user's actual choice to notebook (replaces "Answer questions?")
          // Best-effort: only if we have all required IDs
          if (sessionId && cellId && item.tool_use_id) {
            updateToolResultLocal(sessionId, cellId, item.tool_use_id, answer);
          }
          // Claude Code auto-responded - send a follow-up prompt with the user's choice
          submitPrompt(`用户选择了: ${answer}`);
        } else if (sessionId && item.tool_use_id) {
          // Normal case - send tool_result
          submitToolResult(sessionId, item.tool_use_id, answer);
        }
      }}
    />
  );
}

// ── RunningStatus bar ───────────────────────────────────────────────────────

function RunningStatus({ cellId, outputs, source }: { cellId: string; outputs: CellOutputItem[]; source: string }) {
  const t = useT();
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

  // Split token estimation: input (↑) vs output (↓)
  const { input: inputTokens, output: outputTokens } = estimateTokens(source, outputs, buf ?? undefined);

  const toolCount = outputs.filter((o) => o.type === 'tool_use' && !isAskUserQuestion(o as ToolItem)).length;
  const thinkSec = Math.floor(
    thinkAccum.current + (thinkStartRef.current ? (Date.now() - thinkStartRef.current) / 1000 : 0),
  );

  const isThinking = hasThinkingStream;
  const hasAnyOutput = (buf && (buf.text.length > 0 || buf.thinking.length > 0)) || outputs.length > 0;

  // Build metrics string
  const parts: string[] = [];
  if (inputTokens > 0) parts.push(`↑ ${formatTokens(inputTokens)}`);
  if (outputTokens > 0) parts.push(`↓ ${formatTokens(outputTokens)}`);
  if (toolCount > 0) parts.push(`${toolCount} tool use${toolCount > 1 ? 's' : ''}`);
  if (thinkSec > 0 && !isThinking) parts.push(`thought for ${formatTime(thinkSec)}`);

  const label = t(getStatusLabelKey(isThinking, hasAnyOutput, elapsed));
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
  source?: string;
}

export function CellOutput({ outputs, cellId, cellStatus, source = '' }: CellOutputProps) {
  const isRunning = cellStatus === 'running';

  const hasStaticOutput = outputs.length > 0;
  const hasStreaming = isRunning && cellId;

  if (!hasStaticOutput && !hasStreaming) return null;

  // ── Streaming branch: StreamingThinking + ToolsGroup + StreamingText ──
  if (hasStreaming) {
    const lastThinking = outputs.filter((o) => o.type === 'thinking').at(-1);
    const lastText = outputs.filter((o) => o.type === 'text').at(-1);

    const { tools } = buildTimelineItems(outputs);

    return (
      <div className="cell-output-area">
        <StreamingThinking cellId={cellId} lastThinkingContent={lastThinking?.type === 'thinking' ? lastThinking.content : undefined} />
        {tools.length > 0 && <ToolsGroup items={tools as ToolItem[]} />}
        <RunningStatus cellId={cellId} outputs={outputs} source={source} />
        <div className="output-cell">
          <StreamingText cellId={cellId} lastTextContent={lastText?.type === 'text' ? lastText.content : undefined} />
        </div>
      </div>
    );
  }

  // ── Completed branch: collapsed groups + content ──
  const { thinking, tools, content } = buildTimelineItems(outputs);

  // InteractiveOptions rendered outside ToolsGroup
  const interactiveItems = tools.filter((t) => isAskUserQuestion(t as ToolItem)) as ToolItem[];

  return (
    <div className="cell-output-area">
      {(thinking.length > 0 || tools.length > 0) && (
        <div className="tl-groups">
          {thinking.length > 0 && <ThinkingGroup items={thinking as ThinkingItem[]} />}
          {tools.length > 0 && <ToolsGroup items={tools as ToolItem[]} />}
        </div>
      )}
      {interactiveItems.map((item) => (
        <InteractiveOptionsWrapper key={item.tool_use_id} item={item} cellId={cellId} />
      ))}
      {content.length > 0 && (
        <div className="output-cell">
          <TimelineOutputs outputs={content} />
        </div>
      )}
    </div>
  );
}
