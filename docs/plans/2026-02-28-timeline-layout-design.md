# Unified Timeline Layout Design

**Date**: 2026-02-28
**Status**: Approved

## Problem

1. Thinking and Tools blocks overlap when they exceed the `cell-timeline-window` max-height
2. Tool execution spinners persist after tool completes (residue bug)
3. Thinking and Tools are currently rendered in separate visual sections

## Approved Design

### Layout Structure

```
┌─ cell-output-area ──────────────────────────┐
│ ┌─ timeline-frame (max 200px, scroll) ────┐ │
│ │ ┃ thinking-block (warm yellow)          ┃ │
│ │ ┃ tool-block (gray)                  ✓  ┃ │
│ │ ┃ thinking-block (warm yellow)          ┃ │
│ │ ┃ tool-block (gray)                  ⟳  ┃ │
│ │ ┃ streaming-thinking (warm yellow, pulse)┃ │
│ └─────────────────────────────────────────┘ │
│ ⟳ Running… (12s · ↑2k · ↓1k · 3 tools)    │
│ ┌─ output-cell (white bg, border, rounded)┐ │
│ │ Model output markdown                    │ │
│ │ (streaming/completed, no height limit)   │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Key Decisions

1. **Unified timeline**: Thinking and Tools are interleaved chronologically in a single scrollable container
2. **Color-coded blocks**: Thinking = `#fefce8` (warm yellow), Tools = `#f5f5f4` (gray)
3. **Timeline-frame**: `max-height: 200px`, `overflow-y: auto`, auto-scroll during streaming
4. **Output-cell**: White background + border container for model text output, no height limit
5. **Tool status indicators**: Pending = pulsing left border + spinner, Completed = ✓/✗ icon
6. **Streaming and completed states** use the same layout structure

### Data Flow

Timeline items are built from `cell.outputs[]` array which already contains items in chronological order:
- `type: 'thinking'` → thinking-block
- `type: 'tool_use'` → tool-block
- `type: 'text'` → output-cell (rendered below timeline)
- `type: 'error'` → output-cell

During streaming, buffer content (thinking/text) appends to the timeline/output via StreamingThinking/StreamingText components.

### Bug Fixes

- **Tool spinner residue**: Ensure tool_result updates trigger re-render; use `result !== undefined` check consistently
- **Overflow**: Replace fixed max-height approach with proper scrollable container

### CSS Classes

- `.tl-frame` — timeline container (replaces `.cell-timeline-window`)
- `.tl-block` — base block styling
- `.tl-block--thinking` — warm yellow variant
- `.tl-block--tool` — gray variant
- `.tl-block--pending` — pulsing left border
- `.tl-status` — RunningStatus bar
- `.output-cell` — model text output container
