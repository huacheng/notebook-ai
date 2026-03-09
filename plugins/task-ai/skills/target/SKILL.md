---
name: target
description: "Define, refine, and review task objectives and requirements in .target.md. Supports both conversational definition and file-based editing."
model_tier: heavy
auto_delegatable: false
triggers:
  keywords:
    zh: [目标, 需求, 范围, 约束, 交付物, 验收标准, 阶段推进]
    en: [goal, objective, requirements, scope, constraints, deliverables, acceptance criteria]
  phrases:
    zh: [我想做, 我要做, 我需要, 定目标, 写目标, 改目标, 调整目标, 看目标, 当前目标, 需求变了, 加需求, 改需求, 下一阶段]
    en: [I want to build, change the goal, update requirements, show target, what's the current objective, next stage, adjust scope]
  disambiguate: >
    Core intent: define / update / view .target.md content.
    User states a concrete goal ("我想做 X") or modifies existing one ("改成 Y") → target.
    User says "深化目标" or "调研可行性" → research --caller target, NOT target.
    Ambiguous word "需求": user DESCRIBING requirement content → target; user INVESTIGATING what's missing → research.
arguments:
  - name: objective
    description: "The task goal, requirements, and constraints (optional — omit to read current target)"
    required: false
  - name: --refine
    description: "Append a refinement to existing target (used by agent during target-refinement phase). Requires a value argument: --refine \"content\""
    required: false
  - name: --satisfy
    description: "Mark task as satisfied (only valid in evolving status). Non-terminal — can re-enter evolution later via /task-ai:target"
    required: false
---

# /task-ai:target — Define and Review Task Objective

Define or review the core mission for a notebook. This command acts as the cognitive anchor for `plan` and `exec`. It provides a bidirectional bridge between the user's natural language and the physical `.target.md` file.

## Usage

```bash
# Write mode: define/update objective
/task-ai:target "Build a JWT authentication system"

# Read mode: display current target
/task-ai:target

# Refine mode: append refinement (agent calls this during conversation)
/task-ai:target --refine "Use refresh tokens for session extension"

# Satisfy mode: mark task as satisfied (non-terminal)
/task-ai:target --satisfy
```

## Refinement

The agent maintains phase awareness via `.status.json` (see Phase Awareness Protocol in `commands/task-ai.md`). No `.session-context` file is used.

When the user expresses intent to modify the target during `planning` status, the agent calls `/task-ai:target --refine "..."` naturally. No additional phase file is needed — `.status.json` `status: planning` is sufficient context.

### .target.md Structure

```markdown
# Task Target: notebook-name

## Objective

Build a JWT authentication system

## Refinements

- [2026-03-04 10:05] Use refresh tokens for session extension
- [2026-03-04 10:08] Support OAuth login via Google

## Requirements

<!-- List specific requirements -->

## Constraints

<!-- Any constraints or limitations -->
```

## Execution Steps

1. **Context discovery**:
   - Locate the current notebook via path-based discovery (`.working/` directory) or branch-based discovery (`task/<name>`).
   - If context cannot be identified, abort with error: "No active task context detected. Enter a notebook directory or switch to a task branch."
   - **Read** `.status.json` `stage` field (default `{ current: 1, history: [] }` if missing) and `status`.
   - **If status is `cancelled`**: REJECT with error "Cancelled tasks cannot be re-targeted." Abort execution.

2. **If `--satisfy` is provided**:
   - If status != `evolving` → REJECT with error "Can only satisfy tasks in evolving status."
   - Else: update `.status.json` status → `satisfied`, git commit `task-ai(<notebook>):target mark satisfied`, output message "Task marked as satisfied."

3. **If `objective` is provided (Write Mode)** — three-branch routing:

   3a. **IF status == `evolving`** → **Stage Advance Mode**:
      1. Read `.target.md`, archive old plan: `.plan.md` → `.plan-stage-<N>.md` (where N = current stage); `.plan-superseded.md` → `.plan-superseded-stage-<N>.md` (if exists); `.analysis/` → `.analysis-stage-<N>/` (if exists); `.test/` → `.test-stage-<N>/` (if exists). Skip missing files (non-fatal).
      2. Clear (non-fatal — skip if directory missing or empty): `.bugfix/` directory contents
      3. Increment `stage.current`, append new Stage section to `.target.md` with user's objective
      4. Update `.status.json`: `stage.current` incremented, `status` → `planning`, `completed_steps` → `0`
      5. Git commit: `task-ai(<notebook>):target stage <N+1> defined`
      6. Execute highlight protocol scope=thinking-raw (optional, high-value)

      **Atomicity**: status change (step 4) occurs AFTER archive/clear (steps 1-2). If steps 1-2 fail, status stays `evolving` — user can retry. If step 4 succeeds but step 5 fails, status is already `planning` — re-running target detects `planning` and routes to normal update path.

   3b. **ELIF `stage.current > 1`** → **Multi-stage Update Mode**:
      - Update current `[ACTIVE]` Stage's content in `.target.md`
      - Atomic write + Git commit: `task-ai(<notebook>):target update objective`
      - Execute highlight protocol scope=thinking-raw (optional, high-value)

   3c. **ELIF status == `satisfied`** → **Re-enter Evolution**:
      - Update `.status.json` status → `planning`
      - Write user's objective to `.target.md`
      - Git commit: `task-ai(<notebook>):target re-enter evolution`

   3d. **ELSE** (normal mode, including first definition) → **Normal/Multi-stage Analysis Mode**:
      - **IF status ∈ {`draft`, `planning`}**: evaluate objective complexity:
        - Is it beyond a single plan→exec→merge cycle?
        - Are there natural stage boundaries?
        - **IF suggests splitting**: propose stages to user as guidance (e.g., "Suggest starting with: 1.Basic auth, then evolving to OAuth, then RBAC"), but generate only the first stage in `.target.md` — subsequent stages emerge through the evolving → target cycle
        - **ELSE**: generate single-stage `.target.md` (simplified format)
      - **ELSE** (status ∉ {`draft`, `planning`}): update current stage target content (no multi-stage analysis — plan is already based on current stage target)
      - Atomic write to `.working/.target.md` + update `.status.json` + Git commit: `task-ai(<notebook>):target update objective`
      - Execute highlight protocol scope=thinking-raw (optional, high-value). Inline call failure MUST NOT block target's main flow.

   3e. **Convergence Baseline Generation** (after `.target.md` write, before Git commit):

      Generate or update `.convergence-baseline.md` — a structured file containing atomized requirements from `.target.md` with weights. Format:

      ```markdown
      # Convergence Baseline

      Generated from: .target.md Overall Objective + Requirements
      Updated: <ISO-8601 timestamp>

      | # | Requirement | Weight | Source |
      |---|------------|--------|--------|
      | R1 | JWT 认证登录 | 3 | Objective |
      | R2 | Refresh token 刷新 | 2 | Requirements §1 |
      ```

      Weight levels: **critical = 3** (core functionality, must-have), **important = 2** (main feature, can degrade), **optional = 1** (nice-to-have).

      **Trigger-based behavior:**

      | Trigger | Baseline action |
      |---------|----------------|
      | First write (stage 1, from draft) | Extract atomic requirements from `.target.md` → generate `.convergence-baseline.md` |
      | `--refine` | Incremental update — add/modify R# entries |
      | Stage advance (evolving → planning, step 3a) | Baseline unchanged (Overall Objective unchanged) |
      | Modify Overall Objective | Regenerate baseline (preserve existing score records) |
      | Re-enter from satisfied (step 3c) | Regenerate baseline (new Overall Objective) |

      Include `.convergence-baseline.md` in the Git commit scope alongside `.target.md` and `.status.json`.

4. **If `objective` is omitted (Read Mode)**:
   - **Read**: Read the content of `.working/.target.md`.
   - **Display**: Output the structured objective to the conversation window.
5. **Validation**: Confirm the target reflects the user's intent.
6. **Next Step Prompt** (MUST output after write mode completes — see table below).

## Next Step Prompt

After write mode completes, output the exact next step based on the resulting status:

| Resulting Status | Prompt (output verbatim) |
|-----------------|--------------------------|
| `planning` (from `draft`) | "Target defined. Next: `/task-ai:research --caller target` to deepen the objective, or `/task-ai:plan` to generate the implementation plan." |
| `planning` (from `evolving`) | "Stage <N+1> target defined. Next: `/task-ai:plan` to generate the implementation plan for this stage." |
| `planning` (from `satisfied`) | "Re-entering evolution. Next: `/task-ai:plan` to generate the implementation plan." |
| `planning` (from `blocked`) | "Target revised. Next: `/task-ai:plan` to re-plan with the updated objective." |
| `planning` / `re-planning` (refinement) | "Target updated. Next: `/task-ai:plan` to regenerate the plan with the revised objective." |
| `executing` (mid-exec update) | "Target updated mid-execution. Impact analysis needed — review current plan against revised objective." |
| `satisfied` (from `--satisfy`) | "Task marked as satisfied. Use `/task-ai:target` to re-enter evolution if needed." |

> **Why mandatory**: Without this prompt, the user has no clear signal of what to do next after defining the target. The target→plan transition is the most common point where users get stuck.

## State Transitions

| Current Status | Result | Next Status | Checkpoint | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `draft` | (updated) | `planning` | `post-target` | Target defined |
| `planning` | (updated) | `planning` | `re-plan` | Objective refined |
| `review` | (updated) | `re-planning` | `re-plan` | Requirements changed after plan review |
| `executing` | (updated) | `executing` | `mid-exec` | Goal adjustment mid-execution |
| `re-planning` | (updated) | `re-planning` | `re-plan` | Objective refined during re-planning |
| `blocked` | (updated) | `planning` | `post-target` | Target revised to unblock |
| `evolving` | (updated) | `planning` | `post-target` | Next stage defined |
| `evolving` | --satisfy | `satisfied` | — | User temporarily satisfied |
| `satisfied` | (updated) | `planning` | `post-target` | Re-enter evolution |
| `cancelled` | REJECT | — | — | Terminal state |

## Git

| Command | Commit Message |
| :--- | :--- |
| `target` | `task-ai(<notebook>):target update objective` |
| `target --refine` | `task-ai(<notebook>):target refine objective` |
| `target` (stage advance) | `task-ai(<notebook>):target stage <N+1> defined` |
| `target --satisfy` | `task-ai(<notebook>):target mark satisfied` |
| `target` (re-enter from satisfied) | `task-ai(<notebook>):target re-enter evolution` |

Files committed: `.target.md`, `.status.json` (if changed), `.convergence-baseline.md` (if generated/updated).

## Notes

- **Read-only in frontend**: `.target.md` is displayed as read-only in the frontend. Users submit change requests via annotations, which are processed by the `target` sub-command to regenerate the document. This prevents format corruption in multi-stage targets.
- **Context Loading**: If the agent's context is compressed, `/task-ai:target` without arguments is the standard way to reload the task's mission into memory.
- **Accepted risk (evolving trust)**: In the progressive evolution model, `--satisfy` relies on user judgment — the system accepts the risk that "satisfied" may be premature. This is by design: `satisfied` is non-terminal, so users can re-enter evolution at any time.
- **Baseline upper limit**: `.convergence-baseline.md` MUST contain ≤ 30 R# items. If the objective decomposes into more, merge fine-grained items to maintain a manageable convergence surface.
