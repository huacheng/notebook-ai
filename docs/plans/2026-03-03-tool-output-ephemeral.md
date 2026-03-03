# Tool Output Ephemeral Storage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tool call outputs (tool_use/tool_result) should not be persisted to `*.notebook.json`, only pushed to active clients for real-time rendering. Exception: `AskUserQuestion` tool calls must still be persisted (user choice needs to survive reload).

**Architecture:** Modify `session.ts` to conditionally call `appendCellOutput`/`attachToolResult` based on tool name. Non-AskUserQuestion tools are broadcast-only (ephemeral). Client rendering unchanged.

**Tech Stack:** TypeScript, Node.js, Vitest

---

## Current Behavior Analysis

```
session.ts processEvent():
  tool_use block → appendCellOutput() + broadcast()  → saved + pushed
  tool_result    → attachToolResult() + broadcast()  → saved + pushed
```

## Target Behavior

```
session.ts processEvent():
  tool_use block:
    if name === 'AskUserQuestion' → appendCellOutput() + broadcast()  → saved + pushed
    else                          → broadcast() only                   → pushed only

  tool_result:
    if matches AskUserQuestion    → attachToolResult() + broadcast()  → saved + pushed
    else                          → broadcast() only                   → pushed only
```

---

## Task 1: Add Red Tests for Ephemeral Tool Output

**Files:**
- Create: `packages/server/src/__tests__/toolOutputEphemeral.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Tool output ephemeral storage (P1)', () => {
  describe('tool_use persistence', () => {
    it('should NOT save regular tool_use to notebook', async () => {
      // Setup: mock session with notebook
      // Action: process tool_use event with name = 'Read'
      // Assert: notebook.cells[0].outputs does NOT contain tool_use
    });

    it('should SAVE AskUserQuestion tool_use to notebook', async () => {
      // Setup: mock session with notebook
      // Action: process tool_use event with name = 'AskUserQuestion'
      // Assert: notebook.cells[0].outputs contains the tool_use
    });

    it('should broadcast all tool_use to clients regardless of persistence', async () => {
      // Assert: broadcast called for both regular and AskUserQuestion
    });
  });

  describe('tool_result persistence', () => {
    it('should NOT save regular tool_result to notebook', async () => {
      // When corresponding tool_use was not persisted
    });

    it('should SAVE AskUserQuestion tool_result to notebook', async () => {
      // When corresponding tool_use was AskUserQuestion (persisted)
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/server/src/__tests__/toolOutputEphemeral.test.ts
```

Expected: FAIL (functionality not implemented)

---

## Task 2: Implement Ephemeral Tool Output Logic

**Files:**
- Modify: `packages/server/src/session.ts:679-690` (tool_use handling)
- Modify: `packages/server/src/session.ts:774-798` (tool_result handling)

**Step 1: Modify tool_use handling**

Find the tool_use block processing (around line 679):

```typescript
// BEFORE:
} else if (block.type === 'tool_use') {
  output = {
    type: 'tool_use',
    tool_use_id: block.id,
    name: block.name,
    input: block.input,
    timestamp: new Date().toISOString(),
  };
}

if (output) {
  session.notebook = appendCellOutput(session.notebook, cellId, output);
  this.broadcast(session, { type: 'cell_output', cell_id: cellId, output });
}
```

```typescript
// AFTER:
} else if (block.type === 'tool_use') {
  output = {
    type: 'tool_use',
    tool_use_id: block.id,
    name: block.name,
    input: block.input,
    timestamp: new Date().toISOString(),
  };
}

if (output) {
  // D1: Only persist AskUserQuestion tool calls (user choices must survive reload)
  const shouldPersist = output.type === 'tool_use' && output.name === 'AskUserQuestion';
  if (shouldPersist || output.type !== 'tool_use') {
    session.notebook = appendCellOutput(session.notebook, cellId, output);
  }
  this.broadcast(session, { type: 'cell_output', cell_id: cellId, output });
}
```

**Step 2: Modify tool_result handling**

For tool_result, we need to track which tool_use_ids were persisted. Add a Set to track persisted tool_use_ids:

```typescript
// Add to Session class (or manage per-session):
private _persistedToolUseIds = new Set<string>();
```

Then modify tool_use handling to track:
```typescript
if (shouldPersist) {
  session.notebook = appendCellOutput(session.notebook, cellId, output);
  this._persistedToolUseIds.add(output.tool_use_id);
}
```

And modify tool_result handling:
```typescript
// BEFORE:
session.notebook = attachToolResult(session.notebook, cellId, block.tool_use_id, content, isError);

// AFTER:
// D1: Only persist if corresponding tool_use was persisted (AskUserQuestion)
if (this._persistedToolUseIds.has(block.tool_use_id)) {
  session.notebook = attachToolResult(session.notebook, cellId, block.tool_use_id, content, isError);
  this._persistedToolUseIds.delete(block.tool_use_id); // cleanup
}
```

**Step 3: Run tests to verify they pass**

```bash
npx vitest run packages/server/src/__tests__/toolOutputEphemeral.test.ts
```

Expected: PASS

---

## Task 3: Add Regression Tests

**Files:**
- Modify: `packages/server/src/__tests__/toolOutputEphemeral.test.ts`

**Step 1: Add regression tests for existing behavior**

```typescript
describe('Regression: Client receives all tool outputs', () => {
  it('broadcasts tool_use for Read tool', async () => {
    // Verify WS push still works
  });

  it('broadcasts tool_use for AskUserQuestion tool', async () => {
    // Verify WS push still works
  });

  it('broadcasts tool_result for all tools', async () => {
    // Verify WS push still works
  });
});

describe('Regression: Notebook file integrity', () => {
  it('AskUserQuestion outputs survive notebook reload', async () => {
    // Save notebook, reload, verify AskUserQuestion still present
  });

  it('Regular tool outputs do NOT appear in saved notebook', async () => {
    // Save notebook, verify no Read/Write/etc tool_use in file
  });
});
```

**Step 2: Run full test suite**

```bash
npx vitest run
```

---

## Task 4: Update Export and Slice Generator (if needed)

**Files:**
- Review: `packages/server/src/export.ts`
- Review: `packages/server/src/slice-generator.ts`

**Step 1: Verify export excludes non-persisted tools**

Since tool_use outputs won't be in the notebook, export should naturally exclude them. Verify no changes needed.

**Step 2: Verify slice generator handles missing tool outputs**

Slice generator might reference tool outputs. Ensure it gracefully handles their absence.

---

## Task 5: Frontend Verification

**Files:**
- No changes expected, but verify:
  - `packages/web/src/store/wsSlice.ts` - cell_output handling
  - `packages/web/src/components/CellOutput.tsx` - tool_use rendering

**Step 1: Manual verification**

1. Start dev server
2. Execute a prompt that triggers tool calls
3. Verify tool calls render in UI
4. Reload page, verify only AskUserQuestion persists

---

## Summary

| Task | Type | Files |
|------|------|-------|
| 1 | TDD Red | Create test file |
| 2 | TDD Green | Modify session.ts |
| 3 | Regression | Extend test file |
| 4 | Review | export.ts, slice-generator.ts |
| 5 | Verify | Frontend (no changes expected) |

**Risk Assessment:**
- Low: Client rendering unchanged (WS push still works)
- Low: AskUserQuestion still persisted (user choices preserved)
- Medium: findCellByToolUseId may fail for non-persisted tools (mitigated by not calling attachToolResult)

**Rollback:** Revert session.ts changes to restore full persistence.
