---
name: check
description: "Six-dimension gated review — context-aware plan/solution audit, lifecycle checkpoints, and skill validation"
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
  - name: notebook
    description: "Notebook name for lifecycle checkpoints (e.g., auth-refactor)"
    required: false
  - name: description
    description: "Natural language description for context review (e.g., '审查上面讨论的方案')"
    required: false
  - name: checkpoint
    description: "Evaluation checkpoint: post-plan, mid-exec, post-exec, pre-merge, skill-review, skill-deep-review, audit-validate"
    required: false
---

# /task-ai:check — Six-Dimension Gated Review

Unified review capability with gated execution: Gate 1 (D2 Security) → Gate 2 (D1 Correctness) → Gate 3 (D3 Reliability) → Gate 4 (D4+D5+D6 Optimization).

## Usage

```
/task-ai:check                           # Review current conversation context (plan/solution)
/task-ai:check "<description>"           # Review with specified focus
/task-ai:check <notebook> --checkpoint <checkpoint>  # Lifecycle checkpoint review
/task-ai:check <notebook> --checkpoint skill-review --target <file>  # Skill validation
/task-ai:check --checkpoint audit-validate  # Rule candidate validation
```

**Parameter routing:**
- No arguments → scope=context (review current conversation's plan/solution)
- `check "<description>"` → scope=context with focus (e.g., "审查上面的修复方案")
- `check <notebook> --checkpoint post-plan` → scope=lifecycle (task lifecycle checkpoint)
- `check <notebook> --checkpoint skill-review --target <file>` → scope=skill (skill validation)
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
   - Write to `.memory/.experiences/<type>/<notebook>-eval.md`
   - highlight scope=complete syncs to `.type-profiles/`
   - Next check for same type uses updated adaptation

> See `check/references/six-dimension-audit.md` §Domain Adaptation for seed table structure and `plan/references/type-profiling.md` for type system details.

#### Output

Direct conversation response with:

1. **Gate Progress Table** — which gates passed/failed
2. **Blocking Issues** — if any gate failed, specific problems and fix suggestions
3. **Optimization Suggestions** — from Gate 4 (if reached)
4. **Verdict** — PASS / NEEDS_REVISION / BLOCKED

#### Example

User discusses a fix approach, then:
```
User: /task-ai:check
```

Response:
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

#### Regression Test Protocol in Context Review

When scope=context review identifies issues AND the reviewer proceeds to apply fixes (audit-and-fix mode), the Regression Test Protocol from `commands/references/test-strategy-by-type.md` applies — each fix requires RED→GREEN confirmation. See step 10 "Regression Test Protocol" in Execution Steps.

> **Trigger rule**: The protocol applies whenever check (or an agent acting on check's findings) **directly modifies code/spec/config files**. It does NOT apply when check only renders a verdict for another skill to act on. See [Regression Test Applicability](#regression-test-applicability) for the full trigger table.

#### Does NOT Write Files

scope=context is conversational — no `.analysis/` files, no `.auto-signal`, no state changes. Output is direct response in conversation.

---

### §S2 scope=lifecycle — Task Lifecycle Checkpoint

**Caller**: None (independent execution)
**Trigger**: `/task-ai:check <notebook> --checkpoint <checkpoint>`

This is the existing checkpoint-based review for task lifecycle. See Checkpoints section below.

---

### §S3 scope=skill — Skill Validation

**Caller**: `--checkpoint skill-review` (inline)
**Trigger**: `check <notebook> --checkpoint skill-review --target <skill.md>`

Validates skill files using six-dimension gated review. Implemented in `check.sh`.

---

### §S4 scope=rules — Rule Candidate Validation

**Caller**: `--checkpoint audit-validate` (inline)
**Trigger**: `check --checkpoint audit-validate`

Validates rule candidates in `.evolving-rules/*/candidates/`. Implemented in `check.sh`.

---

## Three-File Anchored Review

All lifecycle checkpoints use **three-file anchored review**: evaluating deliverables against `.target.md` (requirements) and `.plan.md` (design) per D1-D6 dimension. Scores reflect "deliverable vs requirements+plan" deviation, not subjective LLM judgment.

| Dimension | Anchor | Review Question |
|-----------|--------|-----------------|
| D1 Correctness | .target.md requirements | Does deliverable implement each requirement? |
| D2 Security | .target.md security constraints | Does deliverable satisfy security requirements? |
| D3 Reliability | .plan.md boundary conditions | Does deliverable cover planned edge/exception cases? |
| D4 Performance | .target.md performance metrics | Does deliverable meet performance requirements? |
| D5 Architecture | .plan.md architecture design | Does deliverable structure match planned modules/interfaces? |
| D6 Maintainability | .plan.md module division | Is deliverable organized per plan? Naming/conventions consistent? |

> **Phase 2 exception:** When reviewing `.plan.md` itself (post-plan checkpoint), D3/D5/D6 anchors assess internal quality (boundary coverage, module structure, step clarity) rather than self-referencing .plan.md.

### D1-D6 Numeric Score Output

Every lifecycle checkpoint outputs D1-D6 numeric scores (0.0 - 1.0). Scores are written to:
1. `.analysis/<date>-<checkpoint>.md` — human-readable table in the evaluation file
2. `.auto-signal` `check_score` field — machine-readable for frontend display and threshold comparison

Score writing uses `signal-writer.sh` utility:
```bash
source "$SCRIPT_DIR/../../auto/scripts/signal-writer.sh"
write_check_score "$SIGNAL_FILE" "$OVERALL" "$D1" "$D2" "$D3" "$D4" "$D5" "$D6"
```

### Threshold System

| Checkpoint | Threshold | Retry Limit | On Limit Exceeded |
|------------|-----------|-------------|-------------------|
| post-plan | 0.70 | 3 replans | Stop, notify user |
| mid-exec | 0.60 | 2 fixes | Stop current step, notify user |
| post-exec | 0.75 | 3 fix/replan | Stop, notify user |
| pre-merge | 0.80 | No retry | Fall back to Phase 3 (retry_count reset to 0) |

## Checkpoints (scope=lifecycle)

### 1. post-plan (default)

Evaluates whether the implementation plan is ready for execution.

**Reads:** `.target.md` + `.plan.md` + `.summary.md` (if exists) + `.test/` (latest criteria file) + `.bugfix/` (latest file if exists, to verify revised plan addresses execution issues)

**Evaluation Criteria (unified six-dimension framework, L2 depth):**

| Dimension | Weight | Focus at L2 |
|-----------|--------|-------------|
| **D1 Correctness** | High | Requirements coverage — does the plan address all `.target.md` requirements? Functional feasibility — can the approach work with current codebase/tools? |
| **D2 Security** | Medium | Security risk identification — are risks flagged and mitigated? |
| **D3 Reliability** | High | Dependency validation — are all `depends_on` modules meeting required status? (simple → `complete`, extended → at-or-past `min_status`) If not → BLOCKED. Feasibility of dependencies — are external dependencies available? |
| **D4 Performance** | Low | Plan efficiency — no redundant or overly granular steps? |
| **D5 Architecture** | Medium | Structure — does the plan support incremental delivery and separation of concerns? |
| **D6 Maintainability** | High | Clarity — are steps clear and unambiguous? Verifiability — does `.test/` contain criteria files with testable acceptance criteria and per-step verification? Are test/verification methods appropriate for the task type (see Task-Type-Aware Verification below)? |

**Domain weight adjustment**: Weights above are defaults. Read `.type-profile.md` "Audit Adaptation" section to shift emphasis per task domain (e.g., `software` → Security↑ Reliability↑, `infrastructure` → Security↑↑ Reliability↑↑, `data-pipeline` → Performance↑ Reliability↑). When profile lacks adaptation guidance, use seed tables in `references/six-dimension-audit.md` Domain Adaptation section. Adjustments increase attention on specific dimensions without skipping any.

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **PASS** | Create `.analysis/<date>-post-plan-pass.md` with approval summary | `planning` → `review` |
| **NEEDS_REVISION** | Create `.analysis/<date>-post-plan-needs-revision.md` with specific issues | Status unchanged |
| **BLOCKED** | Create `.analysis/<date>-post-plan-blocked.md` with blocking reasons | → `blocked` |

### 2. mid-exec

Evaluates progress during execution when issues are encountered.

**Reads:** `.target.md` + `.plan.md` + `.summary.md` (if exists) + `.test/` (latest criteria + results) + `.analysis/` (latest file only) + current code changes (via git diff)

**Evaluation Criteria:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Progress** | High | How much of the plan has been completed? (read `completed_steps` from `.status.json`) |
| **Deviation** | High | Has execution deviated from the plan? |
| **Issues** | High | Are encountered issues resolvable? |
| **Continue vs Replan** | Critical | Should execution continue or revert to planning? |

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **CONTINUE** | Document progress, note any adjustments | Status unchanged |
| **NEEDS_FIX** | Create `.bugfix/<date>-<summary>.md` with specific fixable issues | Status unchanged |
| **REPLAN** | Create `.bugfix/<date>-<summary>.md` with issue analysis | `executing` → `re-planning`, set `phase: needs-plan` |
| **BLOCKED** | Create `.analysis/<date>-mid-exec-blocked.md` with blocking analysis | → `blocked` |

### 3. post-exec

Evaluates whether execution results meet the task requirements.

**Reads:** `.target.md` + `.plan.md` + `.summary.md` (if exists) + `.test/.summary.md` (primary; drill into individual `.test/` files only if summary is missing or insufficient) + `.analysis/` (latest file only) + code changes + test results. For `software` types, also read `.test/<date>-vh-baseline.md` (VH baseline from plan), `.test/<date>-cumulative-green.jsonl` (CGG records), `.test/hil-snapshots/` (HIL approval records if applicable), and `.notes/` exec files for VFP cycle summaries

**Evaluation Criteria:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Requirements met** | Critical | Does the implementation satisfy `.target.md`? |
| **Tests pass** | High | Do all relevant tests pass? |
| **No regressions** | High | Are there any unintended side effects? |
| **Code quality** | Medium | Does the code follow project conventions? |
| **VFP Compliance** | Medium | (software types only) Did the execution follow VH→HS→Refactor discipline? See VFP Discipline Audit below |

**VFP Discipline Audit** (software types only — `type` contains `software`):

When evaluating post-exec for software types, assess TDD compliance as an additional dimension:

1. **VH baseline exists?** — Check for `.test/<date>-vh-baseline.md` and `vh-stubs.test.*` (generated by `plan` step 18). If missing → deduct compliance score, note "VH baseline not generated during planning"
2. **VH→HS transitions recorded?** — Check `.notes/` exec files for VFP Cycle Summary sections. Each implementation step should have a `Red (N) → Green (N) → Refactor (yes/no)` record
3. **Cycle completeness** — Calculate: `completed_cycles / total_steps`. Acceptable threshold: ≥ 80% of steps should have completed VH→HS cycles
4. **No skipped Red checks** — Verify no steps jumped directly to Green without confirming Red first (check for "pre-Green without VH confirmation" warnings in notes)

**VFP Compliance scoring:**
- **Full** (≥ 80% cycles complete, baseline exists, no skipped Red) → no penalty
- **Partial** (50–79% cycles complete OR baseline missing) → note in evaluation, does not block ACCEPT
- **Low** (< 50% cycles complete) → downgrade to NEEDS_FIX with guidance: "Insufficient TDD discipline — re-run failing steps with proper VH→HS verification"

Include a `## VFP Compliance` section in the `.analysis/<date>-post-exec-*.md` output file with the score and findings.

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **ACCEPT** | Create `.analysis/<date>-post-exec-accept.md`, write `.test/<date>-post-exec-results.md` | Status unchanged (`executing`), signal → `merge` sub-command |
| **NEEDS_FIX** | Create `.analysis/<date>-post-exec-needs-fix.md` with specific issues | Status unchanged |
| **REPLAN** | Create `.analysis/<date>-post-exec-replan.md` with fundamental issues | `executing` → `re-planning`, set `phase: needs-plan` |

### 4. pre-merge

Final quality gate before merge. Runs three-file anchored D1-D6 scoring with threshold 0.80.

**Reads:** `.target.md` + `.plan.md` + `.summary.md` + `.analysis/` (post-exec ACCEPT file) + `.test/` (results) + code changes

**Evaluation Criteria:**

All six dimensions scored 0.0-1.0 using three-file anchored review (see above). Overall composite calculated with weighted formula.

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **PASS** (overall >= 0.80) | Create `.analysis/<date>-pre-merge.md`, write check_score to `.auto-signal` | Status unchanged, signal → `merge` |
| **NEEDS_FIX** (overall < 0.80) | Create `.analysis/<date>-pre-merge.md` with failing dimensions | Fall back to Phase 3: reset `retry_count` to 0, resume from failing dimension steps |

No retry at pre-merge — failure means the deliverable needs more Phase 3 work on the specific failing dimensions.

## Output Files

| File | When Created | Content |
|------|-------------|---------|
| `.analysis/<date>-<summary>.md` | post-plan, mid-exec (BLOCKED), post-exec, pre-merge | Feasibility analysis, blocking analysis, or issue list. One file per assessment, preserving evaluation history |
| `.bugfix/<date>-<summary>.md` | mid-exec (NEEDS_FIX, REPLAN) | Issue analysis, root cause, fix approach. One file per issue |
| `.test/<date>-<checkpoint>-results.md` | mid-exec, post-exec | Test outcomes for criteria verification. One file per checkpoint evaluation |

When writing to any history directory (`.analysis/`, `.bugfix/`, `.test/`), also overwrite that directory's `.summary.md` with a condensed summary of all entries in the directory.

## Execution Steps

1. **Read** `.status.json` to get current task status
2. **Validate** checkpoint is appropriate for current status:
   - `post-plan`: requires status `planning` or `re-planning`
   - `mid-exec`: requires status `executing`
   - `post-exec`: requires status `executing`
   - `pre-merge`: requires status `executing` (after post-exec ACCEPT)
3. **Validate dependencies**: read `depends_on` from `.status.json`, check each dependency module's `.status.json` status against its required level (simple string → `complete`, extended object → at-or-past `min_status`). If any dependency is not met, verdict is BLOCKED with dependency details
4. **Read** `.type-profile.md` if exists — "Verification Standards", "Quality metrics", and "Audit Adaptation" sections are the **primary** source for evaluation criteria and domain-specific audit checkpoints (see `plan/references/type-profiling.md` for type system details). If check reveals the profile's standards are inadequate for this domain, update the relevant sections with findings
5. **Read** all relevant files per checkpoint (use `.summary.md` as primary context, latest file only from each history directory)
6. **Load library context** via Changelog Consumption Protocol (`commands/references/changelog-consumption-protocol.md`)
7. **Scan** `$NB_WORKSPACES_LIBRARY/.memory/.references/.summary.md` if exists — find relevant external reference files to inform evaluation criteria and domain best practices
8. **Gap check**: if `.type-profile.md` lacks evaluation criteria OR `.references/` lacks domain evaluation standards/benchmarks for the task `type`, trigger `research --scope gap --caller check` to collect missing references before proceeding
9. **Incorporate verify results**: If fresh verification results exist in `.test/` (from a prior `verify` run, same day and matching checkpoint), read and incorporate them. Otherwise, run verification procedures inline as part of evaluation — inline scope is limited to the criteria in the latest `.test/` criteria file only (build + test + acceptance). For comprehensive domain-adapted verification, invoke `verify` explicitly before `check`
10. **Evaluate** against criteria
    - **Security Audit (Pre-hook)** (post-plan checkpoint only): MUST invoke `/task-ai:security <notebook> audit-plan`. If verdict is `BLOCKED` or `HIGH_RISK`, evaluation MUST immediately render a `REPLAN` verdict with the security report attached.
    - **Optional delegation — code-review** (post-exec checkpoint only): Follow `auto/references/plugin-delegation.md` to attempt matching the `code-review` capability slot. If matched, invoke via Task subagent with a git diff summary as input — review results serve as supplementary evaluation evidence. No match or failure → continue standard inline evaluation
    - **Regression Test Protocol (HARD GATE)**: When check directly applies fixes (not just rendering a verdict), every non-exempt fix MUST follow the RED→GREEN protocol from `commands/references/test-strategy-by-type.md`:
      - 10a. Classify finding → (fix category, task type) → select test approach from Strategy Matrix
      - 10b. Write the regression test (RED) — must fail against current codebase
      - 10c. Run → confirm FAIL (RED)
      - 10d. Apply the fix
      - 10e. Run → confirm PASS (GREEN)
      - 10f. Run full test suite → confirm zero regressions
    - **Exemptions** (from test-strategy-by-type.md): Pure typo fix (≤3 chars), comment-only change, historical doc annotation — these skip RED/GREEN (steps 10a-10e) but still require step 10f (full suite)
    - See [Regression Test Applicability](#regression-test-applicability) for which scopes and modes trigger this protocol
    - **Lifecycle NEEDS_FIX output**: When check renders NEEDS_FIX (not fixing itself), the `.bugfix/` file MUST include a regression test specification for each finding — test approach, RED assertion, expected GREEN behavior — so that `exec` can execute the RED→GREEN protocol when applying the fix
11. **Write** output files per outcome: evaluation to `.analysis/` or `.bugfix/` (per Outcomes tables above), and test results to `.test/<date>-<checkpoint>-results.md` when tests are evaluated (mid-exec and post-exec checkpoints)
    - **REPLAN with traceable reference**: if verdict is REPLAN AND evaluation identifies a specific `.memory/.references/<file>` as misleading (e.g., bad API docs caused wrong approach), increment `failure_count` in that reference file's frontmatter (acquire `.memory/.references/.lock` → read frontmatter → `failure_count++` → write atomically → append `reference` changelog update line → release lock)
12. **Experience and quality updates** (skip for CONTINUE verdict — insufficient evaluation evidence):
    - Write evaluation experience: execute highlight protocol scope=impl pattern — see `highlight/SKILL.md` §3.1 for format. Write to `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<notebook>-eval.md` with evaluation findings, verdict rationale, and domain quality criteria learned — `quality_status: provisional`. Follow the same write steps (acquire lock → O_APPEND → changelog → index → release). Inline call failure MUST NOT block check's main flow
    - **`quality_status` updates**: execute highlight protocol scope=quality-update — see `highlight/SKILL.md` §3.4. ACCEPT (post-exec): provisional → verified. REPLAN: provisional → invalidated (if experience was misleading source). Inline call failure MUST NOT block check's main flow
13. **Update** each written directory's `.summary.md` — overwrite with condensed summary of ALL entries in that directory (`.analysis/.summary.md`, `.bugfix/.summary.md`, `.test/.summary.md` as applicable per checkpoint)
14. **Write** task-level `.summary.md` with condensed context: task state, plan summary, evaluation outcome, progress (`completed_steps`), known issues, key decisions (integrate from directory summaries)
15. **Update** `.status.json` status and timestamp per outcome
16. Execute highlight protocol scope=thinking-raw — see `highlight/SKILL.md` §3.3. Optional, encouraged (high-value). Capture quality judgment and ACCEPT/REPLAN decision reasoning. Inline call failure MUST NOT block check's main flow
17. **Git commit**: per outcome (see Git section below). All outcomes commit their output files and state updates, regardless of whether status changes
18. **Write** `.auto-signal` with verdict, next action, and checkpoint (see .auto-signal section below)
19. **Report** evaluation result with detailed reasoning

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
| `executing` | `re-planning` | post-exec REPLAN |
| `executing` | `executing` | pre-merge PASS (→ merge) |
| `executing` | `executing` | pre-merge NEEDS_FIX (→ Phase 3 retry) |

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
| CONTINUE | `task-ai(<notebook>):check mid-exec CONTINUE` |
| PASS (pre-merge) | `task-ai(<notebook>):check pre-merge PASS → merge` |
| NEEDS_FIX (pre-merge) | `task-ai(<notebook>):check pre-merge NEEDS_FIX → Phase 3` |

All outcomes commit their output files and state updates, regardless of whether status changes.

## .auto-signal

Every check outcome writes `.auto-signal` on completion:

| Checkpoint | Result | Signal |
|------------|--------|--------|
| post-plan | PASS | `{ "step": "check", "result": "PASS", "next": "exec", "checkpoint": "", "timestamp": "..." }` |
| post-plan | NEEDS_REVISION | `{ "step": "check", "result": "NEEDS_REVISION", "next": "plan", "checkpoint": "", "timestamp": "..." }` |
| post-plan | BLOCKED | `{ "step": "check", "result": "BLOCKED", "next": "(stop)", "checkpoint": "", "timestamp": "..." }` |
| mid-exec | CONTINUE | `{ "step": "check", "result": "CONTINUE", "next": "exec", "checkpoint": "", "timestamp": "..." }` |
| mid-exec | NEEDS_FIX | `{ "step": "check", "result": "NEEDS_FIX", "next": "exec", "checkpoint": "mid-exec", "timestamp": "..." }` |
| mid-exec | REPLAN | `{ "step": "check", "result": "REPLAN", "next": "plan", "checkpoint": "", "timestamp": "..." }` |
| mid-exec | BLOCKED | `{ "step": "check", "result": "BLOCKED", "next": "(stop)", "checkpoint": "", "timestamp": "..." }` |
| post-exec | ACCEPT | `{ "step": "check", "result": "ACCEPT", "next": "merge", "checkpoint": "", "timestamp": "..." }` |
| post-exec | NEEDS_FIX | `{ "step": "check", "result": "NEEDS_FIX", "next": "exec", "checkpoint": "post-exec", "timestamp": "..." }` |
| post-exec | REPLAN | `{ "step": "check", "result": "REPLAN", "next": "plan", "checkpoint": "", "timestamp": "..." }` |
| pre-merge | PASS | `{ "step": "check", "result": "PASS", "next": "merge", "checkpoint": "pre-merge", "timestamp": "..." }` |
| pre-merge | NEEDS_FIX | `{ "step": "check", "result": "NEEDS_FIX", "next": "exec", "checkpoint": "pre-merge", "timestamp": "..." }` |

When ACCEPT (post-exec) or PASS (pre-merge), the `merge` sub-command handles refactoring, merge, conflict resolution, and cleanup. See `skills/merge/SKILL.md`.

## Task-Type-Aware Verification

Verification methods MUST match the task domain. Read `type` from `.status.json` and apply domain-appropriate verification. If test methods are mismatched for the task type → verdict is NEEDS_REVISION.

> **See `init/references/seed-types/<type>.md`** for per-type seed methodology (indicators, verification approach). Shared profiles in `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/` take precedence when available.

## Notes

- **Judgment bias**: When uncertain between PASS and NEEDS_REVISION, prefer NEEDS_REVISION. When uncertain between ACCEPT and NEEDS_FIX, prefer NEEDS_FIX. False negatives (extra iteration) are cheaper than false positives (bad code merged).
- Evaluation should be thorough but pragmatic — focus on blocking issues, not style preferences
- Each assessment creates a new file in `.analysis/` (full evaluation history preserved, latest = last by filename sort)
- Each mid-exec issue creates a new file in `.bugfix/` (one issue per file, filename includes date + summary)
- For `post-exec`, if tests exist (`.test/` criteria files), they MUST be run and pass for ACCEPT
- Check writes test results to `.test/<date>-<checkpoint>-results.md` (e.g., `YYYY-MM-DD-post-exec-results.md`) documenting test outcomes
- `depends_on` in `.status.json` MUST be validated: if any dependency is not met (simple string → `complete`, extended object → at-or-past `min_status`), verdict is BLOCKED (not just flagged as risk)
- **Concurrency**: Check acquires `.working/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/task-ai.md`)
- **Six-dimension audit (L3)**: For thorough evaluation, apply D1 Correctness / D2 Security / D3 Reliability / D4 Performance / D5 Architecture / D6 Maintainability checks systematically, adapted to the task's domain type. MUST follow `references/six-dimension-audit.md` Audit Workflow steps 1-9 in full. When L3 audit **directly applies fixes** (audit-and-fix mode), steps 7-9 (regression test design, RED→GREEN confirmation, full suite verification) are mandatory per Regression Test Applicability table. When L3 audit only renders a verdict, embed test specs in output for downstream actor
- **VFP applicability**: VFP applies when `type` contains `software` OR `.type-profile.md` contains `## Verification Cycle` section. See `commands/references/verification-first-protocol.md` for full applicability rules
- **verify integration**: The `verify` sub-command can pre-run tests independently. When recent `verify` results exist (same day, matching checkpoint), check incorporates them instead of re-running. This is optional — check works standalone

## Regression Test Applicability

The Regression Test Protocol (step 10a-10f) triggers based on **who applies the fix**:

| Scope | Mode | Who Fixes? | RED→GREEN Required? | Why |
|-------|------|-----------|:---:|-----|
| **context** | Audit-and-fix | check itself | **Yes** | check directly modifies files → must prove each fix correct |
| **lifecycle** (post-plan) | Verdict only | plan (on NEEDS_REVISION) | No (check) / **Yes (plan)** | check renders verdict; plan applies fix with its own RED→GREEN |
| **lifecycle** (mid-exec, post-exec) | Verdict only | exec (on NEEDS_FIX) | No (check) / **Yes (exec)** | check writes `.bugfix/` with test spec; exec executes RED→GREEN |
| **lifecycle** (any) | L3 deep audit-and-fix | check itself | **Yes** | L3 audit directly modifies files → steps 7-9 mandatory |
| **lifecycle** (pre-merge) | Verdict only | exec (on NEEDS_FIX) | No (check) / **Yes (exec)** | check identifies failing dimensions; exec fixes with RED→GREEN |
| **skill** (skill-review) | Evaluate + promote | nobody (score only) | **No** | check evaluates and optionally moves files; no code/spec fix |
| **skill** (skill-deep-review) | Evaluate + promote | nobody (score only) | **No** | same as skill-review |
| **rules** (audit-validate) | Evaluate + move | nobody (move only) | **No** | check moves candidate files between directories; no content fix |
| **delegated** (subagent from auto/exec) | Audit-and-fix | delegated agent | **Yes** | agent applies fixes on check's behalf → same as context mode |

**Key principle**: The protocol binds to the **actor who modifies files**, not to the check command itself. When check only evaluates, it embeds test specs in its output (`.bugfix/`, `.analysis/`) for the downstream actor to execute.

**Lifecycle NEEDS_FIX `.bugfix/` format**: Each finding section MUST include:
```markdown
### Regression Test
- **Category**: [Runtime code | Spec text | Fixture data | ...]
- **Test approach**: [from Strategy Matrix]
- **RED assertion**: [what to test, expected FAIL before fix]
- **GREEN expectation**: [expected PASS after fix]
```

This ensures `exec` has everything needed to run RED→GREEN without re-analyzing the issue.
