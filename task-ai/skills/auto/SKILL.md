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
    description: "Action: start or stop"
    required: false
    default: start
---

# /task-ai:auto — Conversational Task Lifecycle

Dialog-driven four-phase flow: Target → Planning → Execution → Acceptance. Claude reads state files to determine the current phase and acts accordingly. No "auto mode" to activate — notebook existence IS the context.

## Core Principle

**No auto mode to activate.** Notebook existence IS the context. Claude reads `.status.json` + `.target.md` each conversation turn, derives the current phase, and executes the appropriate action. User dialog directly drives phase progression.

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

### Detailed Phase Flow

```
Phase 1: Overall Objective (status=draft) — Human in the loop
  1. 对话式 refine：引导用户定义 Overall Objective
     - .target.md 显示 `## Overall Objective [DRAFT]`（目标还在讨论中）
  2. Research（LLM 自决）：
     - 目标清晰、领域熟悉 → 跳过 research
     - 目标模糊或领域陌生 → 自动完成 research 全流程（O1→O2→O3 一次性完成），呈现结果
     - 用户可主动要求 research
  3. 用户确认后：
     - 更新 .target.md：`[DRAFT]` → `[PENDING]`（目标已确定，等待执行）
     - 生成 .convergence-baseline.md
  4. 自动生成 Stage 1 目标：
     - .target.md：`[PENDING]` 移除，添加 `## Stage 1: <name> [ACTIVE]`
     - status → planning

Phase 2: Planning (status=planning) — Full auto + user can intervene
  - Optional: research for technical references (implementation-level, not objective research)
  - Execute plan → verify(post-plan) → check(post-plan) (no code output — verify validates plan document quality)
  - check D1-D6 ≥ 0.70 → auto-advance to Phase 3
  - score < threshold → auto-replan based on failing dimensions → re-check
  - User can intervene: "step 3 unnecessary" → modify .plan.md, re-check

Phase 3: Execution (status=executing) — Full auto + user can intervene
  - All non-system output (code, configs, assets) goes to `<notebook>/.deliverables/` (merge only copies this directory — anything outside it won't reach main branch)
  - Execute exec step by step
  - Key checkpoints trigger verify → check(mid-exec): significant issues, or every N steps (N from `.type-profile.md` Auto Adaptation `mid-exec check interval`, fallback 3)
  - All steps done → verify → check(post-exec)
  - check score ≥ threshold → continue/advance to Phase 4
  - score < threshold → auto-fix based on failing dimensions → re-verify + re-check
  - Exceeds retry limit → stop, notify user
  - User can intervene: "what does this error mean?" → explain + fix, continue

Phase 4: Acceptance + 自动推进 (status=executing→evolving) — Full auto
  - Step 1: check(post-exec, D1-D6, threshold=0.75)
    ├─ ACCEPT → Step 2 (convergence gate)
    ├─ NEEDS_FIX → exec(fix) → re-check (max 3)
    └─ Max exceeded → rollback → re-planning

  - Step 2: Convergence gate (within check)
    - check evaluates convergence score vs previous baseline
    ├─ convergence > previous → ACCEPT
    │   auto sets status → evolving → highlight → report → evolving 入口决策
    └─ convergence ≤ previous → ROLLBACK

  No merge. No pre-merge check.

  ### evolving 入口决策

  1. 读取最新 convergence score（从 `.analysis/*-convergence.md`）
  2. **convergence ≥ 0.95**:
     - 报告："convergence {score}，目标基本达成。如满意: /task-ai:target --satisfy；如需继续: 告诉我还需要什么"
     - 等用户响应（不自动推进）
  3. **convergence < 0.95**:
     - 自动生成下一子阶段目标：
       a. 收集输入：未满足 R#（cᵢ < 1.0）、覆盖度趋势、已完成成果、失败排除清单、交付物状态
       b. LLM 推理：聚类 R#、选择子集（优先 critical + 低覆盖度）、对照排除清单、粒度控制
       c. 调用 target 写入新 Stage → .target.md
       d. 自动进入 Phase 2 (Planning)

  ### satisfied 重入

  用户在 satisfied 状态发起 refine（"还需要 X"）：
  1. status: satisfied → evolving
  2. 更新 .target.md Overall Objective
  3. 更新 .convergence-baseline.md（新增/修改 R#）
  4. convergence 因新 R# 下降
  5. 自动生成下一子阶段目标 → planning → Phase 2
```

## Dialog Behavior

### Dialog IS Action (No Router)

No intent classification or rule matching. Claude reads current phase SKILL.md + user message, acts through semantic understanding — like a pair programming partner.

Phase 1 (Overall Objective) — waits for user confirmation (only users can validate objectives — LLM self-confirmation creates coherence bias):

| User says | Claude does |
|-----------|------------|
| "I need WebSocket auth with token refresh" | Write/update .target.md |
| "Also needs backward compatibility" | Append requirement to .target.md |
| "Help me research this area" | 执行 research 全流程（O1→O2→O3 一次性完成），呈现结果 |
| "OK looks good" / "Confirmed" | 写入 .target.md + .convergence-baseline.md → 自动生成 Stage 1 目标 → Phase 2 |
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

## Pending Refinement Buffer

User messages arriving during auto execution are semantically classified:

| User says | Category | auto behavior |
|-----------|----------|---------------|
| "增加 OAuth 支持" | refinement | Write to buffer → confirm → continue |
| "这个错误什么意思？" | question | Answer → continue |
| "跳过步骤 3" | directive | Adjust → continue |
| "继续" | continue | Continue |

### Buffer File

Path: `.working/.pending-refinements.md` (git tracked)

```markdown
- [2026-03-08 14:05] 增加 OAuth Google 登录支持
- [2026-03-08 14:12] 登录失败限流从5次改为10次
```

Each write is committed: `git add .working/.pending-refinements.md && git commit -m "auto: buffer refinement"`.

### Two-Level Processing

**Level 1 — Inter-step quick check** (between exec steps):
```
if .pending-refinements.md exists and non-empty:
    Scan each item → annotate impact scope (which R#)
    if affects currently executing step:
        mark needs_reassess = true (trigger mid-exec check after current step)
    else:
        continue (leave to checkpoint batch processing)
```

**Level 2 — Checkpoint batch processing** (at mid-exec / post-exec check):
```
if .pending-refinements.md exists and non-empty:
    1. Call target --refine "..." for each item
    2. Update .convergence-baseline.md (add/modify R#, adjust weights)
    3. Impact assessment:
       - Pure addition (new R# doesn't affect completed steps) → append to plan tail, continue
       - Modify existing R# (weight/content change) → NEEDS_FIX or REPLAN
    4. Clear buffer
```

### Impact Assessment Levels

| Level | Judgment | Action |
|-------|----------|--------|
| None | New R# unrelated to current/completed steps | Append plan steps, continue |
| Minor | Modified optional R# detail | Mark, handle at post-exec |
| Moderate | Modified important R# | Trigger mid-exec check |
| Major | Modified critical R# or Overall Objective | REPLAN |

### Confirm/Withdraw

User can withdraw a buffered refinement before it is processed:
- "取消刚才的 OAuth 需求" → remove matching entry from buffer, confirm removal
- Already processed (buffer cleared at checkpoint) → inform user it was already applied

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

## Subagent Delegation

### Dynamic Judgment (Not Static)

SKILL.md `auto_delegatable` and `model_tier` are **default hints**. Actual delegation decisions are made dynamically by the auto main session based on context.

#### Judgment Factors & Signal Sources

| Factor | Signal Source | Logic | Example |
|--------|-------------|-------|---------|
| **Current phase** | `.status.json` status | Different status → different delegation strategy for same sub-command | status=draft: research NOT delegated (O1/O2/O3 need dialog); status=planning: research CAN delegate |
| **Context dependency** | (1) Unpersisted decisions in dialog (2) `.summary.md` freshness (3) `git diff --stat` from prior steps | High dependency → don't delegate | exec just refactored 5 files + dialog tradeoffs → verify inline; exec changed 1 file + no discussion → verify can delegate |
| **Task complexity** | (1) `.plan.md` step description length + file count (2) Test type (unit/integration/e2e) (3) `.target.md` complexity markers | Simple → light tier; Complex → medium/heavy | verify runs lint → haiku; verify runs e2e → sonnet |
| **Execution history** | In-memory `delegation_failures` array | Same sub-command failed as subagent before → inline from now on | `delegation_failures: ["verify@iter3"]` → verify never delegates again |

#### Sub-command Default Hints & Dynamic Overrides

**heavy (→ opus)**

| Sub-command | Default delegatable | Default tier | Dynamic override |
|-------------|-------------------|-------------|-----------------|
| auto | — | heavy | Main session itself |
| target | false | heavy | Always inline (dialog interaction) |
| research | true | heavy | target phase O1/O2/O3 → inline (needs dialog); planning phase reference collection → can delegate |
| plan | false | heavy | Always inline (needs decision context) |
| check | false | heavy | Always inline (needs global context for four-file anchored review) |
| exec | false | heavy | Always inline (step-by-step needs main session context) |
| security | true | heavy | Usually can delegate; context-dependent security analysis → inline |

**medium (→ sonnet)**

| Sub-command | Default delegatable | Default tier | Dynamic override |
|-------------|-------------------|-------------|-----------------|
| verify | true | medium | exec has complex context dependency → inline; simple lint → tier down to light |
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
Full inline:    target(dialog) + plan + check + exec + verify*N + check*N + highlight + report
                → main session context grows continuously, may trigger multiple compactions

Delegation:     target(dialog) + plan + check + exec + [verify→subagent] + check + [highlight→subagent] + [report→subagent]
                → main session keeps only decision path, delegated output flows back as summaries
```

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
  对话式 refine → LLM 自决 research（跳过 / O1→O2→O3 一次性完成）
  确认后写入 .target.md + .convergence-baseline.md → 自动生成 Stage 1 目标 → [Phase 2]

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

Phase 4: Acceptance + 自動推進 (auto)
  check(post-exec, D1-D6, threshold=0.75) ─── ACCEPT ──→ convergence gate
            │                                                │
            NEEDS_FIX ──→ exec(fix) → re-check (max 3)     ├─ convergence > previous ──→ ACCEPT
            │                                                │   status → evolving → highlight → report → evolving 入口決策
            Max exceeded ──→ rollback → re-planning         │
                                                             └─ convergence ≤ previous ──→ ROLLBACK
                                                                 highlight 记录失败 → 排除清单 → 重新生成子阶段目标 → Phase 2
                                                                 （所有方向穷尽 → 停下报告用户）

  Entry on evolving:
    convergence ≥ 0.95 → 报告 + 等用户（--satisfy 或 refine）
    convergence < 0.95 → 自动生成下一子阶段目标 → planning → Phase 2
  Entry on satisfied: 报告完成状态；用户 refine → evolving → 自动生成子阶段 → planning

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

## Detailed Loop Logic

### Entry Point (Status-Based Routing)

| Current Status | First Step |
|----------------|-----------|
| `draft` | Phase 1（对话式定义 Overall Objective）— 引导用户定义目标，LLM 自决是否 research，确认后写入 .target.md + .convergence-baseline.md，自动生成 Stage 1 目标 → planning |
| `planning` | Phase 2（plan → check）— Execute plan → verify → check (post-plan) |
| `re-planning` | Phase 2（plan → check，带 check 反馈）— Read `phase` field: if `needs-plan` → execute plan; if `needs-check` → execute verify → check (post-plan); if empty → default to plan |
| `review` | Phase 3（post-plan 已通过，exec）— Execute exec |
| `executing` | Phase 3（exec → check）— Execute verify → check (post-exec). **Note**: even if `completed_steps` < total, auto enters via post-exec verification first — check detects incomplete work and routes back to exec via NEEDS_FIX |
| `evolving` | Phase 4（convergence < 0.95 自动推进 / ≥ 0.95 等用户）— 读取 convergence score，< 0.95 自动生成下一子阶段目标 → planning；≥ 0.95 报告并等用户响应 |
| `satisfied` | 报告完成状态，用户可 refine → evolving → 自动生成子阶段 → planning |
| `blocked` | 报告阻塞原因，等用户干预 |
| `cancelled` | 报告任务已取消（终态）|

### Result-Based Routing

| step | result | next | checkpoint | Rationale |
|------|--------|------|------------|-----------|
| check | PASS | exec | post-plan | Plan approved, proceed to execution |
| check | NEEDS_REVISION | plan | — | Plan needs revision |
| check | ACCEPT | highlight | post-exec | D1-D6 + convergence gate passed, finalize |
| check | ROLLBACK | (rollback) | post-exec | Convergence not improving, rollback |
| check | NEEDS_FIX | exec | mid-exec / post-exec | Minor issues, re-execute to fix |
| check | REPLAN | plan | — | Fundamental issues, revise plan |
| check | BLOCKED | (stop) | — | Cannot continue |
| check | CONTINUE | exec | mid-exec | Progress OK, resume execution |
| target | (stage-advanced) | plan | — | New stage target written, generate plan |
| target | (refined) | plan | — | Overall Objective refined, re-plan |
| plan | (generated) | verify | post-plan | Plan ready, verify before assessment |
| exec | (done) | verify | post-exec | All steps completed, verify before assessment |
| exec | (mid-exec) | verify | mid-exec | Significant issue, verify before checkpoint |
| exec | (step-N) | verify | mid-exec | Single step completed (manual `--step N` only) |
| exec | (blocked) | (stop) | — | Cannot continue |
| highlight | (distilled) | report | — | Distillation complete |
| highlight | (skipped-idempotent) | report | — | No new content |
| highlight | failed | report | — | Distillation failed (non-blocking) |
| research | (collected) | `<caller>` | post-research | References collected, resume calling phase |
| research | (sufficient) | `<caller>` | post-research | References sufficient |
| research | (objective-complete) | `<caller>` | post-research | O1→O2→O3 一次性完成，呈现结果，resume calling phase |
| verify | (pass) | check | (from trigger context) | Verification done, check renders verdict |
| verify | (fail) | check | (from trigger context) | Verification done, check renders verdict |
| verify | (partial) | check | (from trigger context) | Verification done, check renders verdict |
| annotate | (processed) | `<by-layer>` | post-annotate | Layer-based: Requirement→plan/check, Planning→check, Eval-analysis→check, Eval-test→verify, Methodology→verify, Information/Comment-only→(none) |
| report | (generated) | (evolving-entry) | — | Phase 4 complete → re-enter evolving decision (convergence < 0.95 → target; ≥ 0.95 → stop and wait) |

### evolving 入口决策（内部步骤）

`(evolving-entry)` 是 auto 循环内部步骤，不是子命令。执行 Phase 4 "evolving 入口决策"（见上方 §Phase 4）：
- 读取 convergence score
- ≥ 0.95 → `(stop)` 等用户
- < 0.95 → 调用 target（stage advance）→ result `(stage-advanced)` → plan → Phase 2 继续循环

### ROLLBACK 后重新生成

1. highlight 记录失败经验到 `.experiences/<type>/<semantic>-failed.md`
2. 从所有 `*-failed.md` 按 frontmatter `sources.notebook` 过滤当前任务排除清单
3. 重新生成子阶段目标（排除清单作为硬约束注入 prompt）
4. 如所有方向穷尽 → 停下报告用户
5. 否则 → 新子阶段目标 → Phase 2

> **Safety**: git reset --hard only affects the task branch, not master. The previous stage commit is always available in stage.history (for stage 2+). Stage 1 ROLLBACK is blocked — falls back to NEEDS_FIX.

### Context Advantage

Because all steps run in one session, Claude naturally retains:
- Plan decisions and trade-offs from planning phase
- Check feedback and evaluation rationale
- Implementation details and workarounds from execution
- Error context from previous fix attempts

The `.summary.md` file is still written by each sub-command as a **compaction safety net**. During normal auto execution, live conversation context is the primary source of truth.

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

- Auto mode starts by entering `/task-ai:auto` in the prompt input window (notebook is auto-detected from CWD or git branch context)
- Daemon's only active intervention is writing `.auto-stop`; all other activity is passive monitoring
- `.auto-stop` is a transient file — should be in `.gitignore`
- **Known trade-off**: First entry on `executing` status always runs verify → check (post-exec). If execution was incomplete, check routes back via NEEDS_FIX, adding one extra iteration
- **Plugin delegation**: External plugin delegation works naturally. Skills invoke plugins via Task tool, creating isolated subagents
- **Self-service bias**: check evaluates its own LLM output — structural bias toward high scores. v1 mitigates via four-file anchored review. Future: external verification signals (coverage, lint, user feedback) as score calibration
- **No merge in Phase 4**: v2 removes merge from the auto loop. Phase 4 uses D1-D6 acceptance + convergence gate instead. Rollback replaces merge conflict handling
