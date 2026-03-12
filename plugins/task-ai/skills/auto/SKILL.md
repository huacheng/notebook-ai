---
name: auto
description: "Conversational task lifecycle automation — drives four phases (target definition → planning → execution → acceptance review) with automatic D1-D6 quality gates and subagent delegation. Use when the user wants hands-off end-to-end task execution, says 'auto', 'run it automatically', or wants the full lifecycle without manual step-by-step control."
model_tier: heavy
auto_delegatable: false
triggers:
  keywords:
    zh: [自动, 全自动, 自动跑, 自动执行, 一键, 跑全流程, 继续, 开始auto, auto开始, 开启auto, 启动auto]
    en: [auto, autopilot, run automatically, hands-off, full cycle, end to end, continue, start auto, go auto]
  phrases:
    zh: [自动跑一遍, 全自动执行, 一键跑完, 从头到尾自动, 停止自动, 继续执行, auto 开始, 开始 auto, 开启 auto, 启动 auto, 开始自动]
    en: [run it automatically, start autopilot, run the full cycle, hands-off execution, stop auto, start auto mode]
  disambiguate: >
    Core intent: orchestrate the entire task lifecycle through conversation.
    Notebook existence IS the context — no "auto mode" activation needed.
    User wants FULL lifecycle → auto.
    User wants ONE step manually → exec. User wants just the plan → plan.
arguments:
  - name: action
    description: "Action: run (default, execute immediately), load (load spec only), stop"
    required: false
    default: run
---

# /task-ai:auto — Conversational Task Lifecycle

Dialog-driven four-phase flow: Target → Planning → Execution → Acceptance. Claude reads state files to determine the current phase and acts accordingly.

## Action Routing

| Action | Behavior |
|--------|----------|
| `run` (default) | **Execute immediately** — read `.status.json`, derive phase, start execution loop |
| `load` | **Load spec only** — do NOT execute, wait for user to say "run" or "启动" |
| `stop` | Stop current execution loop |

**On `/task-ai:auto` or `/task-ai:auto run`**: START EXECUTING IMMEDIATELY. Read `.status.json` → derive phase → execute phase-appropriate action → continue cycling until `satisfied` or user interrupts.

## Core Principle

Notebook existence IS the context. Claude reads `.status.json` + `.target.md` each conversation turn, derives the current phase, and executes the appropriate action. User dialog directly drives phase progression.

> **Path Rule**: All system files (`.status.json`, `.target.md`, `.plan.md`, `.analysis/`, etc.) are in `$TASKAI_WORK_DIR/` (= `$NB_WORK_DIR/.working/`), NOT in `$NB_WORK_DIR/` directly. See `commands/task-ai.md` §System File Path Rule.

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
/task-ai:auto              # Execute immediately (default: run)
/task-ai:auto run          # Execute immediately
/task-ai:auto load         # Load spec only, wait for user trigger
/task-ai:auto stop         # Stop execution loop
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
| `evolving` | `acceptance` | Stage accepted, distill + report |
| `satisfied` | `acceptance` | User satisfied, final report |
| `cancelled` | — (terminal) | Loop stops immediately, no phase |

### Threshold & Retry Limits — Adaptive

Thresholds and retry limits are **adaptive**: read from `.type-profile.md` `## Auto Adaptation` section if present, with hardcoded defaults as fallback when `.type-profile.md` is absent or lacks the section.

**Resolution order**: `.type-profile.md` Auto Adaptation → fallback defaults (table below).

| Checkpoint | Fallback Threshold | Fallback Retry Limit | On Limit Exceeded |
|------------|-------------------|---------------------|-------------------|
| post-plan (Phase 2) | 0.70 | 3 replans | Stop, notify user: "Plan repeatedly failed review, manual intervention needed" |
| mid-exec (Phase 3 mid) | 0.60 | 2 fixes | Stop current step, notify user |
| post-exec (Phase 3 done) | 0.75 | 3 fix/replan | Stop, notify user |

**Adaptive threshold examples** (from `.type-profile.md` Auto Adaptation):
- Simple bugfix task → lower thresholds (post-plan 0.60, post-exec 0.65), fewer retries (post-plan 2)
- Complex architecture redesign → higher thresholds (post-plan 0.75, post-exec 0.80), more retries (post-exec 4)
- Data pipeline task → verify-heavy profile (mid-exec threshold 0.70, more mid-exec retries)

`retry_count` is an in-memory counter. Resets to 0 on phase transition. `delegation_failures` clears on phase transition (new phase = new context).

> **check runtime errors:** If check itself fails (file read error, state.py exception — not low score), it does NOT count toward retry_count. Stop immediately, await user intervention. Only normal execution with score below threshold triggers retry.

### Four-File Anchored Review

check evaluates deliverables against `.target.md`, `.convergence-baseline.md`, and `.plan.md` per D1-D6 dimension. See `check/SKILL.md` §Four-File Anchored Review for the full dimension-anchor mapping table.

> **See `references/phases.md`** for detailed phase flow (Phase 1-4), evolving entry decision, and satisfied re-entry.

## Dialog Behavior

### Dialog IS Action (No Router)

No intent classification or rule matching. Claude reads current phase SKILL.md + user message, acts through semantic understanding — like a pair programming partner.

Phase 1 (Overall Objective) — waits for user confirmation (only users can validate objectives — LLM self-confirmation creates coherence bias):

| User says | Claude does |
|-----------|------------|
| "I need WebSocket auth with token refresh" | Write/update .target.md |
| "Also needs backward compatibility" | Append requirement to .target.md |
| "Help me research this area" | Execute research full flow (O1→O2→O3 in one pass), present results |
| "OK looks good" / "Confirmed" | Write .target.md + .convergence-baseline.md → auto-generate Stage 1 target → Phase 2 |
| Silence | **Do not advance** — wait for user confirmation |

Phases 2-4 — full auto, user can intervene:

| User says | Claude does |
|-----------|------------|
| "Skip step 3" | Adjust plan/execution, re-check |
| "What does this error mean?" | Explain + fix, continue |
| "Run tests again" | Trigger verify |
| "Continue" / Silence | Continue next step |

### Explicit Override (Sub-command)

User can override via dialog (`/task-ai:check`) or frontend toolbar button — both semantically equivalent.

Behavior:
1. auto yields control (after current step completes, not mid-step)
2. Sub-command executes full flow independently
3. Sub-command updates `.status.json`
4. auto reads latest state on next trigger (user message / daemon continuation)
5. auto re-routes from new state

> **See `references/refinement-buffer.md`** for the pending refinement buffer mechanism, two-level processing, and impact assessment.

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
│    ├→ execute rollback logic (if needed)─┘       │
│    └→ execute report logic                      │
│                                                 │
│  writes .status.json ──→ (state update)          │
│  reads  .auto-stop   ──→ (stop request)          │
└─────────────────────────────────────────────────┘
         │                          ▲
         ▼                          │
┌─────────────────┐     ┌──────────┴──────────┐
│  .status.json   │     │  Backend Daemon      │
│  (state)        │────▶│  - monitors progress │
│                 │     │  - enforces timeout   │
│  .auto-stop     │◀────│  - writes stop file   │
│  (stop request) │     │  - stall detection    │
└─────────────────┘     └─────────────────────┘
```

> **See `references/delegation.md`** for subagent delegation details, including judgment factors, per-tier sub-command tables, fault tolerance, and context savings.

## Session Recovery

User returns and says "continue":

1. Read `.status.json` → status, stage
2. Read `.summary.md` → context summary
   - If `.summary.md` absent → read `.target.md` + `.plan.md` to rebuild minimal context
4. Resume from interruption point

### Cross-Stage Continuation

When status is `evolving` with convergence < 0.95, auto automatically generates the next sub-stage target and proceeds to planning without waiting. When convergence ≥ 0.95, auto reports and waits for user input — user can `/task-ai:target --satisfy` or provide new direction (which triggers satisfied → evolving → auto-generate sub-stage → planning).

### "Silent Continue" Mechanism

Claude Code is request-response. Phases 2-4 "auto-advance without intervention" means:
- **Within same turn**: Claude finishes one sub-command, continues to next without waiting (continuous execution within single request)
- **Across turns**: User must say "continue" or any message to trigger next round
- Backend daemon can trigger: detects step complete with no follow-up → sends continuation prompt
- **Race protection**: daemon checks `.status.json` `updated_at` hasn't changed (CAS) before sending continuation. If changed (user already triggered), abort to prevent double-trigger

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

Phase 1: Overall Objective (human-in-loop)
  Conversational refine → LLM decides research (skip / O1→O2→O3 in one pass)
  After confirmation write .target.md + .convergence-baseline.md → auto-generate Stage 1 target → [Phase 2]

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

Phase 4: Acceptance + Auto Advance (auto)
  check(post-exec, D1-D6, threshold=0.75) ─── ACCEPT ──→ convergence gate
            │                                                │
            NEEDS_FIX ──→ exec(fix) → re-check (max 3)     ├─ convergence > previous ──→ ACCEPT
            │                                                │   status → evolving → highlight → report → evolving entry decision
            Max exceeded ──→ rollback → re-planning         │
                                                             └─ convergence ≤ previous ──→ ROLLBACK
                                                                 highlight records failure → exclusion list → regenerate sub-stage target → Phase 2
                                                                 (all directions exhausted → stop and report to user)

  Entry on evolving:
    convergence >= 0.95 → report + wait for user (--satisfy or refine)
    convergence < 0.95 → auto-generate next sub-stage target → planning → Phase 2
  Entry on satisfied: report completion status; user refine → evolving → auto-generate sub-stage → planning

Terminal: BLOCKED at any check → (stop, status → blocked)
```

## Execution Steps

The auto skill runs this loop within a single Claude session:

1. Read .status.json → derive phase (status-based routing). For `draft` status: also read `.target.md` to assess objective clarity and determine if research is needed
1a. **Load adaptive parameters**: Read `.type-profile.md` `## Auto Adaptation` section. Extract `thresholds`, `retry_limits`, `mid_exec_check_interval`, and `compaction_threshold`. If `.type-profile.md` is absent or lacks the section → use fallback defaults (thresholds from table above, check interval = 3, compaction = 82%)
1b. **Compute audit budget**: Before each check invocation, compute the adaptive D1-D6 evaluation round budget based on change scope. Run:
   ```bash
   git diff --stat <baseline-commit> HEAD | python3 core/audit_budget.py from-diff - --type <task-type>
   ```
   This returns `max_rounds` (2-10) based on: `clamp(ceil(files/5) + ceil(lines/200) + ceil(dirs/3) + type_bonus, 2, 10)`. Pass `max_rounds` to check as context for multi-round evaluation. Between rounds, call:
   ```bash
   python3 core/audit_budget.py should-stop --round <N> --max <max_rounds> --consecutive-pass <count> --files <files> [--round1-all-pass]
   ```
   Early termination: 2 consecutive PASS (zero fixes) → stop. All gates PASS on round 1 AND files ≤ 3 → stop after round 1.
2. LOOP:
   2.1. Check for .auto-stop file → if exists, break loop
   2.2. Context check: if context window usage ≥ `compaction_threshold` (adaptive from `.type-profile.md`, fallback 82%) AND `compaction_count == 0`, construct and send **Structured Compaction Prompt** (see template below). Increment `compaction_count`. (Only the first compaction is active — see Compaction frequency limit)
   2.3. Execute current step — read target SKILL.md metadata (`model_tier`, `auto_delegatable`):
      - Evaluate four delegation factors (phase, context dependency, complexity, execution history)
      - **If delegatable**: Invoke via Task subagent with `model = tier_to_model(model_tier)`. Subagent receives SKILL.md + `.summary.md` + `.status.json` + input files. On completion, read output files. On failure/timeout → fallback to inline
      - **If not delegatable**: Execute inline (Read SKILL.md steps, execute in main session)
   2.4. Evaluate result → determine next step (result-based routing)
   2.5. Increment iteration counter
   2.6. If next == "(stop)" → break loop
   2.7. Set current step = next step → continue loop
3. **Post-loop learning**: Write execution metrics back to `.type-profile.md` `## Auto Adaptation` section — actual retries used per checkpoint, total iterations, mid-exec checks triggered, compaction count, phase durations. This enables future tasks of the same type to use refined thresholds. If `.type-profile.md` lacks `## Auto Adaptation`, create the section with observed metrics. Sync updated profile to `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/<type>.md` (same write protocol as research — acquire `.type-profiles/.lock`)
4. Post-loop maintenance: run `maintain.sh --scheduled` (timestamp-gated, skips if < 24h since last run — zero overhead in most cases)
5. Cleanup: delete .auto-stop if exists, report final status

> **See `references/loop-logic.md`** for detailed loop logic, including entry point (status-based routing), result-based routing, evolving entry decision, post-ROLLBACK regeneration, and context advantage.

## Stall Detection & Recovery

Claude may stall mid-execution. The daemon detects stalls at two levels: (1) **time-based** — heartbeat polling (60s interval, 3 consecutive idle heartbeats = suspected stall) with pattern matching recovery; (2) **content-based** — output deduplication (3 identical consecutive messages = reasoning loop) and single-step timeout (no `.status.json` update for 10 minutes). Recovery limits: 3 per step, 10 total.

> **See `references/stall-detection.md`** for the full heartbeat polling logic, stall determination rules, pattern matching recovery table, and recovery limits.

## Context Window Management & Quota Handling

Proactive **structured compaction** prevents overflow. Strategy: **single active compaction + file-based recovery**:

Compaction threshold is adaptive based on task complexity from `.type-profile.md` Auto Adaptation:
- Simple tasks (few steps, low retry history) → higher threshold (85-90%) — more context budget available
- Complex tasks (many steps, high retry history) → lower threshold (75-80%) — reserve headroom for fix cycles
- Fallback default: 82%

1. **First compaction at ≥ compaction_threshold**: Send the Structured Compaction Prompt (template below)
2. **No subsequent active compaction**: After first, rely on `.summary.md` + `.status.json` for recovery
3. **Daemon detection**: If Claude's system compaction is detected, daemon sends recovery signal

#### Structured Compaction Prompt Template

When context ≥ `compaction_threshold` (adaptive, fallback 82%) AND `compaction_count == 0`, fill and send:

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

Discard all other conversation detail. Task identity, iteration count, and file paths are recovered from .status.json / .summary.md during the recovery protocol.
```

**Compaction frequency limit**: If 3+ compactions within same iteration → stop with warning: "context budget insufficient for this task — consider breaking into smaller sub-tasks". Count tracked in-memory.

**Compaction recovery**: If context compaction occurs mid-loop:
1. Read `.status.json` — status confirms lifecycle phase, recover position
2. Read `.summary.md` — condensed task context
3. Resume loop from current phase entry point. Increment in-memory `compaction_count` by 1

**Milestone summarize**: auto calls summarize at key milestones (phase transitions, check completions) to keep `.summary.md` fresh for compaction recovery.

> **See `references/context-quota.md`** for the full context management strategy, quota exhaustion handling, and SQLite `quota_wait_since` extension.

## VFP Cycle Tracking (Software Types)

When `type` contains `software`, the auto loop tracks VH→HS cycle progress during Phase 3 (Execution):

1. **Initialization**: After plan generates VH stubs, read vh-baseline.md. Set `vfp_cycles_completed = 0`
2. **Per-step tracking**: After each exec step, check for VH→HS transition. If yes, increment in-memory `vfp_cycles_completed`. Append to cumulative-green.jsonl
3. **Anomaly detection**: If 3+ steps without VH→HS transition, trigger `check --checkpoint mid-exec` with note: "VFP anomaly: N steps without VH→HS transition — verify test discipline"
4. **Progress display**: Daemon can display VFP progress as `vfp_cycles_completed / vh_stubs_total`

## Backend Infrastructure

> **See `references/backend-api.md`** for REST API endpoints, SQLite schema, daemon startup sequence, frontend integration, cleanup protocol, and server recovery.

## Safety

- **Max iterations**: user-configurable (default 20), daemon writes `.auto-stop` when reached
- **Timeout**: user-configurable (default 30 min), daemon writes `.auto-stop` when elapsed
- **Stall detection**: heartbeat polling (60s) + pattern matching recovery, with per-step (3) and total (10) recovery limits
- **Context management**: proactive structured compaction at adaptive threshold (fallback ≥ 82% context window usage)
- **Quota exhaustion**: detected and handled as wait (not stall), timeout clock paused during quota-wait
- **Pause on blocked**: Auto stops immediately on `blocked` status
- **Manual override**: User can `/task-ai:auto --stop` or daemon writes `.auto-stop` via `DELETE` API
- **Graceful stop**: Claude checks for `.auto-stop` before each iteration
- **Single instance**: enforced by SQLite constraints (see `references/backend-api.md`)

## Cleanup (agent-side)

At loop exit:
1. Delete `.auto-stop` file if exists

Daemon-side cleanup details in `references/backend-api.md`.

## Git

Auto mode inherits git behavior from each sub-command. No additional git commits by auto itself — each plan, check, exec, highlight, report handles its own commits on the task branch. Rollback uses `git reset --hard` to revert to the previous stage commit.

## Notes

- Auto mode starts by entering `/task-ai:auto` or `/task-ai:auto run` in the prompt input window — both execute immediately (notebook is auto-detected from CWD or git branch context)
- Daemon's only active intervention is writing `.auto-stop`; all other activity is passive monitoring
- `.auto-stop` is a transient file — should be in `.gitignore`
- **Known trade-off**: First entry on `executing` status always runs verify → check (post-exec). If execution was incomplete, check routes back via NEEDS_FIX, adding one extra iteration
- **Plugin delegation**: External plugin delegation works naturally. Skills invoke plugins via Task tool, creating isolated subagents
- **Self-service bias**: check evaluates its own LLM output — structural bias toward high scores. v1 mitigates via four-file anchored review. Future: external verification signals (coverage, lint, user feedback) as score calibration
- **No merge in Phase 4**: v2 removes merge from the auto loop. Phase 4 uses D1-D6 acceptance + convergence gate instead. Rollback replaces merge conflict handling
