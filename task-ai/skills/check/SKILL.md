---
name: check
description: "Six-dimension gated review — evaluates plans, implementations, and skills through D1-D6 quality gates with convergence tracking. Use for post-plan review, mid-exec assessment, post-exec acceptance, or any time the user says 'check', 'review', 'audit', 'evaluate quality', or wants to know if deliverables are ready."
model_tier: heavy
auto_delegatable: false
triggers:
  keywords:
    zh: [检查, 评审, 审查, 评估, 可行性, 审核, 把关, 六维]
    en: [check, review, evaluate, assess, feasibility, audit, gate, six-dimension]
  phrases:
    zh: [检查一下计划, 方案可行吗, 评审一下, 看看行不行, 审查通过了吗, 能不能执行, 帮我审查这个方案, 六维审查]
    en: [check the plan, is it feasible, review the implementation, evaluate progress, ready to execute, review this solution, six-dimension audit]
  disambiguate: >
    Core intent: evaluate and render a verdict using six-dimension gated review.
    User asks "is this plan OK?" or "review this solution" → check (context review).
    User in task lifecycle → check with checkpoint.
    User asks to RUN tests → verify. User asks to SEE task status → list.
arguments:
  - name: description
    description: "Natural language description for context review (e.g., 'review the solution discussed above')"
    required: false
  - name: checkpoint
    description: "Evaluation checkpoint: post-plan, mid-exec, post-exec, skill-review, skill-deep-review, audit-validate"
    required: false
---

# /task-ai:check — Six-Dimension Gated Review

Unified review capability with gated execution: Gate 1 (D2 Security) → Gate 2 (D1 Correctness) → Gate 3 (D3 Reliability) → Gate 4 (D4+D5+D6 Optimization).

> **Path Rule**: All system files (`.status.json`, `.target.md`, `.plan.md`, etc.) are in `$TASKAI_WORK_DIR/` (= `$NB_WORK_DIR/.working/`), NOT in `$NB_WORK_DIR/` directly. See `commands/task-ai.md` §System File Path Rule.

## Table of Contents

- [Usage](#usage) — invocation patterns and parameter routing
- [Scope Definitions](#scope-definitions) — §S1 context, §S2 lifecycle, §S3 skill, §S4 rules
- [Four-File Anchored Review](#four-file-anchored-review) — dimension-anchor mapping table
- [Convergence Evaluation](#convergence-evaluation) — formula, scoring scale, anchor mechanism
- [Checkpoints](#checkpoints-scopelifecycle) — post-plan, mid-exec, post-exec
- [Execution Steps](#execution-steps) — scope routing + lifecycle steps 1-18
- [State Transitions](#state-transitions) — status transition table
- [Regression Test Applicability](#regression-test-applicability) — who fixes, who tests

## Usage

```
/task-ai:check                           # Review current conversation context (plan/solution)
/task-ai:check "<description>"           # Review with specified focus
/task-ai:check --checkpoint <checkpoint>  # Lifecycle checkpoint review (notebook auto-detected)
/task-ai:check --checkpoint skill-review --target <file>  # Skill validation
/task-ai:check --checkpoint audit-validate  # Rule candidate validation
```

**Notebook auto-detection:** When `--checkpoint` is used, the notebook is automatically resolved from CWD (`.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

**Parameter routing:**
- No arguments → scope=context (review current conversation's plan/solution)
- `check "<description>"` -> scope=context with focus (e.g., "review the fix approach above")
- `check --checkpoint post-plan` → scope=lifecycle (task lifecycle checkpoint)
- `check --checkpoint skill-review --target <file>` → scope=skill (skill validation)
- `check --checkpoint audit-validate` → scope=rules (rule candidate validation)

---

## Scope Definitions

check defines 4 scopes. Scopes context and lifecycle are **independent invocations**. Scopes skill and rules are **inline protocols** (called via `--checkpoint`).

---

### §S1 scope=context — Conversation Context Review

**Caller**: None (independent execution)
**Trigger**: `/task-ai:check` or `/task-ai:check "<description>"`

Reviews the current conversation context for plans, solutions, or proposals using six-dimension gated audit.

#### When to Use

- After discussing and drafting a plan in conversation
- After proposing a fix or solution approach
- Before implementing a discussed design
- When asking "is this approach OK?"

#### Input Identification

From current conversation context, identify:

1. **Review target** — the plan, solution, or proposal to evaluate
   - Look for: numbered steps, bullet lists, code blocks, design decisions
   - If description provided, use it to focus on specific content
   - If ambiguous → ask user to clarify what to review

2. **Review type** — determines dimension weights
   - `plan` — implementation steps, feature design
   - `fix` — bug fix approach, remediation
   - `design` — architecture, system design
   - `code` — code snippet review

#### Gated Execution (same as skill-review)

```
Gate 1: D2 Security (blocking, threshold 0.5)
    ├─ FAIL → output fix suggestion → BLOCKED
    └─ PASS ↓

Gate 2: D1 Correctness (blocking, threshold 0.5)
    ├─ FAIL → output fix suggestion → BLOCKED
    └─ PASS ↓

Gate 3: D3 Reliability (blocking, threshold 0.5)
    ├─ FAIL → output fix suggestion → BLOCKED
    └─ PASS ↓

Gate 4: D4+D5+D6 Optimization (parallel, non-blocking)
    └─ Output improvement suggestions
```

#### Dimension Adaptation (Dynamic)

Dimension weights and focus areas are **not hardcoded** — they adapt based on review type:

1. **Identify review type** from context: `plan` / `fix` / `design` / `code` / `<task-type>`

2. **Load adaptation config** (priority order):
   - If in notebook context → read `.type-profile.md` "Audit Adaptation" section
   - Else → read `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/<type>.md`
   - Fallback → `check/references/six-dimension-audit.md` Domain Adaptation seed table

3. **Apply weights** — config specifies per-dimension:
   - Weight adjustment (↑/↓/default)
   - Focus questions for this type
   - Blocking threshold override (if any)

4. **Auto-update mechanism**:
   - When check completes, if new type-specific insights discovered
   - Write to `.memory/.experiences/<type>/<semantic>-eval.md`
   - highlight scope=complete syncs to `.type-profiles/`
   - Next check for same type uses updated adaptation

> See `check/references/six-dimension-audit.md` §Domain Adaptation for seed table structure and `plan/references/type-profiling.md` for type system details.

#### Output Modes

scope=context has two output modes, depending on whether check proceeds to fix issues:

**Mode 1: Verdict-only** (default) — output conversation response, no file modifications:

1. **Gate Progress Table** — which gates passed/failed
2. **Blocking Issues** — if any gate failed, specific problems and fix suggestions
3. **Optimization Suggestions** — from Gate 4 (if reached)
4. **Verdict** — PASS / NEEDS_REVISION / BLOCKED

**Mode 2: Audit-and-fix** — check identifies issues AND proceeds to apply fixes directly:

Mode 2 is entered when the user's invocation implies fixing (e.g., "review and fix", "audit and fix"), or when the user explicitly confirms to proceed with fixes after seeing Mode 1 output. When in Mode 2, each fix that modifies code/spec/config files follows the RED→GREEN protocol (applying untested fixes risks false-green scenarios that propagate to downstream execution):

1. **Classify** finding → (fix category, task type) → select test approach from `commands/references/test-strategy-by-type.md` Strategy Matrix
2. **Write** the regression test (RED) — it should fail against current codebase (confirming the bug exists before fixing prevents false-green scenarios)
3. **Run** → confirm FAIL (RED). If test passes unexpectedly, the finding may be invalid — reassess before proceeding
4. **Apply** the fix
5. **Run** → confirm PASS (GREEN)
6. **Run** full test suite → confirm zero regressions
7. Repeat for each finding that requires a file modification

**Exemptions** (skip steps 2-5, still require step 6): Pure typo fix (≤3 chars), comment-only change, historical doc annotation.

> **Trigger rule**: The RED→GREEN protocol is MANDATORY whenever check **directly modifies code/spec/config files**. It does NOT apply when check only renders a verdict. This is a hard gate — skipping RED→GREEN for non-exempt fixes is a protocol violation.

#### Example (verdict-only)

```
User: /task-ai:check
```

```
=== Context Review: Fix Approach ===

Gate 1 (D2 Security): PASS ✅
Gate 2 (D1 Correctness): PASS ✅
Gate 3 (D3 Reliability): FAIL ❌
  - No rollback plan if fix causes regression
  - Missing error handling for edge case X

Fix suggestion: Add rollback steps and handle case X.

Verdict: NEEDS_REVISION
```

#### Example (audit-and-fix)

```
User: /task-ai:check "six-dimension audit and fix"
```

```
=== Context Review: Audit-and-Fix ===

Gate 1 (D2 Security): PASS ✅
Gate 2 (D1 Correctness): PASS ✅
Gate 3 (D3 Reliability): FAIL ❌
  Finding R1: missing error handling in foo.sh line 42

Applying fix R1:
  RED: wrote test → bash tests/unit/foo-error.test.sh → FAIL ✓
  FIX: added error handling to foo.sh:42
  GREEN: bash tests/unit/foo-error.test.sh → PASS ✓
  SUITE: full test suite → 0 regressions ✓

Verdict: PASS (after fix)
```

#### Does NOT Write State Files

scope=context does not write `.analysis/` files or update `.status.json`. In audit-and-fix mode, it modifies project source files (with RED→GREEN) but not task lifecycle state.

---

### §S2 scope=lifecycle — Task Lifecycle Checkpoint

**Caller**: None (independent execution)
**Trigger**: `/task-ai:check --checkpoint <checkpoint>` (notebook auto-detected)

This is the existing checkpoint-based review for task lifecycle. See Checkpoints section below.

---

### §S3 scope=skill — Skill Validation

**Caller**: `--checkpoint skill-review` (inline)
**Trigger**: `check --checkpoint skill-review --target <skill.md>` (notebook auto-detected)

Validates skill files using six-dimension gated review. Implemented in `check.sh`.

---

### §S4 scope=rules — Rule Candidate Validation

**Caller**: `--checkpoint audit-validate` (inline)
**Trigger**: `check --checkpoint audit-validate`

Validates rule candidates in `.evolving-rules/*/candidates/`. Implemented in `check.sh`.

---

## Four-File Anchored Review

All lifecycle checkpoints use **four-file anchored review**: evaluating deliverables against `.target.md` (requirements), `.convergence-baseline.md` (weighted R# scoring baseline), and `.plan.md` (design) per D1-D6 dimension. Scores reflect "deliverable vs requirements+baseline+plan" deviation, not subjective LLM judgment.

| Dimension | Anchor | Review Question |
|-----------|--------|-----------------|
| D1 Correctness | .target.md requirements + .convergence-baseline.md R# items | Does deliverable implement each requirement? Are R# completion scores accurate? |
| D2 Security | .target.md security constraints | Does deliverable satisfy security requirements? |
| D3 Reliability | .plan.md boundary conditions + .convergence-baseline.md weights | Does deliverable cover planned edge/exception cases? Are critical (weight=3) items prioritized? |
| D4 Performance | .target.md performance metrics | Does deliverable meet performance requirements? |
| D5 Architecture | .plan.md architecture design | Does deliverable structure match planned modules/interfaces? |
| D6 Maintainability | .plan.md module division | Is deliverable organized per plan? Naming/conventions consistent? |

> **Phase 2 exception:** When reviewing `.plan.md` itself (post-plan checkpoint), D3/D5/D6 anchors assess internal quality (boundary coverage, module structure, step clarity) rather than self-referencing .plan.md.

### D1-D6 Numeric Score Output

Every lifecycle checkpoint outputs D1-D6 numeric scores (0.0 - 1.0). Scores are written to:
1. `.analysis/<date>-<checkpoint>.md` — human-readable table in the evaluation file

### Threshold System

| Checkpoint | Threshold | Retry Limit | On Limit Exceeded |
|------------|-----------|-------------|-------------------|
| post-plan | 0.70 | 3 replans | Stop, notify user |
| mid-exec | 0.60 | 2 fixes | Stop current step, notify user |
| post-exec | 0.75 | 3 fix/replan | Stop, notify user |

## Adaptive Audit Round Budget

The D1-D6 evaluation can run multiple rounds to progressively find and fix issues. The number of rounds adapts to change scope using `core/audit_budget.py`:

### Budget Formula

```
max_rounds = clamp(ceil(files/5) + ceil(lines/200) + ceil(dirs/3) + type_bonus, 2, 10)
```

Where `files`, `lines`, `dirs` come from `git diff --stat`, and `type_bonus` is +1 for `software` types, +1 for hybrid types (`A|B`).

### Early Termination

| Condition | Action |
|-----------|--------|
| 2 consecutive PASS (zero fixes in a round) | Stop — diminishing returns |
| All gates PASS on round 1 AND files ≤ 3 | Stop after round 1 — trivial change |
| `max_rounds` reached | Stop |

### Integration with Lifecycle Checks

When auto mode invokes check, it passes `max_rounds` computed by `audit_budget.py`. Each check round:
1. Evaluate D1-D6 dimensions
2. If issues found → apply fixes (per RED→GREEN protocol) → next round
3. After each round, call `audit_budget.py should-stop` to check termination
4. When stopped → render final verdict based on cumulative results

For standalone check invocations (no auto context), default to `max_rounds = 3`.

## Convergence Evaluation

Convergence measures whether deliverables are moving toward the task's target requirements. Used by the post-exec dual gate to distinguish "quality OK but wrong direction" (ROLLBACK) from "quality OK and progressing" (ACCEPT). Formula: `Σ(wᵢ × cᵢ) / Σ(wᵢ)` where weights come from `.convergence-baseline.md`. First stage (empty history) uses 0.0 as previous — any progress always passes the direction gate.

> **See `references/convergence-evaluation.md`** for the full formula, 5-level scoring scale (0.00–1.00), anchor mechanism to prevent score drift, and `.analysis/<date>-convergence.md` output format.

## Checkpoints (scope=lifecycle)

> **See `references/checkpoints.md`** for detailed checkpoint specifications (post-plan, mid-exec, post-exec), including evaluation criteria, VFP discipline audit, convergence dual gate, and outcome tables.

## Output Files

| File | When Created | Content |
|------|-------------|---------|
| `.analysis/<date>-<summary>.md` | post-plan, mid-exec (BLOCKED), post-exec | Feasibility analysis, blocking analysis, or issue list. One file per assessment, preserving evaluation history |
| `.bugfix/<date>-<summary>.md` | mid-exec (NEEDS_FIX, REPLAN), post-exec (NEEDS_FIX) | Issue analysis, root cause, fix approach, regression test spec. One file per issue |
| `.test/<date>-<checkpoint>-results.md` | mid-exec, post-exec | Test outcomes for criteria verification. One file per checkpoint evaluation |

When writing to any history directory (`.analysis/`, `.bugfix/`, `.test/`), also overwrite that directory's `.summary.md` with a condensed summary of all entries in the directory.

## Execution Steps

### Scope Routing

Before step 1, determine scope from invocation:

- **No `--checkpoint`** → **scope=context**: execute §S1 flow directly (Input Identification → Gated Execution → Output Mode 1 or 2). Do NOT proceed to steps 1-18 below. If audit-and-fix mode is entered (Mode 2), the RED→GREEN protocol defined in §S1 is mandatory for each non-exempt fix
- **`--checkpoint` present** → **scope=lifecycle/skill/rules**: proceed to steps 1-18 below

### Lifecycle Steps (scope=lifecycle only)

1. **Read** `.status.json` to get current task status
2. **Validate** checkpoint is appropriate for current status:
   - `post-plan`: requires status `planning` or `re-planning`
   - `mid-exec`: requires status `executing`
   - `post-exec`: requires status `executing`
3. **Validate dependencies**: read `depends_on` from `.status.json`, check each dependency module's `.status.json` status against its required level (simple string → `satisfied`, extended object → at-or-past `min_status`). If any dependency is not met, verdict is BLOCKED with dependency details
4. **Read** `.type-profile.md` if exists — "Verification Standards", "Quality metrics", and "Audit Adaptation" sections are the **primary** source for evaluation criteria and domain-specific audit checkpoints (see `plan/references/type-profiling.md` for type system details). If check reveals the profile's standards are inadequate for this domain, update the relevant sections with findings
5. **Read** all relevant files per checkpoint (use `.summary.md` as primary context, latest file only from each history directory)
6. **Load library context** via Changelog Consumption Protocol (`commands/references/changelog-consumption-protocol.md`)
7. **Library search**: invoke `/task-ai:library search "<keywords>"` with evaluation-relevant keywords from `.target.md` and `.type-profile.md`. Library search handles index reading, scoring, and ranked results — read high-scoring matches for domain evaluation criteria and best practices. **Best Practice**: prefer `library search` over direct file reads for multi-factor scoring, graph recommendations, and token budget control
8. **Gap check** (intelligence support): if `.type-profile.md` lacks evaluation criteria OR `.references/` lacks domain evaluation standards/benchmarks for the task `type`, trigger `research --scope gap --caller check` to collect missing references before proceeding
9. **Incorporate verify results**: If fresh verification results exist in `.test/` (from a prior `verify` run, same day and matching checkpoint), read and incorporate them. Otherwise, run verification procedures inline as part of evaluation — inline scope is limited to the criteria in the latest `.test/` criteria file only (build + test + acceptance). For comprehensive domain-adapted verification, invoke `verify` explicitly before `check`
10. **Evaluate** against criteria (multi-round, budget-controlled)
    - **Audit round budget**: Use `max_rounds` from auto context (step 1b) or default 3. Each evaluation round covers D1-D6. After each round, check early termination via `audit_budget.py should-stop`. Track `consecutive_pass` count (rounds with zero fixes). When stopped, render final verdict
    - **Security Audit (Pre-hook)** (post-plan checkpoint only): Invoke `/task-ai:security audit-plan` before D1-D6 evaluation — security issues caught early avoid wasted effort on plans that will be rejected. If verdict is `BLOCKED` or `HIGH_RISK`, render `REPLAN` immediately with the security report attached.
    - **Optional delegation — code-review** (post-exec checkpoint only): Follow `auto/references/plugin-delegation.md` to attempt matching the `code-review` capability slot. If matched, invoke via Task subagent with a git diff summary as input — review results serve as supplementary evaluation evidence. No match or failure → continue standard inline evaluation
    - **Regression Test Protocol (HARD GATE)**: When check directly applies fixes (not just rendering a verdict), follow the same RED→GREEN protocol defined in §S1 Mode 2 (steps 1-7). The protocol ensures each fix is verified before and after — false-green scenarios are caught immediately rather than propagating to downstream execution. Exemptions and scope rules: see [Regression Test Applicability](#regression-test-applicability)
    - **Lifecycle NEEDS_FIX output**: When check renders NEEDS_FIX (not fixing itself), the `.bugfix/` file includes a regression test specification for each finding — test approach, RED assertion, expected GREEN behavior — so that `exec` can execute the RED→GREEN protocol when applying the fix
    - **Convergence evaluation** (post-exec checkpoint only, after D1-D6 passes threshold):
      - 10g. Read `.convergence-baseline.md` → extract R# items and weights
      - 10h. Read latest `.analysis/*-convergence.md` (if exists) as score anchor
      - 10i. Evaluate each R# against current deliverables using scoring scale (1.00/0.75/0.50/0.25/0.00)
      - 10j. Compute weighted convergence score: `Σ(wᵢ × cᵢ) / Σ(wᵢ)`
      - 10k. Determine previous convergence (from `stage.history` in `.status.json` or previous convergence.md). **First stage (empty history)**: use 0.0 as previous — first stage always passes the convergence gate since any progress > 0
      - 10l. **If convergence > previous** → proceed to ACCEPT. Write `.analysis/<date>-convergence.md` with per-R# detail (auto reads this file to record commit hash + convergence score to `stage.history`)
      - 10m. **If convergence ≤ previous** → render ROLLBACK verdict:
        1. Write `.analysis/<date>-convergence-rollback.md` with failure reason, convergence delta, and failure experience
        2. Record failure experience to highlight archive (scope=impl pattern)
        3. Render verdict as ROLLBACK — the **caller** (auto loop or user) executes the actual rollback (git reset, history trim, status change). Check does NOT execute destructive git operations
      - 10n. If `.convergence-baseline.md` does not exist, skip convergence gate entirely — proceed directly to ACCEPT/NEEDS_FIX/REPLAN based on D1-D6 alone
    - **R# coverage check** (post-plan checkpoint only):
      - 10o. If `.convergence-baseline.md` exists, scan `.plan.md` for `Covers: R#` annotations
      - 10p. Cross-check against all R# items in baseline — if any R# uncovered → NEEDS_REVISION with specific uncovered items listed
11. **Write** output files per outcome: evaluation to `.analysis/` or `.bugfix/` (per Outcomes tables above), and test results to `.test/<date>-<checkpoint>-results.md` when tests are evaluated (mid-exec and post-exec checkpoints)
    - **REPLAN with traceable reference**: if verdict is REPLAN AND evaluation identifies a specific `.memory/.references/<file>` as misleading (e.g., bad API docs caused wrong approach), increment `failure_count` in that reference file's frontmatter:
      1. Read reference file, increment `failure_count` in frontmatter
      2. Use `library write` to update: `/task-ai:library write "<reference-path>" --content-file <modified-file> --notebook <notebook-name>`
12. **Experience and quality updates** (skip for CONTINUE verdict — insufficient evaluation evidence):
    - Write evaluation experience: execute highlight protocol scope=impl pattern — see `highlight/SKILL.md` §3.1 for format. Write to `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<semantic>-eval.md` with evaluation findings, verdict rationale, and domain quality criteria learned — `quality_status: provisional`. Use `library write` for all library writes (handles locking, changelog, index automatically). Inline call failure should not block check's main flow — highlight is an enhancement step, not a gating requirement
    - **`quality_status` updates**: execute highlight protocol scope=quality-update — see `highlight/SKILL.md` §3.4. ACCEPT (post-exec): provisional → verified. REPLAN: provisional → invalidated (if experience was misleading source). Inline call failure should not block check's main flow (same fault isolation)
13. **Update** each written directory's `.summary.md` — overwrite with condensed summary of ALL entries in that directory (`.analysis/.summary.md`, `.bugfix/.summary.md`, `.test/.summary.md` as applicable per checkpoint)
14. **Write** task-level `.summary.md` with condensed context: task state, plan summary, evaluation outcome, progress (`completed_steps`), known issues, key decisions (integrate from directory summaries)
15. **MANDATORY STATUS UPDATE** — Use Edit tool to update `.status.json` per State Transitions table below:
    - Read current `.status.json`
    - Set `"status"` field to the new status from State Transitions table (e.g., `planning` → `review` on PASS)
    - Update `"updated"` timestamp to current ISO-8601
    - Write back with Edit tool
    - **VERIFY**: After write, read `.status.json` again to confirm `status` field changed as expected. If unchanged, the update FAILED — retry or abort
16. Execute highlight protocol scope=thinking-raw — see `highlight/SKILL.md` §3.3. Optional, encouraged (high-value). Capture quality judgment and ACCEPT/REPLAN decision reasoning. Inline call failure should not block check's main flow (same fault isolation)
17. **Git commit**: per outcome (see Git section below). All outcomes commit their output files and state updates, regardless of whether status changes
18. **Report** evaluation result with detailed reasoning. Then output next step prompt based on verdict:
    - PASS (post-plan) → "Plan approved. Ready to execute — say 'auto' to start the automatic execution loop, or `/task-ai:exec` to execute manually step by step."
    - NEEDS_REVISION (post-plan) → "Plan needs revision. Next: `/task-ai:plan` to revise based on the feedback above."
    - ACCEPT (post-exec) → "Implementation accepted. Auto mode will update .target.md and .status.json, then proceed to highlight → report → evolving decision."
    - NEEDS_FIX (mid/post-exec) → "Issues found. Next: `/task-ai:exec` to apply fixes based on the findings above."
    - ROLLBACK (post-exec) → "Convergence regressed — deliverables rolled back to previous stage endpoint. Next: `/task-ai:exec` to retry with a different approach. Refer to `.analysis/<date>-convergence-rollback.md` for failure analysis."
    - REPLAN → "Fundamental issues found. Next: `/task-ai:plan` to re-plan based on the feedback above."
    - CONTINUE (mid-exec) → "Progress OK. Next: `/task-ai:exec` to continue implementation."
    - BLOCKED → "Task blocked. Manual intervention required."

## State Transitions

| Current Status | After Check | Condition |
|----------------|-------------|-----------|
| `planning` | `review` | post-plan PASS |
| `re-planning` | `review` | post-plan PASS |
| `planning` | `planning` | post-plan NEEDS_REVISION |
| `re-planning` | `re-planning` | post-plan NEEDS_REVISION |
| `planning` | `blocked` | post-plan BLOCKED |
| `re-planning` | `blocked` | post-plan BLOCKED |
| `executing` | `executing` | mid-exec CONTINUE |
| `executing` | `executing` | mid-exec NEEDS_FIX |
| `executing` | `re-planning` | mid-exec REPLAN |
| `executing` | `blocked` | mid-exec BLOCKED |
| `executing` | `executing` | post-exec ACCEPT |
| `executing` | `executing` | post-exec NEEDS_FIX |
| `executing` | `evolving` | post-exec ROLLBACK |
| `executing` | `re-planning` | post-exec REPLAN |

## Git

| Outcome | Commit Message |
|---------|---------------|
| PASS | `task-ai(<notebook>):check post-plan PASS → review` |
| ACCEPT | `task-ai(<notebook>):check post-exec ACCEPT` |
| REPLAN | `task-ai(<notebook>):check replan → re-planning` |
| BLOCKED | `task-ai(<notebook>):check blocked → blocked` |
| NEEDS_REVISION | `task-ai(<notebook>):check post-plan NEEDS_REVISION` |
| NEEDS_FIX (mid-exec) | `task-ai(<notebook>):check mid-exec NEEDS_FIX` |
| NEEDS_FIX (post-exec) | `task-ai(<notebook>):check post-exec NEEDS_FIX` |
| ROLLBACK | `task-ai(<notebook>):check post-exec ROLLBACK` |
| CONTINUE | `task-ai(<notebook>):check mid-exec CONTINUE` |

All outcomes commit their output files and state updates, regardless of whether status changes.

## Task-Type-Aware Verification

Verification methods should match the task domain — a unit test suite for a documentation task, or a prose review for a software task, produces false confidence. Read `type` from `.status.json` and apply domain-appropriate verification. If test methods are mismatched for the task type → verdict is NEEDS_REVISION.

> **See `init/references/seed-types/<type>.md`** for per-type seed methodology (indicators, verification approach). Shared profiles in `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/` take precedence when available.

## Notes

- **Judgment bias**: When uncertain between PASS and NEEDS_REVISION, prefer NEEDS_REVISION. When uncertain between ACCEPT and NEEDS_FIX, prefer NEEDS_FIX. False negatives (extra iteration) are cheaper than false positives (bad code merged).
- Evaluation should be thorough but pragmatic — focus on blocking issues, not style preferences
- Each assessment creates a new file in `.analysis/` (full evaluation history preserved, latest = last by filename sort)
- Each NEEDS_FIX issue (mid-exec or post-exec) creates a new file in `.bugfix/` (one issue per file, filename includes date + summary, with regression test spec)
- For `post-exec`, if tests exist (`.test/` criteria files), they should be run and pass for ACCEPT — untested deliverables cannot be accepted with confidence
- Check writes test results to `.test/<date>-<checkpoint>-results.md` (e.g., `YYYY-MM-DD-post-exec-results.md`) documenting test outcomes
- `depends_on` in `.status.json` is always validated: if any dependency is not met (simple string → `satisfied`, extended object → at-or-past `min_status`), verdict is BLOCKED (not just flagged as risk)
- **Concurrency**: Check acquires `.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/task-ai.md`)
- **Six-dimension audit (L3)**: For thorough evaluation, apply D1 Correctness / D2 Security / D3 Reliability / D4 Performance / D5 Architecture / D6 Maintainability checks systematically, adapted to the task's domain type. follow `references/six-dimension-audit.md` Audit Workflow steps 1-9 in full. When L3 audit **directly applies fixes** (audit-and-fix mode), steps 7-9 (regression test design, RED→GREEN confirmation, full suite verification) are mandatory per Regression Test Applicability table. When L3 audit only renders a verdict, embed test specs in output for downstream actor
- **VFP applicability**: VFP applies when `type` contains `software` OR `.type-profile.md` contains `## Verification Cycle` section. See `commands/references/verification-first-protocol.md` for full applicability rules
- **verify integration**: The `verify` sub-command can pre-run tests independently. When recent `verify` results exist (same day, matching checkpoint), check incorporates them instead of re-running. This is optional — check works standalone

## Regression Test Applicability

The Regression Test Protocol (step 10a-10f) triggers based on **who applies the fix**:

| Scope | Mode | Who Fixes? | RED→GREEN Required? | Why |
|-------|------|-----------|:---:|-----|
| **context** | Audit-and-fix | check itself | **Yes** | check directly modifies files → follows §S1 Mode 2 RED→GREEN steps |
| **lifecycle** (post-plan) | Verdict only | plan (on NEEDS_REVISION) | No (check) / **Yes (plan)** | check renders verdict; plan applies fix with its own RED→GREEN |
| **lifecycle** (mid-exec, post-exec) | Verdict only | exec (on NEEDS_FIX) | No (check) / **Yes (exec)** | check writes `.bugfix/` with test spec; exec executes RED→GREEN |
| **lifecycle** (any) | L3 deep audit-and-fix | check itself | **Yes** | L3 audit directly modifies files → steps 7-9 mandatory |
| **skill** (skill-review) | Evaluate + promote | nobody (score only) | **No** | check evaluates and optionally moves files; no code/spec fix |
| **skill** (skill-deep-review) | Evaluate + promote | nobody (score only) | **No** | same as skill-review |
| **rules** (audit-validate) | Evaluate + move | nobody (move only) | **No** | check moves candidate files between directories; no content fix |
| **delegated** (subagent from auto/exec) | Audit-and-fix | delegated agent | **Yes** | agent applies fixes on check's behalf → same as context mode |

**Key principle**: The protocol binds to the **actor who modifies files**, not to the check command itself. When check only evaluates, it embeds test specs in its output (`.bugfix/`, `.analysis/`) for the downstream actor to execute.

**Lifecycle NEEDS_FIX `.bugfix/` format**: Each finding section includes:
```markdown
### Regression Test
- **Category**: [Runtime code | Spec text | Fixture data | ...]
- **Test approach**: [from Strategy Matrix]
- **RED assertion**: [what to test, expected FAIL before fix]
- **GREEN expectation**: [expected PASS after fix]
```

This ensures `exec` has everything needed to run RED→GREEN without re-analyzing the issue.
