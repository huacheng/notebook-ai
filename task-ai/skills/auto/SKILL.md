---
name: auto
description: Conversational task lifecycle — dialog-driven four-phase flow with automatic review and subagent delegation
model_tier: heavy
auto_delegatable: false
triggers:
  keywords:
    zh: [自动, 全自动, 自动跑, 自动执行, 一键, 跑全流程, 继续]
    en: [auto, autopilot, run automatically, hands-off, full cycle, end to end, continue]
  phrases:
    zh: [自动跑一遍, 全自动执行, 一键跑完, 从头到尾自动, 停止自动, 继续执行]
    en: [run it automatically, start autopilot, run the full cycle, hands-off execution, stop auto]
  disambiguate: >
    Core intent: orchestrate the entire task lifecycle through conversation.
    Notebook existence IS the context — no "auto mode" activation needed.
    User wants FULL lifecycle → auto.
    User wants ONE step manually → exec. User wants just the plan → plan.
arguments:
  - name: action
    description: "Action: start or stop"
    required: false
    default: start
---

# /task-ai:auto — Conversational Task Lifecycle

Dialog-driven four-phase flow: Target → Planning → Execution → Finalization. Claude reads state files to determine the current phase and acts accordingly. No "auto mode" to activate — notebook existence IS the context.

## Core Principle

**No auto mode to activate.** Notebook existence IS the context. Claude reads `.status.json` + `.auto-signal` + `.target.md` each conversation turn, derives the current phase, and executes the appropriate action. User dialog directly drives phase progression.

```
Frontend UI: init (create notebook) → .status.json status=draft
  │
  ▼
User says anything in conversation
  │
  ▼
Claude reads state files → derives current phase
  │
  ▼
Semantic understanding of user message → execute phase-appropriate action
```

## Usage

```
/task-ai:auto [--stop]
```

## Four-Phase Flow

### Phase Progression Mechanism

| Phase | Progression | Reason |
|-------|------------|--------|
| Phase 1 (Target) | **User dialog confirms** | "What to build" — only user can define; LLM self-review creates coherence bias |
| Phases 2-4 (Plan/Exec/Final) | **LLM auto-review** | "Is it correct?" — check(D1-D6) provides objective evaluation |

Auto-review mechanism:
```
Deliverables + .target.md + .plan.md → check(D1-D6 scoring) → overall ≥ threshold → auto-advance
                                                             → overall < threshold → replan/fix based on failing dimensions
```

### Phase Derivation from `.status.json` Status

| `.status.json` status | Derived Phase | Description |
|----------------------|---------------|-------------|
| `draft` | `target` | Defining objectives, user in the loop |
| `planning` / `re-planning` | `planning` | Generating/revising plan |
| `review` / `executing` | `execution` | Executing plan steps |
| `blocked` | `execution` (stalled) | Blocked, awaiting user intervention |
| `complete` / `stage-done` | `finalization` | Merge, distill, report |
| `cancelled` | — (terminal) | Loop stops immediately, no phase |

### Threshold & Retry Limits

| Checkpoint | Threshold | Retry Limit | On Limit Exceeded |
|------------|-----------|-------------|-------------------|
| post-plan (Phase 2) | 0.70 | 3 replans | Stop, notify user: "Plan repeatedly failed review, manual intervention needed" |
| mid-exec (Phase 3 mid) | 0.60 | 2 fixes | Stop current step, notify user |
| post-exec (Phase 3 done) | 0.75 | 3 fix/replan | Stop, notify user |
| pre-merge (Phase 4) | 0.80 | No retry | Fall back to Phase 3 (retry_count reset to 0, resume from failing dimensions) |

`retry_count` persists in `.auto-signal`. Resets to 0 on phase transition. `delegation_failures` clears on phase transition (new phase = new context).

> **check runtime errors:** If check itself fails (file read error, state.py exception — not low score), it does NOT count toward retry_count. Stop immediately, await user intervention. Only normal execution with score below threshold triggers retry.

### Three-File Anchored Review

check evaluates deliverables against `.target.md` (requirements) and `.plan.md` (design) per D1-D6 dimension:

| Dimension | Anchor | Review Question |
|-----------|--------|-----------------|
| D1 Correctness | .target.md requirements | Does deliverable implement each requirement? |
| D2 Security | .target.md security constraints | Does deliverable satisfy security requirements? |
| D3 Reliability | .plan.md boundary conditions | Does deliverable cover planned edge/exception cases? |
| D4 Performance | .target.md performance metrics | Does deliverable meet performance requirements? |
| D5 Architecture | .plan.md architecture design | Does deliverable structure match planned modules/interfaces? |
| D6 Maintainability | .plan.md module division | Is deliverable organized per plan? Naming/conventions consistent? |

> **Phase 2 exception:** When reviewing `.plan.md` itself, D3/D5/D6 anchors assess internal quality (boundary coverage, module structure, step clarity) rather than self-referencing .plan.md.

### Detailed Phase Flow

```
Phase 1: Target Definition (status=draft) — Human in the loop
  - Read .target.md; if empty, guide user to describe goal
  - User dialog refines .target.md directly
  - Multi-stage research (O1→O2→O3): present results after each, wait for user confirmation
  - Gate: .target.md has no residual [PROPOSED] markers → Phase 2
    - If [PROPOSED] remains → prompt user to confirm or remove

Phase 2: Planning (status=planning) — Full auto + user can intervene
  - Optional: research for technical references (implementation-level, not objective research)
  - Execute plan → verify(post-plan) → check(post-plan) (no code output — verify validates plan document quality)
  - check D1-D6 ≥ 0.70 → auto-advance to Phase 3
  - score < threshold → auto-replan based on failing dimensions → re-check
  - User can intervene: "step 3 unnecessary" → modify .plan.md, re-check

Phase 3: Execution (status=executing) — Full auto + user can intervene
  - Execute exec step by step
  - Key checkpoints trigger verify → check(mid-exec): significant issues, or every 3 steps
  - All steps done → verify → check(post-exec)
  - check score ≥ threshold → continue/advance to Phase 4
  - score < threshold → auto-fix based on failing dimensions → re-verify + re-check
  - Exceeds retry limit → stop, notify user
  - User can intervene: "what does this error mean?" → explain + fix, continue

Phase 4: Finalization (status=complete/stage-done) — Full auto
  - check(pre-merge, threshold 0.80) → below threshold → fall back to Phase 3
  - Passes: merge → highlight → report → done
```

## Dialog Behavior

### Dialog IS Action (No Router)

No intent classification or rule matching. Claude reads current phase SKILL.md + user message, acts through semantic understanding — like a pair programming partner.

Phase 1 (Target) — must wait for user confirmation:

| User says | Claude does |
|-----------|------------|
| "I need WebSocket auth with token refresh" | Write/update .target.md |
| "Also needs backward compatibility" | Append requirement to .target.md |
| (O1 research done) "Direction is right" | Confirm O1, advance to O2 |
| (O3 done) "Change item 2 to Y" / "OK all confirmed" | [PROPOSED] → [CONFIRMED], enter Phase 2 |
| Silence | **Do not advance** — wait for user confirmation |

Phases 2-4 — full auto, user can intervene:

| User says | Claude does |
|-----------|------------|
| "Skip step 3" | Adjust plan/execution, re-check |
| "What does this error mean?" | Explain + fix, continue |
| "Run tests again" | Trigger verify |
| "Continue" / Silence | Continue next step |
| "Don't merge yet" | Pause merge, await further instructions |

### Explicit Override (Sub-command)

User can override via dialog (`/task-ai:check`) or frontend toolbar button — both semantically equivalent.

Behavior:
1. auto yields control (after current step completes, not mid-step)
2. Sub-command executes full flow independently
3. Sub-command writes `.auto-signal` / updates `.status.json`
4. auto reads latest state on next trigger (user message / daemon continuation)
5. auto re-routes from new state

## Architecture

Auto mode runs as a **single long-lived Claude session**. The daemon monitors externally; it does NOT dispatch individual commands.

### Components

```
┌─────────────────────────────────────────────────┐
│  the agent (single session)                     │
│                                                 │
│  /task-ai:auto                                  │
│    ├→ derive phase from .status.json ─┐          │
│    ├→ execute plan logic              │ internal │
│    ├→ execute check logic             │ loop     │
│    ├→ execute exec logic              │ (shared  │
│    ├→ execute check logic             │ context) │
│    ├→ execute merge logic            ─┘          │
│    └→ execute report logic                      │
│                                                 │
│  writes .auto-signal ──→ (progress report)      │
│  reads  .auto-stop   ──→ (stop request)         │
└─────────────────────────────────────────────────┘
         │                          ▲
         ▼                          │
┌─────────────────┐     ┌──────────┴──────────┐
│  .auto-signal   │     │  Backend Daemon      │
│  (progress)     │────▶│  - monitors progress │
│                 │     │  - enforces timeout   │
│  .auto-stop     │◀────│  - writes stop file   │
│  (stop request) │     │  - stall detection    │
└─────────────────┘     └─────────────────────┘
```

### Why Single Session

| Aspect | Multi-session (old) | Single session (current) |
|--------|-------------------|--------------------------|
| Context | Lost between steps, rebuilt from `.summary.md` | Naturally shared across all steps |
| Token cost | Re-read files each step, duplicate context loading | Read once, incrementally update |
| Coherence | Each step is blind to implicit decisions | Claude remembers why it made choices |
| Latency | Shell prompt wait + Claude startup per step | Zero inter-step overhead |
| Daemon complexity | Command construction + dispatch + readiness check | Just monitoring + stop signal |

## Subagent Delegation

### Dynamic Judgment (Not Static)

SKILL.md `auto_delegatable` and `model_tier` are **default hints**. Actual delegation decisions are made dynamically by the auto main session based on context.

#### Judgment Factors & Signal Sources

| Factor | Signal Source | Logic | Example |
|--------|-------------|-------|---------|
| **Current phase** | `.status.json` status | Different status → different delegation strategy for same sub-command | status=draft: research NOT delegated (O1/O2/O3 need dialog); status=planning: research CAN delegate |
| **Context dependency** | (1) Unpersisted decisions in dialog (2) `.summary.md` freshness (3) `git diff --stat` from prior steps | High dependency → don't delegate | exec just refactored 5 files + dialog tradeoffs → verify inline; exec changed 1 file + no discussion → verify can delegate |
| **Task complexity** | (1) `.plan.md` step description length + file count (2) Test type (unit/integration/e2e) (3) `.target.md` complexity markers | Simple → light tier; Complex → medium/heavy | verify runs lint → haiku; verify runs e2e → sonnet |
| **Execution history** | `.auto-signal` `delegation_failures` array | Same sub-command failed as subagent before → inline from now on | `"delegation_failures": ["verify@iter3"]` → verify never delegates again |

#### Sub-command Default Hints & Dynamic Overrides

**heavy (→ opus)**

| Sub-command | Default delegatable | Default tier | Dynamic override |
|-------------|-------------------|-------------|-----------------|
| auto | — | heavy | Main session itself |
| target | false | heavy | Always inline (dialog interaction) |
| research | true | heavy | target phase O1/O2/O3 → inline (needs dialog); planning phase reference collection → can delegate |
| plan | false | heavy | Always inline (needs decision context) |
| check | false | heavy | Always inline (needs global context for three-file anchored review) |
| exec | false | heavy | Always inline (step-by-step needs main session context) |
| security | true | heavy | Usually can delegate; context-dependent security analysis → inline |

**medium (→ sonnet)**

| Sub-command | Default delegatable | Default tier | Dynamic override |
|-------------|-------------------|-------------|-----------------|
| verify | true | medium | exec has complex context dependency → inline; simple lint → tier down to light |
| merge | true | medium | Complex conflict history → inline |
| highlight | true | medium | Usually can delegate |
| report | true | medium | Usually can delegate |
| read | true | medium | Usually can delegate |
| annotate | false | medium | Needs interactive mode for High-impact responses; lock acquisition context-dependent |

**light (→ haiku)**

| Sub-command | Default delegatable | Default tier | Dynamic override |
|-------------|-------------------|-------------|-----------------|
| init | true | light | Frontend already executes, auto not involved |
| list | true | light | Read-only query, usually can delegate |
| cancel | true | light | Usually can delegate |
| summarize | true | light | Usually can delegate |
| library | true | light | Usually can delegate |

#### Model Mapping

```
model_tier → model
  heavy  → opus
  medium → sonnet
  light  → haiku
```

#### Executor Plugin Delegation

Beyond subagent delegation of individual sub-commands, exec supports **executor plugin delegation** — discovering and using execution engine plugins (e.g., `superpowers:subagent-driven-development`) to replace the default per-step inline loop. See `references/plugin-delegation.md` §Executor Slot Table.

This enables adaptive execution strategies:
- Software tasks with clear test criteria → `subagent-driven-development` (fresh subagent per step + two-stage review)
- Documentation tasks → domain-specific doc builder plugin
- Any task type → if the plugin registry records a high-health executor for the type, use it

The exec sub-command handles executor discovery at step 7 (before per-step loop). Auto mode does not need special handling — exec's executor delegation is transparent to auto's routing logic.

#### Fault Tolerance

- Subagent timeout → main session fallback to inline execution
  - Timeout by tier: light 2min / medium 5min / heavy 10min
- Subagent execution failure → fallback to inline
- Subagent output files missing → alert + fallback
- Subagent writes unexpected fields → main session only trusts subagent-scope fields (outputs + `result`/`next`); `phase`/`retry_count`/`check_score` maintained by main session
- Executor plugin failure mid-execution → exec falls back to native per-step loop, resuming from `completed_steps + 1`

### Context Savings

```
Full inline:    target(dialog) + plan + check + exec + verify*N + check*N + merge + highlight + report
                → main session context grows continuously, may trigger multiple compactions

Delegation:     target(dialog) + plan + check + exec + [verify→subagent] + check + [merge→subagent] + [highlight→subagent] + [report→subagent]
                → main session keeps only decision path, delegated output flows back as summaries
```

## Session Recovery

User returns and says "continue":

1. Read `.auto-signal` → iteration, step, next, retry_count, delegation_failures
   - If `.auto-signal` absent → entry-point routing from `.status.json` status
2. Read `.status.json` → status, stage
3. Read `.summary.md` → context summary
   - If `.summary.md` absent → read `.target.md` + `.plan.md` to rebuild minimal context
4. Resume from interruption point

### "Silent Continue" Mechanism

Claude Code is request-response. Phases 2-4 "auto-advance without intervention" means:
- **Within same turn**: Claude finishes one sub-command, continues to next without waiting (continuous execution within single request)
- **Across turns**: User must say "continue" or any message to trigger next round
- Backend daemon can trigger: detects step complete with no follow-up → sends continuation prompt
- **Race protection**: daemon checks `.auto-signal` `timestamp` hasn't changed (CAS) before sending continuation. If changed (user already triggered), abort to prevent double-trigger

## Signal File (`.auto-signal`)

After each sub-command step completes, Claude writes a progress signal. This is a **monitoring report** for the daemon, NOT a dispatch trigger:

```json
{
  "step": "check",
  "result": "PASS",
  "next": "exec",
  "checkpoint": "post-plan",
  "iteration": 3,
  "compaction_count": 0,
  "vfp_cycles_completed": 2,
  "phase": "planning",
  "phase_progress": 0.75,
  "stage": { "current": 1, "total": 2 },
  "check_score": {
    "overall": 0.85,
    "d1_correctness": 0.90,
    "d2_security": 0.80,
    "d3_reliability": 0.85,
    "d4_performance": 0.88,
    "d5_architecture": 0.82,
    "d6_maintainability": 0.85
  },
  "retry_count": 1,
  "delegation_failures": ["verify@iter3"],
  "timestamp": "2024-01-01T00:00:00Z"
}
```

Fields:
- `step`: sub-command that just completed
- `result`: outcome of the step
- `next`: what the agent will execute next (or `"(stop)"`)
- `checkpoint`: context hint (e.g., `"post-plan"`, `"mid-exec"`, `"post-exec"`, `"pre-merge"`). Empty when not applicable
- `iteration`: current iteration count. **Auto-mode only** — absent in manual execution
- `compaction_count`: context compaction invocations within current auto session. **Auto-mode only**. Reset to `0` on normal iteration advance. On compaction recovery, incremented by 1 (NOT reset). If `>= 3` → stop with warning (see Compaction frequency limit)
- `vfp_cycles_completed`: VH→HS cycles completed during Phase 3 execution. **Auto-mode only**, software types only
- `phase`: derived from `.status.json` status — `target` (draft), `planning` (planning/re-planning), `execution` (review/executing/blocked), `finalization` (complete/stage-done)
- `phase_progress`: float 0-1, progress within current phase
- `stage`: `{ current, total }` multi-stage position, synced from `.status.json`
- `check_score`: last check D1-D6 scores + overall, or null if no check has run. Written by check, not auto
- `retry_count`: retries at current checkpoint, reset to 0 on phase transition
- `delegation_failures`: subagent failure records (`"cmd@iterN"`), cleared on phase transition
- `timestamp`: ISO 8601

The daemon reads this via `fs.watch` to:
1. Update progress display (iteration count, current step, elapsed time)
2. Check iteration limit (`iteration >= maxIterations` → write `.auto-stop`)
3. Check timeout (`elapsed >= timeoutMinutes` → write `.auto-stop`)
4. Update `last_signal_at` in SQLite for stall detection baseline

The daemon does **NOT** construct or send commands based on the signal.

### Signal File Ownership

Each sub-command's SKILL.md includes a "write `.auto-signal`" step. In auto mode, the auto loop **subsumes** that step — Claude writes the signal once at step 2.5 (with `iteration` field). The sub-command's own signal-write instruction is skipped.

In manual (non-auto) execution, sub-commands write `.auto-signal` themselves (without `iteration` field).

**How to detect auto mode** (for inline execution): Skip any step that says "Write `.auto-signal`". The auto loop's step 2.5 handles it. No env var or flag needed — auto mode always uses inline execution.

### Signal Validation

The daemon validates `.auto-signal` fields for monitoring integrity:

| Field | Validation | Allowed Values |
|-------|-----------|----------------|
| `step` | Whitelist | `plan`, `check`, `exec`, `merge`, `highlight`, `report`, `research`, `verify`, `annotate`, `target`, `summarize` |
| `result` | Whitelist | `PASS`, `NEEDS_REVISION`, `ACCEPT`, `NEEDS_FIX`, `REPLAN`, `BLOCKED`, `CONTINUE`, `(generated)`, `(done)`, `(mid-exec)`, `(step-N)` (where N is integer), `(blocked)`, `(collected)`, `(sufficient)`, `(o1-collected)`, `(o2-collected)`, `(o3-collected)`, `(objective-complete)`, `(pass)`, `(fail)`, `(partial)`, `(processed)`, `(distilled)`, `(skipped-idempotent)`, `failed`, `success`, `stage-done`, `conflict`, `rejected` |
| `next` | Whitelist | `plan`, `check`, `exec`, `merge`, `highlight`, `report`, `research`, `verify`, `annotate`, `target`, `summarize`, `(stop)`, `(none)` |
| `checkpoint` | Whitelist | `""`, `post-plan`, `post-research`, `post-o1`, `post-o2`, `post-o3`, `mid-exec`, `post-exec`, `pre-merge`, `post-annotate`, `quick`, `full`, `step-N`, `dependency-blocked`, `no-accept` |
| `iteration` | Integer | ≥ 0 |
| `compaction_count` | Integer | ≥ 0 |
| `vfp_cycles_completed` | Integer (optional) | ≥ 0 (present only for software types in auto mode) |
| `phase` | Whitelist | `target`, `planning`, `execution`, `finalization` |
| `phase_progress` | Float | 0.0 - 1.0 |
| `stage` | Object | `{ "current": int, "total": int }` where current ≥ 1, current ≤ total |
| `check_score` | Object or null | `{ "overall": float, "d1_correctness": float, ..., "d6_maintainability": float }` all 0.0-1.0 |
| `retry_count` | Integer | ≥ 0 |
| `delegation_failures` | Array | String array, each matching pattern `cmd@iterN` |
| `timestamp` | Format check | ISO 8601 |

Invalid signals are logged but do not affect Claude's internal loop (daemon is observer, not dispatcher).

### Stop File (`.auto-stop`)

The daemon writes `.auto-stop` to the task module directory to request graceful termination:

```json
{
  "reason": "timeout",
  "timestamp": "2024-01-01T00:30:00Z"
}
```

Reasons: `"timeout"`, `"max_iterations"`, `"user_stop"`, `"stall_limit"`, `"reasoning_loop"`

## State Machine

```
AUTO LOOP (4 phases — all within single Claude session)

Phase 1: Target (human-in-loop)
  User dialog → refine .target.md → research(O1→O2→O3, user confirms each)
  Gate: no [PROPOSED] residuals in .target.md → [Phase 2]

Phase 2: Planning (auto-review)
  plan ──→ verify ──→ check(post-plan, threshold=0.70) ─── PASS ──→ [Phase 3]
                              │
                              NEEDS_REVISION ──→ plan (retry, max 3)

Phase 3: Execution (auto-review)
  exec ─┬─ (mid-exec) ──→ verify ──→ check(mid-exec, threshold=0.60) ─── CONTINUE ──→ exec (resume)
        │                                    │
        │                               NEEDS_FIX ──→ exec (fix, max 2)
        │                                    │
        │                               REPLAN ──→ [Phase 2]
        │
        └─ (done) ──→ verify ──→ check(post-exec, threshold=0.75) ─── ACCEPT ──→ [Phase 4]
                                         │
                                    NEEDS_FIX / REPLAN (max 3)

Phase 4: Finalization (auto)
  check(pre-merge, threshold=0.80) ─── PASS ──→ merge ──→ highlight ──→ report → (stop)
            │
            FAIL ──→ [Phase 3] (retry_count reset, resume from failing dimensions)

  merge ─── success (current==total) ──→ highlight(complete) ──→ report → (stop)
    │          │
    │      stage-done (current<total) ──→ highlight(complete) ──→ report → (stop)
    │                                     Output: "Stage <N> completed.
    │                                     Define next stage target, then run /task-ai:auto"
    │
    └── conflict unresolvable (after 3 retries) → (stop)

Terminal: BLOCKED at any check → (stop, status → blocked)
Terminal: merge conflict → (stop, status stays executing — retryable)
```

## Execution Steps

The auto skill runs this loop within a single Claude session:

1. Read .status.json → derive phase (status-based routing). For `draft` status: also read `.target.md` to detect `## Research Insights` presence and `[PROPOSED]` residuals before routing
2. LOOP:
   2.1. Check for .auto-stop file → if exists, break loop
   2.2. Context check: if context window usage ≥ 82% AND `compaction_count == 0`, construct and send **Structured Compaction Prompt** (see template below). Increment `compaction_count`. (Only the first compaction is active — see Compaction frequency limit)
   2.3. Execute current step — read target SKILL.md metadata (`model_tier`, `auto_delegatable`):
      - Evaluate four delegation factors (phase, context dependency, complexity, execution history)
      - **If delegatable**: Invoke via Task subagent with `model = tier_to_model(model_tier)`. Subagent receives SKILL.md + `.summary.md` + `.status.json` + input files. On completion, read output files. On failure/timeout → fallback to inline
      - **If not delegatable**: Execute inline (Read SKILL.md steps, execute in main session)
      — In both paths, SKIP the sub-command's own .auto-signal write step (auto loop handles it at step 2.5)
   2.4. Evaluate result → determine next step (result-based routing)
   2.5. Write .auto-signal (progress report for daemon, WITH iteration, phase, retry_count, delegation_failures fields)
   2.6. Increment iteration counter
   2.7. If next == "(stop)" → break loop
   2.8. Set current step = next step → continue loop
3. Post-loop maintenance: run `maintain.sh --scheduled` (timestamp-gated, skips if < 24h since last run — zero overhead in most cases)
4. Cleanup: delete .auto-signal and .auto-stop if exist, report final status

## Detailed Loop Logic

### Entry Point (Status-Based Routing)

| Current Status | First Step |
|----------------|-----------|
| `draft` | Validate `.target.md` has substantive content → if empty, stop and report "fill `.target.md` first". Then check structural markers: **if `[PROPOSED]` markers present** → PAUSE with "Pending `[PROPOSED]` items — review and confirm before continuing"; **if `## Research Insights` section absent/incomplete** → run `research --caller target --phase objective`; **if requirements present and no `[PROPOSED]` residuals** → execute plan |
| `planning` | Execute verify → check (post-plan) |
| `review` | Execute exec |
| `executing` | Execute verify → check (post-exec). **Note**: even if `completed_steps` < total, auto enters via post-exec verification first — check detects incomplete work and routes back to exec via NEEDS_FIX |
| `re-planning` | Read `phase` field: if `needs-plan` → execute plan; if `needs-check` → execute verify → check (post-plan); if empty → default to plan |
| `stage-done` | Execute highlight(complete) → report → stop. Output stage completion message with next-stage instructions |
| `complete` | Execute report, then stop |
| `blocked` | Stop loop, report blocking reason |
| `cancelled` | Stop loop |

### Result-Based Routing

| step | result | next | checkpoint | Rationale |
|------|--------|------|------------|-----------|
| check | PASS | exec | post-plan | Plan approved, proceed to execution |
| check | PASS | merge | pre-merge | Pre-merge check passed, proceed to merge |
| check | NEEDS_REVISION | plan | — | Plan needs revision |
| check | ACCEPT | merge | — | Task verified, merge to main |
| check | NEEDS_FIX | exec | mid-exec / post-exec | Minor issues, re-execute to fix |
| check | REPLAN | plan | — | Fundamental issues, revise plan |
| check | BLOCKED | (stop) | — | Cannot continue |
| check | CONTINUE | exec | mid-exec | Progress OK, resume execution |
| plan | (generated) | verify | post-plan | Plan ready, verify before assessment |
| exec | (done) | verify | post-exec | All steps completed, verify before assessment |
| exec | (mid-exec) | verify | mid-exec | Significant issue, verify before checkpoint |
| exec | (step-N) | verify | mid-exec | Single step completed (manual `--step N` only) |
| exec | (blocked) | (stop) | — | Cannot continue |
| merge | success | highlight | — | Merge complete, distill experience |
| merge | stage-done | highlight | — | Stage complete, distill stage experience |
| merge | conflict | (stop) | — | Merge conflict unresolvable |
| merge | rejected | (stop) | dependency-blocked / no-accept | Prerequisite not met |
| highlight | (distilled) | report | — | Distillation complete |
| highlight | (skipped-idempotent) | report | — | No new content |
| highlight | failed | report | — | Distillation failed (non-blocking) |
| research | (collected) | `<caller>` | post-research | References collected, resume calling phase |
| research | (sufficient) | `<caller>` | post-research | References sufficient |
| research | (o1-collected) | (stop) | post-o1 | O1 done, wait for user confirmation |
| research | (o2-collected) | (stop) | post-o2 | O2 done, wait for user confirmation |
| research | (o3-collected) | (stop) | post-o3 | O3 done, wait for user confirmation |
| research | (objective-complete) | (stop) | — | All O-stages confirmed |
| verify | (pass) | check | (from trigger context) | Verification done, check renders verdict |
| verify | (fail) | check | (from trigger context) | Verification done, check renders verdict |
| verify | (partial) | check | (from trigger context) | Verification done, check renders verdict |
| annotate | (processed) | `<by-layer>` | post-annotate | Layer-based: Requirement→plan/check, Planning→check, Eval-analysis→check, Eval-test→verify, Methodology→verify, Information/Comment-only→(none). See annotate SKILL.md §.auto-signal Routing |
| report | (generated) | (stop) | — | Loop complete |

### Context Advantage

Because all steps run in one session, Claude naturally retains:
- Plan decisions and trade-offs from planning phase
- Check feedback and evaluation rationale
- Implementation details and workarounds from execution
- Error context from previous fix attempts

The `.summary.md` file is still written by each sub-command as a **compaction safety net**. During normal auto execution, live conversation context is the primary source of truth.

## Stall Detection & Recovery

Claude may stall mid-execution. The daemon detects stalls at two levels: (1) **time-based** — heartbeat polling (60s interval, 3 consecutive idle heartbeats = suspected stall) with pattern matching recovery; (2) **content-based** — output deduplication (3 identical consecutive messages = reasoning loop) and single-step timeout (no `.auto-signal` update for 10 minutes). Recovery limits: 3 per step, 10 total.

> **See `references/stall-detection.md`** for the full heartbeat polling logic, stall determination rules, pattern matching recovery table, and recovery limits.

## Context Window Management & Quota Handling

Proactive **structured compaction** prevents overflow. Strategy: **single active compaction + file-based recovery**:

1. **First compaction at ≥ 82%**: Send the Structured Compaction Prompt (template below)
2. **No subsequent active compaction**: After first, rely on `.summary.md` + `.auto-signal` + `.status.json` for recovery
3. **Daemon detection**: If Claude's system compaction is detected, daemon sends recovery signal

#### Structured Compaction Prompt Template

When context ≥ 82% AND `compaction_count == 0`, fill and send:

```
Summarize and compress our conversation context for continuation. Task identity and loop position will be recovered from files — preserve ONLY the following conversation-exclusive context:

## Plan Progress
- Completed this iteration: {list of sub-commands completed in current iteration, in order}
- Remaining: {list of upcoming sub-commands per routing table}

## Execution State
- Files modified: {key files touched in this iteration}
- Test status: {last known pass/fail/pending}
- Blockers: {any active blockers or "none"}

## Key Decisions
{2-5 bullet points: architectural choices, trade-offs made, rejection rationale — the "why" behind actions taken. This is the highest-value section}

## Error Context
{Active NEEDS_FIX/NEEDS_REVISION feedback, or "none". Include the specific fix guidance if present}

Discard all other conversation detail. Task identity, iteration count, and file paths are recovered from .auto-signal / .status.json / .summary.md during the recovery protocol.
```

**Compaction frequency limit**: If 3+ compactions within same iteration → stop with warning: "context budget insufficient for this task — consider breaking into smaller sub-tasks". Count tracked in `.auto-signal` `compaction_count` field.

**Compaction recovery**: If context compaction occurs mid-loop:
1. Read `.auto-signal` — `iteration`, `compaction_count`, `step`, `next` for position recovery. If missing: fall back to step 2, start iteration/compaction from 0
2. Read `.status.json` — status confirms lifecycle phase
3. Read `.summary.md` — condensed task context
4. Resume loop from `next` step at `iteration + 1`. Increment `compaction_count` by 1

**Milestone summarize**: auto calls summarize at key milestones (phase transitions, check completions) to keep `.summary.md` fresh for compaction recovery.

> **See `references/context-quota.md`** for the full context management strategy, quota exhaustion handling, and SQLite `quota_wait_since` extension.

## VFP Cycle Tracking (Software Types)

When `type` contains `software`, the auto loop tracks VH→HS cycle progress during Phase 3 (Execution):

1. **Initialization**: After plan generates VH stubs, read vh-baseline.md. Set `vfp_cycles_completed = 0`
2. **Per-step tracking**: After each exec step, check for VH→HS transition. If yes, increment `vfp_cycles_completed` and include in `.auto-signal`. Append to cumulative-green.jsonl
3. **Anomaly detection**: If 3+ steps without VH→HS transition, trigger `check --checkpoint mid-exec` with note: "VFP anomaly: N steps without VH→HS transition — verify test discipline"
4. **Progress display**: Daemon can display VFP progress as `vfp_cycles_completed / vh_stubs_total`

## Backend Infrastructure

> **See `references/backend-api.md`** for REST API endpoints, SQLite schema, daemon startup sequence, frontend integration, cleanup protocol, and server recovery.

## Safety

- **Max iterations**: user-configurable (default 20), daemon writes `.auto-stop` when reached
- **Timeout**: user-configurable (default 30 min), daemon writes `.auto-stop` when elapsed
- **Stall detection**: heartbeat polling (60s) + pattern matching recovery, with per-step (3) and total (10) recovery limits
- **Context management**: proactive structured compaction at ≥ 82% context window usage
- **Quota exhaustion**: detected and handled as wait (not stall), timeout clock paused during quota-wait
- **Pause on blocked**: Auto stops immediately on `blocked` status
- **Manual override**: User can `/task-ai:auto --stop` or daemon writes `.auto-stop` via `DELETE` API
- **Graceful stop**: Claude checks for `.auto-stop` before each iteration
- **Single instance**: enforced by SQLite constraints (see `references/backend-api.md`)

## Cleanup (agent-side)

At loop exit:
1. Delete `.auto-signal` file if exists
2. Delete `.auto-stop` file if exists

Daemon-side cleanup details in `references/backend-api.md`.

## Git

Auto mode inherits git behavior from each sub-command. No additional git commits by auto itself — each plan, check, exec, merge, report handles its own commits on the task branch.

## Notes

- Auto mode starts by entering `/task-ai:auto` in the prompt input window (notebook is auto-detected from CWD or git branch context)
- Daemon's only active intervention is writing `.auto-stop`; all other activity is passive monitoring
- `.auto-signal` and `.auto-stop` are transient files — should be in `.gitignore`
- **Known trade-off**: First entry on `executing` status always runs verify → check (post-exec). If execution was incomplete, check routes back via NEEDS_FIX, adding one extra iteration
- **Plugin delegation**: External plugin delegation works naturally. Skills invoke plugins via Task tool, creating isolated subagents
- **Self-service bias**: check evaluates its own LLM output — structural bias toward high scores. v1 mitigates via three-file anchored review. Future: external verification signals (coverage, lint, user feedback) as score calibration
