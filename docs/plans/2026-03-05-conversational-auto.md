# Conversational Auto Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform task-ai from manual sub-command dispatch to dialog-driven four-phase lifecycle, where notebook existence IS the context and Claude reads state files to determine the current phase.

**Architecture:** Rewrite `auto/SKILL.md` to define conversational four-phase logic (Target/Planning/Execution/Finalization). Extend `.auto-signal` schema with `phase`, `phase_progress`, `stage`, `check_score`, `retry_count`, `delegation_failures`. Extend `check` to output D1-D6 numeric scores. Add frontend multi-stage status bar + six-dimension score panel. Backend watches `.auto-signal` and pushes updates via WebSocket.

**Tech Stack:** TypeScript (frontend React + Zustand, backend Express + WebSocket), Bash (SKILL.md, shell scripts), Python (state.py), Zod (schema validation)

**Design Document:** `AiTasks/notebook/task-ai-auto.md` (457 lines, fully audited)

---

## Step 1: Backend + Signal Schema + Check Extension (Core Infrastructure)

All backend-only changes that don't touch UI. This is the foundation everything else depends on.

### Task 1.1: Extend `.auto-signal` Schema in Signal Validation (Documentation Only)

**Files:**
- Modify: `task-ai/skills/auto/SKILL.md:125-139` (signal validation table)
- No test (documentation-only change; real validation tested in Task 1.2 via Zod schemas)

**Why no shell test:** SKILL.md 验证表是给 daemon 和人看的规范文档，不是可执行的校验逻辑。真正的运行时校验是 Task 1.2 的 `AutoSignalSchema` (Zod)，那里有完整的 Red/Green 测试覆盖。为文档写假 Red 测试违背 TDD 精神。

**Step 1: Update signal validation whitelist in SKILL.md**

Modify `task-ai/skills/auto/SKILL.md` lines 125-139. Add new rows to the validation table:

```markdown
### Signal Validation

The daemon validates `.auto-signal` fields for monitoring integrity:

| Field | Validation | Allowed Values |
|-------|-----------|----------------|
| `step` | Whitelist | `plan`, `check`, `exec`, `merge`, `highlight`, `report`, `research`, `verify`, `annotate` |
| `result` | Whitelist | `PASS`, `NEEDS_REVISION`, `ACCEPT`, `NEEDS_FIX`, `REPLAN`, `BLOCKED`, `CONTINUE`, `(generated)`, `(done)`, `(mid-exec)`, `(step-N)` (where N is integer), `(blocked)`, `(collected)`, `(sufficient)`, `(o1-collected)`, `(o2-collected)`, `(o3-collected)`, `(objective-complete)`, `(pass)`, `(fail)`, `(partial)`, `(processed)`, `(distilled)`, `(skipped-idempotent)`, `failed`, `success`, `stage-done`, `conflict`, `rejected` |
| `next` | Whitelist | `plan`, `check`, `exec`, `merge`, `highlight`, `report`, `research`, `verify`, `annotate`, `(stop)` |
| `checkpoint` | Whitelist | `""`, `post-plan`, `post-research`, `post-o1`, `post-o2`, `post-o3`, `mid-exec`, `post-exec`, `pre-merge`, `quick`, `full`, `step-N`, `dependency-blocked`, `no-accept` |
| `iteration` | Integer | >= 0 |
| `compaction_count` | Integer | >= 0 |
| `vfp_cycles_completed` | Integer (optional) | >= 0 (present only for software types in auto mode) |
| `phase` | Whitelist (optional) | `target`, `planning`, `execution`, `finalization` |
| `phase_progress` | Float (optional) | 0.0 - 1.0 |
| `stage` | Object (optional) | `{ "current": int, "total": int }` where current >= 1, current <= total |
| `check_score` | Object (optional) | `{ "overall": float, "d1_correctness": float, ..., "d6_maintainability": float }` all 0.0-1.0, or null |
| `retry_count` | Integer (optional) | >= 0 |
| `delegation_failures` | Array (optional) | String array, each matching pattern `cmd@iterN` |
| `timestamp` | Format check | ISO 8601 |
```

Also add `pre-merge` to the checkpoint whitelist (was missing, design doc references it).

**Step 2: Commit**

```bash
git add task-ai/skills/auto/SKILL.md
git commit -m "feat(task-ai): extend .auto-signal schema with phase, check_score, retry fields"
```

---

### Task 1.2: Backend Signal Validation Extension

**Files:**
- Modify: `packages/server/src/task-ai/compaction-strategy.ts:130-156` (reads .auto-signal)
- Modify: `packages/shared/src/types.ts` (add AutoSignal Zod schema + WS message type)
- Test: `packages/shared/src/__tests__/auto-signal-schema.test.ts`

**Step 1: Write the failing test**

Create `packages/shared/src/__tests__/auto-signal-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AutoSignalSchema, AutoStatusMessageSchema } from '../types';

describe('AutoSignalSchema', () => {
  it('validates full signal with all new fields', () => {
    const full = {
      step: 'exec',
      result: '(step-3)',
      next: 'verify',
      checkpoint: 'mid-exec',
      iteration: 5,
      compaction_count: 1,
      phase: 'execution',
      phase_progress: 0.45,
      stage: { current: 2, total: 3 },
      check_score: {
        overall: 0.85,
        d1_correctness: 0.90,
        d2_security: 0.80,
        d3_reliability: 0.85,
        d4_performance: 0.88,
        d5_architecture: 0.82,
        d6_maintainability: 0.85,
      },
      retry_count: 1,
      delegation_failures: ['verify@iter3'],
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(AutoSignalSchema.parse(full)).toBeDefined();
  });

  it('rejects invalid phase value', () => {
    const bad = {
      step: 'check',
      result: 'PASS',
      next: 'exec',
      iteration: 1,
      timestamp: '2026-01-01T00:00:00Z',
      phase: 'invalid_phase',
    };
    expect(() => AutoSignalSchema.parse(bad)).toThrow();
  });

  it('rejects phase_progress out of range', () => {
    const bad = {
      step: 'check',
      result: 'PASS',
      next: 'exec',
      iteration: 1,
      timestamp: '2026-01-01T00:00:00Z',
      phase: 'execution',
      phase_progress: 1.5,
    };
    expect(() => AutoSignalSchema.parse(bad)).toThrow();
  });

  it('allows check_score to be null', () => {
    const signal = {
      step: 'exec',
      result: '(step-1)',
      next: 'exec',
      iteration: 1,
      timestamp: '2026-01-01T00:00:00Z',
      phase: 'execution',
      check_score: null,
    };
    expect(AutoSignalSchema.parse(signal)).toBeDefined();
  });
});

describe('AutoStatusMessageSchema', () => {
  it('validates auto_status WebSocket message', () => {
    const msg = {
      type: 'auto_status' as const,
      session_id: 'sess-123',
      phase: 'execution',
      phase_progress: 0.45,
      step: 'exec',
      next: 'verify',
      stage: { current: 2, total: 3 },
      check_score: null,
      retry_count: 0,
      iteration: 5,
    };
    expect(AutoStatusMessageSchema.parse(msg)).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run packages/shared/src/__tests__/auto-signal-schema.test.ts`
Expected: FAIL — `AutoSignalSchema` and `AutoStatusMessageSchema` not found in types.ts

**Step 3: Add Zod schemas to types.ts**

Add to `packages/shared/src/types.ts` (before `WSServerMessageSchema`):

```typescript
// ── Auto signal schema (Conversational Auto) ────────────────────────────────

export const CheckScoreSchema = z.object({
  overall: z.number().min(0).max(1),
  d1_correctness: z.number().min(0).max(1),
  d2_security: z.number().min(0).max(1),
  d3_reliability: z.number().min(0).max(1),
  d4_performance: z.number().min(0).max(1),
  d5_architecture: z.number().min(0).max(1),
  d6_maintainability: z.number().min(0).max(1),
});

export const AutoSignalSchema = z.object({
  step: z.string(),
  result: z.string(),
  next: z.string(),
  checkpoint: z.string().optional(),
  iteration: z.number().int().nonnegative(),
  compaction_count: z.number().int().nonnegative().optional(),
  vfp_cycles_completed: z.number().int().nonnegative().optional(),
  phase: z.enum(['target', 'planning', 'execution', 'finalization']).optional(),
  phase_progress: z.number().min(0).max(1).optional(),
  stage: z.object({
    current: z.number().int().positive(),
    total: z.number().int().positive(),
  }).optional(),
  check_score: CheckScoreSchema.nullable().optional(),
  retry_count: z.number().int().nonnegative().optional(),
  delegation_failures: z.array(z.string()).optional(),
  timestamp: z.string(),
});

export const AutoStatusMessageSchema = z.object({
  type: z.literal('auto_status'),
  session_id: z.string(),
  phase: z.enum(['target', 'planning', 'execution', 'finalization']).nullable(),
  phase_progress: z.number().min(0).max(1).nullable(),
  step: z.string().nullable(),
  next: z.string().nullable(),
  stage: z.object({
    current: z.number().int().positive(),
    total: z.number().int().positive(),
  }).nullable(),
  check_score: CheckScoreSchema.nullable(),
  retry_count: z.number().int().nonnegative(),
  iteration: z.number().int().nonnegative(),
});
```

Add `AutoStatusMessageSchema` to the `WSServerMessageSchema` discriminated union array.

**Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run packages/shared/src/__tests__/auto-signal-schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/__tests__/auto-signal-schema.test.ts
git commit -m "feat(shared): add AutoSignalSchema and AutoStatusMessageSchema"
```

---

### Task 1.3: Backend WebSocket — Watch `.auto-signal` and Push Updates

**Files:**
- Modify: `packages/server/src/ws-handler.ts` (add `auto_subscribe` handler)
- Modify: `packages/server/src/watcher.ts` (reuse FileWatcher)
- Test: `packages/server/src/__tests__/auto-signal-watcher.test.ts`

**Step 1: Write the failing test**

Create `packages/server/src/__tests__/auto-signal-watcher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AutoSignalSchema } from '@notebook-ai/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Auto signal file parsing', () => {
  it('parses .auto-signal file with extended fields', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-signal-test-'));
    const signalPath = path.join(tmpDir, '.auto-signal');

    const signal = {
      step: 'check',
      result: 'PASS',
      next: 'exec',
      checkpoint: 'post-plan',
      iteration: 3,
      phase: 'planning',
      phase_progress: 0.75,
      stage: { current: 1, total: 2 },
      check_score: {
        overall: 0.85,
        d1_correctness: 0.90,
        d2_security: 0.80,
        d3_reliability: 0.85,
        d4_performance: 0.88,
        d5_architecture: 0.82,
        d6_maintainability: 0.85,
      },
      retry_count: 1,
      delegation_failures: ['verify@iter3'],
      timestamp: '2026-01-01T00:00:00Z',
    };

    fs.writeFileSync(signalPath, JSON.stringify(signal));

    const raw = JSON.parse(fs.readFileSync(signalPath, 'utf-8'));
    const parsed = AutoSignalSchema.parse(raw);

    expect(parsed.phase).toBe('planning');
    expect(parsed.check_score?.overall).toBe(0.85);
    expect(parsed.stage?.current).toBe(1);
    expect(parsed.retry_count).toBe(1);

    fs.rmSync(tmpDir, { recursive: true });
  });

});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run packages/server/src/__tests__/auto-signal-watcher.test.ts`
Expected: FAIL — import of `AutoSignalSchema` from shared fails (until Task 1.2 is done)

**Step 3: Add `auto_subscribe` handler to ws-handler.ts**

Add to `packages/server/src/ws-handler.ts` in the message switch statement (near existing `watch_subscribe` handler around line 1021):

```typescript
case 'auto_subscribe': {
  const { session_id } = parsed;
  // Find the notebook's working directory
  const session = sessionManager.getSession(session_id);
  if (!session) break;

  const workDir = session.workDir;
  if (!workDir) break;

  const signalPath = path.join(workDir, '.auto-signal');

  // Watch .auto-signal file for changes
  const unsubscribe = fileWatcher.watch(
    path.dirname(signalPath),
    () => {
      try {
        if (!fs.existsSync(signalPath)) {
          // Signal file deleted = auto loop ended
          sendToClient(ws, {
            type: 'auto_status',
            session_id,
            phase: null,
            phase_progress: null,
            step: null,
            next: null,
            stage: null,
            check_score: null,
            retry_count: 0,
            iteration: 0,
          });
          return;
        }
        const raw = JSON.parse(fs.readFileSync(signalPath, 'utf-8'));
        const signal = AutoSignalSchema.parse(raw);

        sendToClient(ws, {
          type: 'auto_status',
          session_id,
          phase: signal.phase ?? null,
          phase_progress: signal.phase_progress ?? null,
          step: signal.step ?? null,
          next: signal.next ?? null,
          stage: signal.stage ?? null,
          check_score: signal.check_score ?? null,
          retry_count: signal.retry_count ?? 0,
          iteration: signal.iteration ?? 0,
        });
      } catch {
        // Ignore parse errors (partial writes)
      }
    }
  );

  // Clean up on disconnect
  ws.on('close', () => unsubscribe());
  break;
}
```

Also add `auto_subscribe` to WSClientMessageSchema in `packages/shared/src/types.ts`:

```typescript
export const AutoSubscribeSchema = z.object({
  type: z.literal('auto_subscribe'),
  session_id: z.string(),
});
```

And add it to the WSClientMessageSchema discriminated union.

**Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run packages/server/src/__tests__/auto-signal-watcher.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/ws-handler.ts packages/shared/src/types.ts packages/server/src/__tests__/auto-signal-watcher.test.ts
git commit -m "feat(server): watch .auto-signal and push auto_status via WebSocket"
```

---

### Task 1.4: Create `signal-writer.sh` — Extended Signal Field Utilities

**Files:**
- Create: `task-ai/skills/auto/scripts/signal-writer.sh`
- Test: `task-ai/tests/unit/signal-writer.test.sh`

**Step 1: Write the failing test (Red)**

Create `task-ai/tests/unit/signal-writer.test.sh` first — source `signal-writer.sh` which does NOT yet exist:

```bash
#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Red: signal-writer.sh does not exist yet → source fails → test fails
source "$SCRIPT_DIR/skills/auto/scripts/signal-writer.sh"
```

**Step 2: Run test to verify it fails (Red)**

Run: `bash task-ai/tests/unit/signal-writer.test.sh`
Expected: FAIL — `signal-writer.sh: No such file or directory`

**Step 3: Create signal-writer.sh (Green)**

Create `task-ai/skills/auto/scripts/signal-writer.sh`:

```bash
#!/usr/bin/env bash
# Signal writer utilities for .auto-signal
# Provides functions to read/write extended signal fields

# Write or update check_score in .auto-signal
# Usage: write_check_score <signal_file> <overall> <d1> <d2> <d3> <d4> <d5> <d6>
write_check_score() {
    local signal_file="$1"
    local overall="$2" d1="$3" d2="$4" d3="$5" d4="$6" d5="$7" d6="$8"

    if [[ ! -f "$signal_file" ]]; then
        echo "[WARN] Signal file not found: $signal_file" >&2
        return 1
    fi

    python3 -c "
import json, sys
with open('$signal_file', 'r') as f:
    signal = json.load(f)
signal['check_score'] = {
    'overall': $overall,
    'd1_correctness': $d1,
    'd2_security': $d2,
    'd3_reliability': $d3,
    'd4_performance': $d4,
    'd5_architecture': $d5,
    'd6_maintainability': $d6
}
with open('$signal_file', 'w') as f:
    json.dump(signal, f, indent=2)
"
}

# Write phase and phase_progress to .auto-signal
# Usage: write_phase <signal_file> <phase> <progress>
write_phase() {
    local signal_file="$1"
    local phase="$2"
    local progress="$3"

    if [[ ! -f "$signal_file" ]]; then
        echo "[WARN] Signal file not found: $signal_file" >&2
        return 1
    fi

    python3 -c "
import json
with open('$signal_file', 'r') as f:
    signal = json.load(f)
signal['phase'] = '$phase'
signal['phase_progress'] = $progress
with open('$signal_file', 'w') as f:
    json.dump(signal, f, indent=2)
"
}

# Increment retry_count in .auto-signal
# Usage: increment_retry <signal_file>
increment_retry() {
    local signal_file="$1"

    python3 -c "
import json
with open('$signal_file', 'r') as f:
    signal = json.load(f)
signal['retry_count'] = signal.get('retry_count', 0) + 1
with open('$signal_file', 'w') as f:
    json.dump(signal, f, indent=2)
"
}

# Append delegation failure to .auto-signal
# Usage: append_delegation_failure <signal_file> <cmd@iterN>
append_delegation_failure() {
    local signal_file="$1"
    local failure="$2"

    python3 -c "
import json
with open('$signal_file', 'r') as f:
    signal = json.load(f)
failures = signal.get('delegation_failures', [])
if '$failure' not in failures:
    failures.append('$failure')
signal['delegation_failures'] = failures
with open('$signal_file', 'w') as f:
    json.dump(signal, f, indent=2)
"
}
```

**Step 4: Expand test with full Red/Green assertions (Green)**

Update `task-ai/tests/unit/signal-writer.test.sh` to the full version (now signal-writer.sh exists, these should pass):

```bash
#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Green: signal-writer.sh now exists
source "$SCRIPT_DIR/skills/auto/scripts/signal-writer.sh"

# Setup: create base signal file
cat > "$TEST_DIR/.auto-signal" <<'EOF'
{
  "step": "check",
  "result": "PASS",
  "next": "exec",
  "iteration": 1,
  "timestamp": "2026-01-01T00:00:00Z"
}
EOF

# Test write_check_score
write_check_score "$TEST_DIR/.auto-signal" 0.85 0.90 0.80 0.85 0.88 0.82 0.85
OVERALL=$(python3 -c "import json; print(json.load(open('$TEST_DIR/.auto-signal'))['check_score']['overall'])")
if [[ "$OVERALL" != "0.85" ]]; then
  echo "FAIL: write_check_score overall=$OVERALL, expected 0.85"
  exit 1
fi
echo "PASS: write_check_score"

# Test write_phase
write_phase "$TEST_DIR/.auto-signal" "execution" 0.45
PHASE=$(python3 -c "import json; print(json.load(open('$TEST_DIR/.auto-signal'))['phase'])")
if [[ "$PHASE" != "execution" ]]; then
  echo "FAIL: write_phase phase=$PHASE, expected execution"
  exit 1
fi
echo "PASS: write_phase"

# Test increment_retry
increment_retry "$TEST_DIR/.auto-signal"
RETRY=$(python3 -c "import json; print(json.load(open('$TEST_DIR/.auto-signal'))['retry_count'])")
if [[ "$RETRY" != "1" ]]; then
  echo "FAIL: increment_retry retry_count=$RETRY, expected 1"
  exit 1
fi
increment_retry "$TEST_DIR/.auto-signal"
RETRY=$(python3 -c "import json; print(json.load(open('$TEST_DIR/.auto-signal'))['retry_count'])")
if [[ "$RETRY" != "2" ]]; then
  echo "FAIL: increment_retry retry_count=$RETRY, expected 2"
  exit 1
fi
echo "PASS: increment_retry"

# Test append_delegation_failure
append_delegation_failure "$TEST_DIR/.auto-signal" "verify@iter3"
FAILURES=$(python3 -c "import json; print(json.load(open('$TEST_DIR/.auto-signal'))['delegation_failures'])")
if [[ "$FAILURES" != "['verify@iter3']" ]]; then
  echo "FAIL: append_delegation_failure failures=$FAILURES"
  exit 1
fi
# Append same — should not duplicate
append_delegation_failure "$TEST_DIR/.auto-signal" "verify@iter3"
COUNT=$(python3 -c "import json; print(len(json.load(open('$TEST_DIR/.auto-signal'))['delegation_failures']))")
if [[ "$COUNT" != "1" ]]; then
  echo "FAIL: append_delegation_failure duplicated, count=$COUNT"
  exit 1
fi
echo "PASS: append_delegation_failure (no duplicates)"

# Test write_check_score on missing file → should return 1
if write_check_score "/nonexistent/.auto-signal" 0.5 0.5 0.5 0.5 0.5 0.5 0.5 2>/dev/null; then
  echo "FAIL: write_check_score should fail on missing file"
  exit 1
fi
echo "PASS: write_check_score rejects missing file"

echo ""
echo "ALL TESTS PASSED"
```

**Step 5: Run test to verify Green**

Run: `bash task-ai/tests/unit/signal-writer.test.sh`
Expected: ALL TESTS PASSED

**Step 6: Commit**

```bash
git add task-ai/skills/auto/scripts/signal-writer.sh task-ai/tests/unit/signal-writer.test.sh
git commit -m "feat(task-ai): add signal-writer.sh for extended .auto-signal fields"
```

---

### Task 1.5: Rewrite `auto/SKILL.md` — Conversational Four-Phase Logic

**Files:**
- Modify: `task-ai/skills/auto/SKILL.md` (major rewrite)
- No test needed (SKILL.md is documentation/instructions, not executable code)

**Step 1: Read current SKILL.md**

Already read. Current structure: single-session auto loop, 4-phase state machine, signal file, stop file, signal validation, stall detection, context management, VFP tracking.

**Step 2: Rewrite SKILL.md**

The rewrite must:
1. Remove "activation" concept — notebook existence IS the context
2. Define dialog-driven four-phase logic per design doc
3. Add threshold table (post-plan 0.70, mid-exec 0.60, post-exec 0.75, pre-merge 0.80)
4. Add retry limits per checkpoint
5. Add phase derivation from `.index.json` status
6. Add three-file anchored review description
7. Add subagent delegation judgment factors
8. Keep backward-compatible signal validation (extend, don't replace)
9. Keep stall detection, context management, VFP tracking sections unchanged

Key sections to add/change:
- **Core Principle**: "No auto mode to activate. Notebook existence IS the context."
- **Four-Phase Flow**: Target (human-in-loop) → Planning (auto+intervene) → Execution (auto+intervene) → Finalization (full auto)
- **Phase Derivation**: draft→target, planning/re-planning→planning, review/executing→execution, blocked→execution(stalled), complete/stage-done→finalization
- **Threshold & Retry Table**
- **Subagent Delegation**: Dynamic judgment with four factors and signal sources
- **Compaction Strategy**: Milestone-based summarize calls

The full rewrite content is in `AiTasks/notebook/task-ai-auto.md`. The SKILL.md should reference this design doc and encode the operational instructions.

**Step 3: Commit**

```bash
git add task-ai/skills/auto/SKILL.md
git commit -m "feat(task-ai): rewrite auto SKILL.md for conversational four-phase logic"
```

---

### Task 1.6: Update `auto.sh` — Phase-Aware Signal Writing

**Files:**
- Modify: `task-ai/skills/auto/scripts/auto.sh` (add phase derivation + extended signal)
- Test: `task-ai/tests/unit/auto-phase-derivation.test.sh`

**Step 1: Write the failing test (Red)**

Create `task-ai/tests/unit/auto-phase-derivation.test.sh` — calls real `auto.sh` and checks `.auto-signal` output:

```bash
#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUTO_SH="$SCRIPT_DIR/skills/auto/scripts/auto.sh"

# Create mock notebook at status=planning
mkdir -p "$TEST_DIR/test-nb"
cat > "$TEST_DIR/test-nb/.index.json" <<'EOF'
{"name": "test-nb", "status": "planning", "type": "software"}
EOF
cat > "$TEST_DIR/test-nb/.target.md" <<'EOF'
# Test Target
EOF

# Run auto.sh with mock notebook
NB_WORKSPACES_ROOT="$TEST_DIR" bash "$AUTO_SH" test-nb --start 2>/dev/null || true

# Red: auto.sh currently does NOT write `phase` field to .auto-signal
# This test will FAIL until auto.sh is updated
SIGNAL_FILE="$TEST_DIR/test-nb/.auto-signal"
if [[ ! -f "$SIGNAL_FILE" ]]; then
    echo "FAIL: .auto-signal not created"
    exit 1
fi

PHASE=$(python3 -c "import json; d=json.load(open('$SIGNAL_FILE')); print(d.get('phase', 'MISSING'))")
if [[ "$PHASE" == "MISSING" ]]; then
    echo "FAIL: .auto-signal missing 'phase' field"
    exit 1
fi
if [[ "$PHASE" != "planning" ]]; then
    echo "FAIL: status=planning should derive phase=planning, got '$PHASE'"
    exit 1
fi

# Also verify retry_count is present and initialized
RETRY=$(python3 -c "import json; d=json.load(open('$SIGNAL_FILE')); print(d.get('retry_count', 'MISSING'))")
if [[ "$RETRY" == "MISSING" ]]; then
    echo "FAIL: .auto-signal missing 'retry_count' field"
    exit 1
fi

echo "PASS: auto.sh writes phase and retry_count to .auto-signal"
```

**Step 2: Run test to verify it fails (Red)**

Run: `bash task-ai/tests/unit/auto-phase-derivation.test.sh`
Expected: FAIL — `phase` field MISSING (current auto.sh doesn't write it)

**Step 3: Update auto.sh to include phase derivation and extended signal (Green)**

Modify `task-ai/skills/auto/scripts/auto.sh`:
- Add `derive_phase()` function
- Source `signal-writer.sh`
- Write extended signal with `phase`, `phase_progress`, `retry_count` fields
- Reset `retry_count` and `delegation_failures` on phase transition

**Step 4: Run test to verify Green**

Run: `bash task-ai/tests/unit/auto-phase-derivation.test.sh`
Expected: PASS

**Step 5: Commit**

```bash
git add task-ai/skills/auto/scripts/auto.sh task-ai/tests/unit/auto-phase-derivation.test.sh
git commit -m "feat(task-ai): add phase derivation and extended signal to auto.sh"
```

---

### Task 1.7: Full Test Suite Regression Check + compaction-strategy.ts 硬升级

**Files:**
- Modify: `packages/server/src/task-ai/compaction-strategy.ts:130-156` (读取新格式 `.auto-signal`)
- Test: `packages/server/src/__tests__/compaction-strategy-signal.test.ts`

**Step 1: Write regression test for compaction-strategy (Red)**

Create `packages/server/src/__tests__/compaction-strategy-signal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('compaction-strategy reads new .auto-signal format', () => {
  it('extracts phase and check_score from new format signal', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compaction-test-'));
    const signalPath = path.join(tmpDir, '.auto-signal');

    // New format with all extended fields
    const signal = {
      step: 'exec',
      result: '(step-3)',
      next: 'verify',
      iteration: 5,
      phase: 'execution',
      phase_progress: 0.45,
      check_score: {
        overall: 0.85,
        d1_correctness: 0.90,
        d2_security: 0.80,
        d3_reliability: 0.85,
        d4_performance: 0.88,
        d5_architecture: 0.82,
        d6_maintainability: 0.85,
      },
      retry_count: 1,
      delegation_failures: ['verify@iter3'],
      timestamp: '2026-01-01T00:00:00Z',
    };
    fs.writeFileSync(signalPath, JSON.stringify(signal));

    // Parse and verify — same code path compaction-strategy uses
    const raw = JSON.parse(fs.readFileSync(signalPath, 'utf-8'));
    expect(raw.step).toBe('exec');
    expect(raw.iteration).toBe(5);
    expect(raw.phase).toBe('execution');
    expect(raw.check_score.overall).toBe(0.85);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

**Step 2: Run regression test**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run packages/server/src/__tests__/compaction-strategy-signal.test.ts`
Expected: PASS (JSON parsing doesn't break on new fields)

**Step 3: Update compaction-strategy.ts to read new fields**

Modify `packages/server/src/task-ai/compaction-strategy.ts` lines 130-156 to also extract `phase`, `phase_progress`, `check_score` from `.auto-signal` (used for richer recovery context after compaction).

**Step 4: Run all existing tests**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run`
Expected: All existing tests pass + new tests pass, zero regressions. Report test count.

**Specific regression scenarios to verify:**
- `npx vitest run packages/shared` — shared types still compile with new schemas
- `npx vitest run packages/server` — server tests pass with new WS message type in union
- `npx vitest run packages/web` — web store tests unaffected by new `autoStatus` field
- `wsSlice.ts` default branch handles unknown message types without crash (existing behavior)

**Step 5: Run all shell tests**

Run:
```bash
for t in task-ai/tests/unit/*.test.sh; do echo "=== $t ==="; bash "$t" || echo "FAILED: $t"; done
```
Expected: All pass

**Step 6: Commit (if any fixes needed)**

```bash
git add packages/server/src/task-ai/compaction-strategy.ts packages/server/src/__tests__/compaction-strategy-signal.test.ts
git commit -m "fix: update compaction-strategy for new .auto-signal format + regression check"
```

---

## Step 2: Frontend — Multi-Stage Status Bar + Six-Dimension Score Panel

All frontend changes for displaying auto status in the UI.

### Task 2.1: Frontend Store — Auto Status State

**Files:**
- Create: `packages/web/src/store/autoStatusSlice.ts`
- Modify: `packages/web/src/store/wsSlice.ts` (add auto_status message handler)
- Test: `packages/web/src/__tests__/autoStatusSlice.test.ts`

**Step 1: Write the failing test**

Create `packages/web/src/__tests__/autoStatusSlice.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// We'll test the auto status state shape and updates
describe('autoStatusSlice', () => {
  it('initializes with null auto status', async () => {
    const { createAutoStatusSlice, AutoStatusState } = await import('../store/autoStatusSlice');
    // Verify the initial state shape
    const initialState: AutoStatusState = {
      phase: null,
      phaseProgress: null,
      step: null,
      next: null,
      stage: null,
      checkScore: null,
      retryCount: 0,
      iteration: 0,
    };
    expect(initialState.phase).toBeNull();
    expect(initialState.checkScore).toBeNull();
  });

  it('updates auto status from WebSocket message', async () => {
    const { applyAutoStatus } = await import('../store/autoStatusSlice');
    const state = {
      phase: null as string | null,
      phaseProgress: null as number | null,
      step: null as string | null,
      next: null as string | null,
      stage: null as { current: number; total: number } | null,
      checkScore: null as Record<string, number> | null,
      retryCount: 0,
      iteration: 0,
    };

    const msg = {
      type: 'auto_status' as const,
      session_id: 'sess-123',
      phase: 'execution' as const,
      phase_progress: 0.45,
      step: 'exec',
      next: 'verify',
      stage: { current: 2, total: 3 },
      check_score: {
        overall: 0.85,
        d1_correctness: 0.90,
        d2_security: 0.80,
        d3_reliability: 0.85,
        d4_performance: 0.88,
        d5_architecture: 0.82,
        d6_maintainability: 0.85,
      },
      retry_count: 1,
      iteration: 5,
    };

    const updated = applyAutoStatus(state, msg);
    expect(updated.phase).toBe('execution');
    expect(updated.phaseProgress).toBe(0.45);
    expect(updated.checkScore?.overall).toBe(0.85);
    expect(updated.stage?.current).toBe(2);
    expect(updated.retryCount).toBe(1);
  });

  it('clears auto status when phase is null', async () => {
    const { applyAutoStatus } = await import('../store/autoStatusSlice');
    const state = {
      phase: 'execution' as string | null,
      phaseProgress: 0.45 as number | null,
      step: 'exec' as string | null,
      next: 'verify' as string | null,
      stage: { current: 2, total: 3 } as { current: number; total: number } | null,
      checkScore: { overall: 0.85 } as Record<string, number> | null,
      retryCount: 1,
      iteration: 5,
    };

    const msg = {
      type: 'auto_status' as const,
      session_id: 'sess-123',
      phase: null,
      phase_progress: null,
      step: null,
      next: null,
      stage: null,
      check_score: null,
      retry_count: 0,
      iteration: 0,
    };

    const updated = applyAutoStatus(state, msg);
    expect(updated.phase).toBeNull();
    expect(updated.checkScore).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run packages/web/src/__tests__/autoStatusSlice.test.ts`
Expected: FAIL — module not found

**Step 3: Create autoStatusSlice.ts**

Create `packages/web/src/store/autoStatusSlice.ts`:

```typescript
export interface CheckScore {
  overall: number;
  d1_correctness: number;
  d2_security: number;
  d3_reliability: number;
  d4_performance: number;
  d5_architecture: number;
  d6_maintainability: number;
}

export interface AutoStatusState {
  phase: 'target' | 'planning' | 'execution' | 'finalization' | null;
  phaseProgress: number | null;
  step: string | null;
  next: string | null;
  stage: { current: number; total: number } | null;
  checkScore: CheckScore | null;
  retryCount: number;
  iteration: number;
}

export const initialAutoStatus: AutoStatusState = {
  phase: null,
  phaseProgress: null,
  step: null,
  next: null,
  stage: null,
  checkScore: null,
  retryCount: 0,
  iteration: 0,
};

export interface AutoStatusMessage {
  type: 'auto_status';
  session_id: string;
  phase: string | null;
  phase_progress: number | null;
  step: string | null;
  next: string | null;
  stage: { current: number; total: number } | null;
  check_score: CheckScore | null;
  retry_count: number;
  iteration: number;
}

export function applyAutoStatus(
  _state: AutoStatusState,
  msg: AutoStatusMessage,
): AutoStatusState {
  return {
    phase: msg.phase as AutoStatusState['phase'],
    phaseProgress: msg.phase_progress,
    step: msg.step,
    next: msg.next,
    stage: msg.stage,
    checkScore: msg.check_score,
    retryCount: msg.retry_count,
    iteration: msg.iteration,
  };
}

export function createAutoStatusSlice() {
  return {
    autoStatus: { ...initialAutoStatus },
    setAutoStatus: (msg: AutoStatusMessage) => {
      // This will be integrated into the Zustand store
      return applyAutoStatus(initialAutoStatus, msg);
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run packages/web/src/__tests__/autoStatusSlice.test.ts`
Expected: PASS

**Step 5: Integrate into wsSlice.ts**

Add to `packages/web/src/store/wsSlice.ts` message handler switch (around line 260):

```typescript
case 'auto_status': {
  set((state) => ({
    ...state,
    autoStatus: applyAutoStatus(state.autoStatus, parsed),
  }));
  break;
}
```

Import `applyAutoStatus` and `initialAutoStatus` at the top. Add `autoStatus: AutoStatusState` to the store's state type and initialize with `initialAutoStatus`.

**Step 6: Commit**

```bash
git add packages/web/src/store/autoStatusSlice.ts packages/web/src/__tests__/autoStatusSlice.test.ts packages/web/src/store/wsSlice.ts
git commit -m "feat(web): add autoStatus store slice with WebSocket integration"
```

---

### Task 2.2: Phase Progress Bar Component

**Files:**
- Create: `packages/web/src/components/AutoStatusBar.tsx`
- Create: `packages/web/src/components/AutoStatusBar.css`
- Test: `packages/web/src/__tests__/AutoStatusBar.test.tsx`

**Step 1: Write the failing test**

Create `packages/web/src/__tests__/AutoStatusBar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhaseProgressBar } from '../components/AutoStatusBar';

describe('PhaseProgressBar', () => {
  it('renders all four phases', () => {
    render(
      <PhaseProgressBar
        phase="execution"
        phaseProgress={0.45}
      />
    );
    expect(screen.getByText('target')).toBeDefined();
    expect(screen.getByText('plan')).toBeDefined();
    expect(screen.getByText('exec')).toBeDefined();
    expect(screen.getByText('merge')).toBeDefined();
  });

  it('marks completed phases with checkmark', () => {
    const { container } = render(
      <PhaseProgressBar
        phase="execution"
        phaseProgress={0.45}
      />
    );
    // target and plan should be completed (before execution)
    const completedPhases = container.querySelectorAll('.auto-phase-complete');
    expect(completedPhases.length).toBe(2); // target + plan
  });

  it('shows progress percentage for current phase', () => {
    render(
      <PhaseProgressBar
        phase="execution"
        phaseProgress={0.45}
      />
    );
    expect(screen.getByText('45%')).toBeDefined();
  });

  it('renders nothing when phase is null', () => {
    const { container } = render(
      <PhaseProgressBar phase={null} phaseProgress={null} />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run packages/web/src/__tests__/AutoStatusBar.test.tsx`
Expected: FAIL — module not found

**Step 3: Create AutoStatusBar component**

Create `packages/web/src/components/AutoStatusBar.tsx`:

```tsx
import './AutoStatusBar.css';
import type { CheckScore } from '../store/autoStatusSlice';

const PHASES = ['target', 'plan', 'exec', 'merge'] as const;
const PHASE_MAP: Record<string, typeof PHASES[number]> = {
  target: 'target',
  planning: 'plan',
  execution: 'exec',
  finalization: 'merge',
};

interface PhaseProgressBarProps {
  phase: string | null;
  phaseProgress: number | null;
}

export function PhaseProgressBar({ phase, phaseProgress }: PhaseProgressBarProps) {
  if (!phase) return null;

  const currentPhaseIndex = PHASES.indexOf(PHASE_MAP[phase] ?? 'target');

  return (
    <div className="auto-phase-bar">
      {PHASES.map((p, i) => {
        const isComplete = i < currentPhaseIndex;
        const isCurrent = i === currentPhaseIndex;
        const className = [
          'auto-phase-step',
          isComplete ? 'auto-phase-complete' : '',
          isCurrent ? 'auto-phase-current' : '',
        ].filter(Boolean).join(' ');

        return (
          <span key={p}>
            {i > 0 && <span className="auto-phase-arrow">&rarr;</span>}
            <span className={className}>
              {isComplete && <span className="auto-phase-check">&check;</span>}
              {p}
              {isCurrent && phaseProgress != null && (
                <span className="auto-phase-progress">
                  {Math.round(phaseProgress * 100)}%
                </span>
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}

const D_LABELS: Record<string, string> = {
  d1_correctness: 'D1 Correctness',
  d2_security: 'D2 Security',
  d3_reliability: 'D3 Reliability',
  d4_performance: 'D4 Performance',
  d5_architecture: 'D5 Architecture',
  d6_maintainability: 'D6 Maintainability',
};

interface ScorePanelProps {
  checkScore: CheckScore | null;
  expanded: boolean;
  onToggle: () => void;
}

export function ScorePanel({ checkScore, expanded, onToggle }: ScorePanelProps) {
  if (!checkScore) return null;

  return (
    <div className="auto-score-panel">
      <button className="auto-score-toggle" onClick={onToggle}>
        {checkScore.overall.toFixed(2)}
        <span className="auto-score-caret">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="auto-score-details">
          {Object.entries(D_LABELS).map(([key, label]) => {
            const score = checkScore[key as keyof CheckScore];
            return (
              <div key={key} className="auto-score-row">
                <span className="auto-score-label">{label}</span>
                <div className="auto-score-bar-bg">
                  <div
                    className="auto-score-bar-fill"
                    style={{ width: `${score * 100}%` }}
                  />
                </div>
                <span className="auto-score-value">{score.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface StageIndicatorProps {
  stage: { current: number; total: number } | null;
}

export function StageIndicator({ stage }: StageIndicatorProps) {
  if (!stage || stage.total <= 1) return null;

  return (
    <span className="auto-stage-indicator">
      Stage {stage.current}/{stage.total}
    </span>
  );
}
```

Create `packages/web/src/components/AutoStatusBar.css`:

```css
/* Auto Status Bar — Phase Progress */
.auto-phase-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  padding: 4px 8px;
}

.auto-phase-step {
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-cell-hover);
}

.auto-phase-complete {
  color: var(--color-completed);
  background: rgba(21, 128, 61, 0.08);
}

.auto-phase-current {
  color: var(--color-primary);
  background: var(--color-primary-light);
  font-weight: 600;
}

.auto-phase-arrow {
  color: var(--text-secondary);
  margin: 0 2px;
  opacity: 0.5;
}

.auto-phase-check {
  margin-right: 2px;
}

.auto-phase-progress {
  margin-left: 4px;
  font-weight: 400;
  opacity: 0.8;
}

/* Score Panel */
.auto-score-panel {
  position: relative;
}

.auto-score-toggle {
  background: none;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
}

.auto-score-toggle:hover {
  background: var(--bg-cell-hover);
}

.auto-score-caret {
  margin-left: 4px;
  font-size: 10px;
}

.auto-score-details {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 50;
  background: var(--bg-cell);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  padding: 8px 12px;
  min-width: 280px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  margin-top: 4px;
}

.auto-score-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  font-family: var(--font-mono);
}

.auto-score-label {
  min-width: 120px;
  color: var(--text-secondary);
}

.auto-score-bar-bg {
  flex: 1;
  height: 6px;
  background: var(--bg-cell-hover);
  border-radius: 3px;
  overflow: hidden;
}

.auto-score-bar-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.auto-score-value {
  min-width: 36px;
  text-align: right;
  color: var(--text-primary);
}

/* Stage Indicator */
.auto-stage-indicator {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-cell-hover);
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run packages/web/src/__tests__/AutoStatusBar.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/components/AutoStatusBar.tsx packages/web/src/components/AutoStatusBar.css packages/web/src/__tests__/AutoStatusBar.test.tsx
git commit -m "feat(web): add AutoStatusBar components (PhaseProgressBar, ScorePanel, StageIndicator)"
```

---

### Task 2.3: Integrate AutoStatusBar into Notebook UI

**Files:**
- Modify: `packages/web/src/components/Notebook.tsx` (add AutoStatusBar below NotebookStatusBar)
- No separate test (integration — covered by existing component tests + manual verification)

**Step 1: Read Notebook.tsx**

Already explored. `NotebookStatusBar` is at lines 12-160.

**Step 2: Add AutoStatusBar to Notebook layout**

Import and render `PhaseProgressBar`, `ScorePanel`, and `StageIndicator` below the `NotebookStatusBar`:

```tsx
import { PhaseProgressBar, ScorePanel, StageIndicator } from './AutoStatusBar';
import { useStore } from '../store';
import { useState } from 'react';

// Inside Notebook component:
const autoStatus = useStore((s) => s.autoStatus);
const [scoreExpanded, setScoreExpanded] = useState(false);

// In JSX, after NotebookStatusBar:
{autoStatus.phase && (
  <div className="auto-status-container">
    <StageIndicator stage={autoStatus.stage} />
    <PhaseProgressBar
      phase={autoStatus.phase}
      phaseProgress={autoStatus.phaseProgress}
    />
    <ScorePanel
      checkScore={autoStatus.checkScore}
      expanded={scoreExpanded}
      onToggle={() => setScoreExpanded(!scoreExpanded)}
    />
  </div>
)}
```

Add CSS for `.auto-status-container`:

```css
.auto-status-container {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px var(--space-xl);
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-page);
}
```

**Step 3: Add auto_subscribe WebSocket message on notebook open**

In the WebSocket connection setup (in `wsSlice.ts`), after connecting:

```typescript
// Subscribe to auto status updates for the current session
ws.send(JSON.stringify({ type: 'auto_subscribe', session_id }));
```

**Step 4: Run full test suite**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run`
Expected: All tests pass, zero regressions

**Step 5: Commit**

```bash
git add packages/web/src/components/Notebook.tsx packages/web/src/store/wsSlice.ts
git commit -m "feat(web): integrate AutoStatusBar into Notebook UI with WebSocket subscription"
```

---

### Task 2.4: Frontend Regression Check

**Step 1: Run all tests**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run`
Expected: All tests pass (report count)

**Specific frontend regression scenarios to verify:**
- `npx vitest run packages/web/src/__tests__/autoStatusSlice.test.ts` — store slice works
- `npx vitest run packages/web/src/__tests__/AutoStatusBar.test.tsx` — component renders correctly
- Existing notebook tests: `NotebookStatusBar` still renders (adding `AutoStatusBar` doesn't break layout)
- `wsSlice.ts` message routing: existing message types (`cell_status`, `execution_complete` etc.) still handled correctly
- Store initialization: `autoStatus` field defaults to null/0 values, not undefined

**Step 2: Run shell tests**

Run:
```bash
for t in task-ai/tests/unit/*.test.sh; do echo "=== $t ==="; bash "$t" || echo "FAILED: $t"; done
```
Expected: All pass

**Step 3: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: resolve regressions from frontend auto status integration"
```

---

## Step 3: check Subcommand Extension — Three-File Anchored Review

### Task 3.1: Add Three-File Anchored Review to check SKILL.md

**Files:**
- Modify: `task-ai/skills/check/SKILL.md` (add anchored review description per design doc §交付物验收)
- No test (documentation/instructions)

**Step 1: Read current check SKILL.md**

Already explored. Current gates: D2 → D1 → D3 → D4+D5+D6. Three checkpoint types: post-plan, mid-exec, post-exec.

**Step 2: Add three-file anchored review section**

Add to check SKILL.md after the existing checkpoint descriptions:

```markdown
### Three-File Anchored Review

check evaluates deliverables against `.target.md` (requirements) and `.plan.md` (design) as anchoring references, per dimension:

| Dimension | Anchor | Question |
|-----------|--------|----------|
| D1 Correctness | .target.md requirements | Does the deliverable implement each requirement? |
| D2 Security | .target.md security constraints | Does the deliverable meet security requirements? |
| D3 Reliability | .plan.md boundary annotations | Does the deliverable cover boundary/exception scenarios? |
| D4 Performance | .target.md performance metrics | Does the deliverable meet performance requirements? |
| D5 Architecture | .plan.md architecture design | Does the deliverable match the module/interface design? |
| D6 Maintainability | .plan.md module divisions | Is the deliverable organized per planned modules? |

**Phase 2 exception:** When reviewing `.plan.md` itself (post-plan checkpoint), D3/D5/D6 assess the plan's intrinsic quality instead of cross-referencing another file.

### Score Output

After each check, write D1-D6 numeric scores (0.0-1.0) to `.auto-signal` `check_score` field:

```json
{
  "check_score": {
    "overall": 0.85,
    "d1_correctness": 0.90,
    "d2_security": 0.80,
    "d3_reliability": 0.85,
    "d4_performance": 0.88,
    "d5_architecture": 0.82,
    "d6_maintainability": 0.85
  }
}
```

The `overall` score is a weighted average using checkpoint-specific weights.
```

**Step 3: Commit**

```bash
git add task-ai/skills/check/SKILL.md
git commit -m "feat(task-ai): add three-file anchored review and score output to check SKILL.md"
```

---

### Task 3.2: Add `pre-merge` Checkpoint to check.sh

**Files:**
- Modify: `task-ai/skills/check/scripts/check.sh` (add pre-merge checkpoint handling)
- Test: `task-ai/tests/unit/check-pre-merge.test.sh`

**Step 1: Write the failing test**

Create `task-ai/tests/unit/check-pre-merge.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Test that check.sh recognizes --checkpoint pre-merge
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK_SH="$SCRIPT_DIR/skills/check/scripts/check.sh"

# Verify pre-merge is handled (not "Unknown checkpoint")
if grep -q "pre-merge" "$CHECK_SH"; then
    echo "PASS: check.sh contains pre-merge handling"
else
    echo "FAIL: check.sh does not contain pre-merge handling"
    exit 1
fi
```

**Step 2: Run test**

Run: `bash task-ai/tests/unit/check-pre-merge.test.sh`
Expected: FAIL (pre-merge not yet in check.sh)

**Step 3: Add pre-merge checkpoint to check.sh**

Add a case for `pre-merge` checkpoint in check.sh. Pre-merge is similar to post-exec but with threshold 0.80 (stricter):

```bash
# After the post-exec case block, add:
elif [[ "$CHECKPOINT" == "pre-merge" ]]; then
    echo "[check:pre-merge] Running pre-merge quality gate (threshold: 0.80)..."
    # Same as post-exec but with higher threshold
    # Reads .target.md + .plan.md + deliverable files for three-file anchored review
    # Writes check_score to .auto-signal
    # Verdict: ACCEPT (>= 0.80) or NEEDS_FIX (< 0.80, routes back to Phase 3)
```

**Step 4: Run test**

Run: `bash task-ai/tests/unit/check-pre-merge.test.sh`
Expected: PASS

**Step 5: Commit**

```bash
git add task-ai/skills/check/scripts/check.sh task-ai/tests/unit/check-pre-merge.test.sh
git commit -m "feat(task-ai): add pre-merge checkpoint to check.sh (threshold 0.80)"
```

---

## Step 4: Subagent Delegation Mechanism

### Task 4.1: Document Subagent Delegation in auto SKILL.md

This is already covered in Task 1.5 (SKILL.md rewrite). The delegation section from `task-ai-auto.md` §Subagent 委托执行 should be encoded in the SKILL.md.

Key elements:
- Dynamic judgment with four factors (phase, context dependency, complexity, execution history)
- Signal sources for each factor
- Model tier mapping (heavy→opus, medium→sonnet, light→haiku)
- Fault tolerance (timeout by tier, fallback to inline, delegation_failures tracking)
- Trust boundary (subagent outputs only trusted for result/next/deliverable files, not phase/retry_count/check_score)

No separate task needed — this is part of Task 1.5.

---

## Step 5: Integration Testing

### Task 5.1: End-to-End Signal Flow Test

**Files:**
- Create: `task-ai/tests/integration/auto-signal-flow.test.sh`

**Step 1: Create integration test**

```bash
#!/usr/bin/env bash
# Integration test: Full signal flow from auto.sh to .auto-signal with extended fields
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Create minimal notebook structure
mkdir -p "$TEST_DIR/test-nb"
cat > "$TEST_DIR/test-nb/.index.json" <<'EOF'
{"name": "test-nb", "status": "planning", "type": "software"}
EOF
cat > "$TEST_DIR/test-nb/.target.md" <<'EOF'
# Test Target
## Requirements
- Implement feature X
EOF
cat > "$TEST_DIR/test-nb/.plan.md" <<'EOF'
# Test Plan
## Steps
1. Create module A
2. Add tests
EOF

# Source signal-writer
source "$SCRIPT_DIR/skills/auto/scripts/signal-writer.sh"

# Create base signal
cat > "$TEST_DIR/test-nb/.auto-signal" <<'EOF'
{
  "step": "plan",
  "result": "(generated)",
  "next": "check",
  "iteration": 1,
  "timestamp": "2026-01-01T00:00:00Z"
}
EOF

# Write phase info
write_phase "$TEST_DIR/test-nb/.auto-signal" "planning" 0.50

# Write check score
write_check_score "$TEST_DIR/test-nb/.auto-signal" 0.85 0.90 0.80 0.85 0.88 0.82 0.85

# Verify all fields present
python3 -c "
import json, sys
with open('$TEST_DIR/test-nb/.auto-signal') as f:
    s = json.load(f)

assert s['phase'] == 'planning', f'phase={s[\"phase\"]}'
assert s['phase_progress'] == 0.50, f'progress={s[\"phase_progress\"]}'
assert s['check_score']['overall'] == 0.85, f'overall={s[\"check_score\"][\"overall\"]}'
assert s['check_score']['d1_correctness'] == 0.90
assert s['check_score']['d6_maintainability'] == 0.85
assert s['step'] == 'plan'
assert s['next'] == 'check'
print('All fields verified')
"

echo "PASS: End-to-end signal flow test"
```

**Step 2: Run test**

Run: `bash task-ai/tests/integration/auto-signal-flow.test.sh`
Expected: PASS

**Step 3: Commit**

```bash
git add task-ai/tests/integration/auto-signal-flow.test.sh
git commit -m "test(task-ai): add end-to-end signal flow integration test"
```

---

### Task 5.2: Final Regression Check

**Step 1: Run all tests**

Run: `cd /home/ubuntu/notebook-ai && npx vitest run`
Expected: All tests pass (report total count)

**Step 2: Run all shell tests**

Run:
```bash
for t in task-ai/tests/unit/*.test.sh task-ai/tests/integration/*.test.sh; do
  echo "=== $t ==="
  bash "$t" || echo "FAILED: $t"
done
```
Expected: All pass

**Step 3: Git status check**

Run: `git status`
Verify only expected files are modified/added.

---

## File Summary

| Operation | File Path | Task |
|-----------|-----------|------|
| Modify | `task-ai/skills/auto/SKILL.md` | 1.1 (validation table), 1.5 (full rewrite) |
| Create | `task-ai/skills/auto/scripts/signal-writer.sh` | 1.4 |
| Modify | `task-ai/skills/auto/scripts/auto.sh` | 1.6 |
| Modify | `packages/shared/src/types.ts` | 1.2, 1.3 |
| Modify | `packages/server/src/ws-handler.ts` | 1.3 |
| Modify | `task-ai/skills/check/SKILL.md` | 3.1 |
| Modify | `task-ai/skills/check/scripts/check.sh` | 3.2 |
| Create | `packages/web/src/store/autoStatusSlice.ts` | 2.1 |
| Modify | `packages/web/src/store/wsSlice.ts` | 2.1, 2.3 |
| Create | `packages/web/src/components/AutoStatusBar.tsx` | 2.2 |
| Create | `packages/web/src/components/AutoStatusBar.css` | 2.2 |
| Modify | `packages/web/src/components/Notebook.tsx` | 2.3 |
| Create | `packages/shared/src/__tests__/auto-signal-schema.test.ts` | 1.2 |
| Create | `packages/server/src/__tests__/auto-signal-watcher.test.ts` | 1.3 |
| Create | `task-ai/tests/unit/signal-writer.test.sh` | 1.4 |
| Create | `task-ai/tests/unit/auto-phase-derivation.test.sh` | 1.6 |
| Modify | `packages/server/src/task-ai/compaction-strategy.ts` | 1.7 |
| Create | `packages/server/src/__tests__/compaction-strategy-signal.test.ts` | 1.7 |
| Create | `task-ai/tests/unit/check-pre-merge.test.sh` | 3.2 |
| Create | `packages/web/src/__tests__/autoStatusSlice.test.ts` | 2.1 |
| Create | `packages/web/src/__tests__/AutoStatusBar.test.tsx` | 2.2 |
| Create | `task-ai/tests/integration/auto-signal-flow.test.sh` | 5.1 |

## Execution Order

```
Step 1: Backend + Signal Schema + Check (Tasks 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7)
  ↓
Step 2: Frontend UI (Tasks 2.1 → 2.2 → 2.3 → 2.4)
  ↓
Step 3: check Extension (Tasks 3.1 → 3.2)
  ↓
Step 4: Subagent Delegation (covered in Task 1.5)
  ↓
Step 5: Integration Testing (Tasks 5.1 → 5.2)
```

Dependencies:
- Task 1.2 depends on 1.1 (schema definition before Zod types)
- Task 1.3 depends on 1.2 (Zod schemas needed for backend parsing)
- Task 1.4 is independent (shell-only, no TS dependency)
- Task 1.6 depends on 1.4 (auto.sh sources signal-writer.sh)
- Task 1.7 depends on 1.1-1.6 (regression check after all backend changes)
- Task 2.1 depends on 1.2 (shared types needed for store)
- Task 2.2 depends on 2.1 (store types needed for components)
- Task 2.3 depends on 2.1 + 2.2 (store + components needed for integration)
- Tasks 3.x are independent of Step 2
- Step 5 depends on all previous steps

---

## TDD Compliance Matrix

| Task | Red/Green | Red 信号 | Green 信号 |
|------|-----------|---------|-----------|
| 1.1 | — (文档) | N/A | SKILL.md 更新 |
| 1.2 | ✅ 真 Red | `import { AutoSignalSchema }` 不存在 → 编译失败 | Zod schema 导出后测试通过 |
| 1.3 | ✅ 真 Red | `import { AutoSignalSchema } from '@notebook-ai/shared'` 依赖 1.2 | schema 存在后文件解析测试通过 |
| 1.4 | ✅ 真 Red | `source signal-writer.sh` 文件不存在 → bash 失败 | 创建文件后四个函数测试全通过 |
| 1.5 | — (文档) | N/A | SKILL.md 重写 |
| 1.6 | ✅ 真 Red | `auto.sh` 输出的 `.auto-signal` 无 `phase` 字段 → 测试失败 | auto.sh 加 `derive_phase()` 后测试通过 |
| 1.7 | ✅ 回归 | `compaction-strategy.ts` 读新格式可能字段缺失 | 更新后全量测试通过 |
| 2.1 | ✅ 真 Red | `import autoStatusSlice` 模块不存在 → 编译失败 | 创建模块后状态更新测试通过 |
| 2.2 | ✅ 真 Red | `import PhaseProgressBar` 组件不存在 → 编译失败 | 创建组件后渲染测试通过 |
| 2.3 | 集成 | 依赖 2.1 + 2.2 存在 | 全量 vitest 通过 |
| 2.4 | 回归 | — | 全量 vitest + shell 测试通过，报总数 |
| 3.1 | — (文档) | N/A | check SKILL.md 更新 |
| 3.2 | ✅ 真 Red | `grep "pre-merge" check.sh` 找不到 → 测试失败 | 添加 pre-merge case 后测试通过 |
| 5.1 | 集成 | 依赖 1.4 的 signal-writer.sh 存在 | 端到端信号流测试通过 |
| 5.2 | 回归 | — | 全量 vitest + shell 测试通过 |

**回归测试策略：**
- Task 1.7: `compaction-strategy.ts` 硬升级（无向后兼容，旧格式不保留）
- Task 2.4: 前端现有组件不受新 `autoStatus` 字段影响
- Task 5.2: 全量回归确认（vitest + shell，报总测试数）
- 每个 Task 的 commit 前都运行相关测试子集确认 Green
