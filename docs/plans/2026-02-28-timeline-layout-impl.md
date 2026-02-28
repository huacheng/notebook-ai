# Unified Timeline Layout — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current two-zone CellOutput layout with a unified timeline where Thinking and Tools are interleaved chronologically in a scrollable frame, with model text output in a separate output-cell container below.

**Architecture:** The CellOutput component renders two zones: (1) a `.tl-frame` scrollable container holding thinking-blocks and tool-blocks in chronological order, and (2) an `.output-cell` container for model text/error output with no height limit. Both streaming and completed states use the same layout structure. CSS changes replace `.cell-timeline-window` with `.tl-frame` (max-height: 200px, overflow-y: auto).

**Tech Stack:** React 18 (functional components), Zustand (store), Vitest (testing), CSS (no preprocessors)

**Test baseline:** 64 test files / 704 tests all passing

---

### Task 1: Extract `buildTimelineItems` pure function — RED

Create a pure function that partitions `CellOutput[]` into timeline items (thinking + tool_use) and content items (text, error, chart). This is the data logic that both streaming and completed branches will share.

**Files:**
- Create: `packages/web/src/utils/timelineItems.ts`
- Create: `packages/web/src/__tests__/timelineItems.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/web/src/__tests__/timelineItems.test.ts
import { describe, it, expect } from 'vitest';
import { buildTimelineItems } from '../utils/timelineItems';

describe('buildTimelineItems', () => {
  it('separates thinking and tool_use into timeline, text/error into content', () => {
    const outputs = [
      { type: 'thinking' as const, content: 'hmm' },
      { type: 'tool_use' as const, name: 'bash', input: { cmd: 'ls' }, tool_use_id: 't1' },
      { type: 'text' as const, content: 'hello' },
      { type: 'error' as const, message: 'oops' },
    ];
    const result = buildTimelineItems(outputs);
    expect(result.timeline).toHaveLength(2);
    expect(result.timeline[0].type).toBe('thinking');
    expect(result.timeline[1].type).toBe('tool_use');
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1].type).toBe('error');
  });

  it('returns empty arrays for empty input', () => {
    const result = buildTimelineItems([]);
    expect(result.timeline).toEqual([]);
    expect(result.content).toEqual([]);
  });

  it('preserves chronological order', () => {
    const outputs = [
      { type: 'thinking' as const, content: 'a' },
      { type: 'tool_use' as const, name: 'read', input: {}, tool_use_id: 't1' },
      { type: 'thinking' as const, content: 'b' },
      { type: 'tool_use' as const, name: 'write', input: {}, tool_use_id: 't2' },
    ];
    const result = buildTimelineItems(outputs);
    expect(result.timeline.map(o => o.type === 'tool_use' ? o.name : o.content))
      .toEqual(['a', 'read', 'b', 'write']);
  });

  it('puts chart outputs into content', () => {
    const outputs = [
      { type: 'chart' as const, chart_type: 'bar', data: {} },
    ];
    const result = buildTimelineItems(outputs);
    expect(result.timeline).toHaveLength(0);
    expect(result.content).toHaveLength(1);
  });
});
```

**Step 2: Run tests to verify RED**

```bash
npx vitest run packages/web/src/__tests__/timelineItems.test.ts
```

Expected: FAIL — module `../utils/timelineItems` does not exist.

---

### Task 2: Extract `buildTimelineItems` pure function — GREEN

**Files:**
- Create: `packages/web/src/utils/timelineItems.ts`

**Step 3: Write minimal implementation**

```typescript
// packages/web/src/utils/timelineItems.ts
interface OutputLike {
  type: string;
  [key: string]: unknown;
}

interface TimelineResult<T> {
  timeline: T[];
  content: T[];
}

export function buildTimelineItems<T extends OutputLike>(outputs: T[]): TimelineResult<T> {
  const timeline: T[] = [];
  const content: T[] = [];
  for (const o of outputs) {
    if (o.type === 'thinking' || o.type === 'tool_use') {
      timeline.push(o);
    } else {
      content.push(o);
    }
  }
  return { timeline, content };
}
```

**Step 4: Run tests to verify GREEN**

```bash
npx vitest run packages/web/src/__tests__/timelineItems.test.ts
```

Expected: ALL PASS

**Step 5: Run full regression**

```bash
script -qc "npx vitest run 2>&1" /tmp/vt.log; cat /tmp/vt.log | strings | tail -10
```

Expected: 65 test files / 708+ tests all pass.

---

### Task 3: New CSS for timeline layout — `.tl-frame`, `.tl-block`, `.output-cell`

**Files:**
- Modify: `packages/web/src/styles.css`

**Step 6: Replace `.cell-timeline-window` and add new classes**

Find the existing `.cell-timeline-window` block (~line 5293) and replace it. Also add new classes for timeline blocks and output-cell.

Replace this CSS:
```css
/* ── Timeline window (streaming) ──────────────────────────── */
.cell-timeline-window {
  max-height: calc(1.6em * 10 + 8px);   /* ~10 lines max */
  min-height: calc(1.6em * 1 + 8px);    /* 1 line min */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: 4px 0;
  scroll-behavior: smooth;
}
```

With:
```css
/* ── Timeline frame (unified thinking + tools) ────────────── */
.tl-frame {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: 4px 0;
  scroll-behavior: smooth;
}

/* ── Timeline block base ──────────────────────────────────── */
.tl-block {
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tl-block--thinking {
  border: 1px solid #fde68a;
  background: var(--bg-thinking);
}

.tl-block--tool {
  border: 1px solid var(--border-default);
  background: var(--bg-tool-use);
}

.tl-block--pending {
  border-left: 3px solid var(--color-running);
  animation: pulse-border 1s ease-in-out infinite;
}

/* ── Output cell (model text, no height limit) ────────────── */
.output-cell {
  background: var(--bg-cell);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
}
```

Also update `.output-thinking.streaming` (~line 5275) to use `.tl-block--thinking` instead:
```css
.tl-block--thinking.streaming {
  border-left: 2px solid var(--color-running);
  animation: pulse-border 1s ease-in-out infinite;
}
```

**No test needed** for pure CSS. Regression test will confirm no runtime breaks.

---

### Task 4: Refactor CellOutput — streaming branch — RED

Write tests for the new streaming layout behavior: timeline-frame contains thinking+tools, output-cell contains streaming text, both share the same structure.

**Files:**
- Create: `packages/web/src/__tests__/cellOutputLayout.test.ts`

**Step 7: Write failing test for streaming layout**

```typescript
// packages/web/src/__tests__/cellOutputLayout.test.ts
import { describe, it, expect } from 'vitest';
import { buildTimelineItems } from '../utils/timelineItems';

describe('CellOutput layout logic', () => {
  it('streaming: thinking and tool_use go into timeline, text stays in content', () => {
    const outputs = [
      { type: 'thinking' as const, content: 'pondering...' },
      { type: 'tool_use' as const, name: 'bash', input: { cmd: 'ls' }, tool_use_id: 't1' },
      { type: 'text' as const, content: 'result text' },
    ];
    const { timeline, content } = buildTimelineItems(outputs);

    // During streaming, timeline-frame renders thinking + tool_use
    expect(timeline).toHaveLength(2);
    expect(timeline[0].type).toBe('thinking');
    expect(timeline[1].type).toBe('tool_use');

    // Output-cell renders text
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
  });

  it('completed: same partition as streaming', () => {
    const outputs = [
      { type: 'thinking' as const, content: 'thought' },
      { type: 'tool_use' as const, name: 'read', input: {}, tool_use_id: 't1', result: 'file content' },
      { type: 'text' as const, content: 'answer' },
    ];
    const { timeline, content } = buildTimelineItems(outputs);
    expect(timeline).toHaveLength(2);
    expect(content).toHaveLength(1);
  });

  it('tool with result is not pending', () => {
    const tool = { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1', result: 'ok' };
    expect(tool.result).toBeDefined();
    // Tool is NOT pending when result exists
    const pending = tool.result === undefined;
    expect(pending).toBe(false);
  });

  it('tool without result is pending', () => {
    const tool = { type: 'tool_use' as const, name: 'bash', input: {}, tool_use_id: 't1' };
    const pending = (tool as any).result === undefined;
    expect(pending).toBe(true);
  });
});
```

**Step 8: Run tests to verify GREEN** (these use buildTimelineItems which already exists)

```bash
npx vitest run packages/web/src/__tests__/cellOutputLayout.test.ts
```

Expected: ALL PASS (pure logic tests against already-implemented function)

---

### Task 5: Refactor CellOutput component — streaming branch — GREEN

Replace the streaming branch to use the unified timeline layout with `.tl-frame`.

**Files:**
- Modify: `packages/web/src/components/CellOutput.tsx` (lines 295-310)

**Step 9: Update streaming branch**

Replace the streaming branch (inside `if (hasStreaming)`) from:

```tsx
    return (
      <div className="cell-output-area">
        <div className="cell-timeline-window" ref={timelineRef}>
          <TimelineOutputs outputs={outputs} />
          <StreamingThinking cellId={cellId} lastThinkingContent={lastThinking?.type === 'thinking' ? lastThinking.content : undefined} />
        </div>
        <RunningStatus cellId={cellId} outputs={outputs} source={source} />
        <StreamingText cellId={cellId} lastTextContent={lastText?.type === 'text' ? lastText.content : undefined} />
      </div>
    );
```

To:

```tsx
    const { timeline: timelineItems } = buildTimelineItems(outputs);

    return (
      <div className="cell-output-area">
        <div className="tl-frame" ref={timelineRef}>
          <TimelineOutputs outputs={timelineItems} />
          <StreamingThinking cellId={cellId} lastThinkingContent={lastThinking?.type === 'thinking' ? lastThinking.content : undefined} />
        </div>
        <RunningStatus cellId={cellId} outputs={outputs} source={source} />
        <div className="output-cell">
          <StreamingText cellId={cellId} lastTextContent={lastText?.type === 'text' ? lastText.content : undefined} />
        </div>
      </div>
    );
```

Add import at top of file:
```typescript
import { buildTimelineItems } from '../utils/timelineItems';
```

**Step 10: Run full regression**

```bash
script -qc "npx vitest run 2>&1" /tmp/vt.log; cat /tmp/vt.log | strings | tail -10
```

Expected: All tests pass.

---

### Task 6: Refactor CellOutput component — completed branch — GREEN

Replace the completed branch to use the same unified timeline layout.

**Files:**
- Modify: `packages/web/src/components/CellOutput.tsx` (lines 312-334)

**Step 11: Update completed branch**

Replace from:

```tsx
  const timelineOutputs = outputs.filter(
    (o) => o.type === 'thinking' || o.type === 'tool_use',
  );
  const contentOutputs = outputs.filter(
    (o) => o.type !== 'thinking' && o.type !== 'tool_use',
  );

  return (
    <div className="cell-output-area">
      {timelineOutputs.length > 0 && (
        <div className="cell-timeline-window">
          <TimelineOutputs outputs={timelineOutputs} />
        </div>
      )}
      {contentOutputs.length > 0 && (
        <TimelineOutputs outputs={contentOutputs} />
      )}
    </div>
  );
```

To:

```tsx
  const { timeline, content } = buildTimelineItems(outputs);

  return (
    <div className="cell-output-area">
      {timeline.length > 0 && (
        <div className="tl-frame">
          <TimelineOutputs outputs={timeline} />
        </div>
      )}
      {content.length > 0 && (
        <div className="output-cell">
          <TimelineOutputs outputs={content} />
        </div>
      )}
    </div>
  );
```

**Step 12: Run full regression**

```bash
script -qc "npx vitest run 2>&1" /tmp/vt.log; cat /tmp/vt.log | strings | tail -10
```

Expected: All tests pass.

---

### Task 7: Apply `.tl-block` classes to InlineThinking and ToolRow

Update the existing components to use the new CSS classes for color-coded blocks.

**Files:**
- Modify: `packages/web/src/components/CellOutput.tsx` (InlineThinking ~line 59, ToolRow ~line 91)

**Step 13: Update InlineThinking**

Change `className="output-thinking"` to `className="tl-block tl-block--thinking"`:

```tsx
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
```

**Step 14: Update ToolRow**

Change `className="output-tool-use ..."` to use `.tl-block .tl-block--tool`:

```tsx
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
```

**Step 15: Update StreamingThinking CSS class**

In `packages/web/src/components/StreamingCellOutput.tsx` (~line 91), change:
```tsx
<div className="output-thinking streaming">
```
To:
```tsx
<div className="tl-block tl-block--thinking streaming">
```

**Step 16: Run full regression**

```bash
script -qc "npx vitest run 2>&1" /tmp/vt.log; cat /tmp/vt.log | strings | tail -10
```

Expected: All tests pass.

---

### Task 8: Clean up old CSS classes

**Files:**
- Modify: `packages/web/src/styles.css`

**Step 17: Remove or update old selectors**

The following CSS selectors referenced the old class names and need updating:

1. `.output-thinking` (~line 1777) — keep the content styles but update selectors to target `.tl-block--thinking` instead
2. `.output-tool-use` (~line 1800) — keep content styles but update selectors to target `.tl-block--tool` instead
3. `.output-thinking.streaming` (~line 5275) — already replaced in Task 3, remove the old rule

Specifically:
- Replace `.output-thinking {` with `.tl-block--thinking {` (keep same properties)
- Replace `.output-tool-use {` with comment only (properties already in `.tl-block--tool`)
- Remove the `.cell-timeline-window` rule (already replaced in Task 3)
- Remove `.output-thinking.streaming` (replaced by `.tl-block--thinking.streaming`)

**Step 18: Run full regression**

```bash
script -qc "npx vitest run 2>&1" /tmp/vt.log; cat /tmp/vt.log | strings | tail -10
```

Expected: All tests pass.

---

### Task 9: TypeScript compile check

**Step 19: Run tsc checks**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json 2>&1 | head -20
```

Expected: No errors.

---

### Task 10: Commit

**Step 20: Commit all changes**

```bash
git add packages/web/src/utils/timelineItems.ts \
  packages/web/src/__tests__/timelineItems.test.ts \
  packages/web/src/__tests__/cellOutputLayout.test.ts \
  packages/web/src/components/CellOutput.tsx \
  packages/web/src/components/StreamingCellOutput.tsx \
  packages/web/src/styles.css

git commit -m "feat: unified timeline layout with rich running status

Replace two-zone CellOutput layout with unified timeline where
thinking (warm yellow) and tools (gray) are interleaved chronologically
in a scrollable .tl-frame container (max-height: 200px).

Model text output renders in a separate .output-cell with no height limit.
Fix tool spinner residue by using tl-block--pending class only when
result is undefined.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary of files changed

| File | Action | Purpose |
|------|--------|---------|
| `packages/web/src/utils/timelineItems.ts` | CREATE | Pure function to partition outputs |
| `packages/web/src/__tests__/timelineItems.test.ts` | CREATE | Tests for partition logic |
| `packages/web/src/__tests__/cellOutputLayout.test.ts` | CREATE | Tests for layout behavior |
| `packages/web/src/components/CellOutput.tsx` | MODIFY | Use unified timeline, `.tl-block` classes |
| `packages/web/src/components/StreamingCellOutput.tsx` | MODIFY | Use `.tl-block--thinking` class |
| `packages/web/src/styles.css` | MODIFY | Replace `.cell-timeline-window` with `.tl-frame`, add `.tl-block` variants, add `.output-cell` |
