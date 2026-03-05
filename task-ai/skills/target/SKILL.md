---
name: target
description: "Define, refine, and review task objectives and requirements in .target.md. Supports both conversational definition and file-based editing."
model_tier: heavy
auto_delegatable: true
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
    description: "Append a refinement to existing target (used by agent during target-refinement phase)"
    required: false
  - name: --finalize
    description: "Exit target-refinement phase, signal target is ready for planning"
    required: false
---

# /task-ai:target — Define and Review Task Objective

Define or review the core mission for a notebook. This command acts as the cognitive anchor for `plan` and `exec`. It provides a bidirectional bridge between the user's natural language and the physical `.target.md` file.

## Usage

```bash
# Write mode: define/update objective, enter target-refinement phase
/task-ai:target "Build a JWT authentication system"

# Read mode: display current target
/task-ai:target

# Refine mode: append refinement (agent calls this during conversation)
/task-ai:target --refine "Use refresh tokens for session extension"

# Finalize mode: exit target-refinement phase
/task-ai:target --finalize
```

## Target-Refinement Phase

When `/target "..."` is called with content, the system enters **target-refinement phase**:

1. **Entry**: `/target "objective"` writes to `.target.md` and creates `.session-context`
2. **During phase**: Agent monitors conversation for objective refinements
   - Agent detects user refining the goal → automatically calls `target --refine "content"`
   - Refinements are appended to `## Refinements` section in `.target.md`
3. **Exit**: `/plan` or `/target --finalize` clears `.session-context`

### Agent Behavior (Prompt Injection)

When `.session-context` exists with `phase: target-refinement`, the agent receives:
```
You are in target-refinement phase.
Current target: <content of .target.md>

When user's conversation refines, clarifies, or adjusts the objective,
automatically call: /task-ai:target --refine "<extracted refinement>"
No explicit command needed from user.
```

### .target.md Structure

```markdown
# Task Target: notebook-name

## Objective

Build a JWT authentication system

## Refinements

- [2026-03-04 10:05] Use refresh tokens for session extension
- [2026-03-04 10:08] Support OAuth login via Google

## Requirements

<!-- ... -->
```

## Execution Steps

1. **Context discovery**:
   - Locate the current notebook via path-based discovery (`.working/` directory) or branch-based discovery (`task/<name>`).
   - If context cannot be identified, abort with error: "No active task context detected. Enter a notebook directory or switch to a task branch."
   - **Read** `.index.json` `stage` field (default `{ current: 1, total: 1, completed: [] }` if missing) and `status`.
   - **If status is `complete` or `cancelled`**: REJECT with error "Completed/cancelled tasks cannot be re-targeted." Abort execution.

2. **If `objective` is provided (Write Mode)** — three-branch routing:

   2a. **IF status == `stage-done`** → **Stage Advance Mode**:
      1. Read `.target.md`, locate next `[PENDING]` Stage
      2. Write user's objective to that Stage's Objective/Requirements/Constraints
      3. Mark switch: current Stage `[PENDING]` → `[ACTIVE]`
      4. Archive (if exists — skip missing files, non-fatal): `.plan.md` → `.plan-stage-<N>.md` (where N = just-completed stage); `.plan-superseded.md` → `.plan-superseded-stage-<N>.md` (if exists); `.analysis/` → `.analysis-stage-<N>/` (if exists); `.test/` → `.test-stage-<N>/` (if exists)
      5. Clear (non-fatal — skip if directory missing or empty): `.bugfix/` directory contents
      6. Update `.index.json`: `stage.current++`, `status` → `planning`, `completed_steps` → `0`
      7. Git commit: `task-ai(<notebook>):target stage <N+1> defined`
      8. Execute highlight protocol scope=thinking-raw (optional, high-value)

      **Atomicity**: status change (step 6) occurs AFTER archive/clear (steps 4-5). If steps 4-5 fail, status stays `stage-done` — user can retry. If step 6 succeeds but step 7 fails, status is already `planning` — re-running target detects `planning` and routes to normal update path.

   2b. **ELIF `stage.total > 1`** → **Multi-stage Update Mode**:
      - Update current `[ACTIVE]` Stage's content in `.target.md`
      - Atomic write + Git commit: `task-ai(<notebook>):target update objective`
      - Execute highlight protocol scope=thinking-raw (optional, high-value)

   2c. **ELSE** (normal mode, including first definition) → **Normal/Multi-stage Analysis Mode**:
      - **IF status ∈ {`draft`, `planning`}**: evaluate objective complexity:
        - Is it beyond a single plan→exec→merge cycle?
        - Are there natural stage boundaries?
        - **IF suggests splitting**: propose stages to user (e.g., "Suggest 3 stages: 1.Basic auth 2.OAuth 3.RBAC"), await confirmation/modification, then generate multi-stage `.target.md` format + update `.index.json` `stage.total`
        - **ELSE**: generate single-stage `.target.md` (simplified format)
      - **ELSE** (status ∉ {`draft`, `planning`}): update current stage target content (no multi-stage analysis — plan is already based on current stage target)
      - Atomic write to `.working/.target.md` + update `.index.json` + Git commit: `task-ai(<notebook>):target update objective`
      - Execute highlight protocol scope=thinking-raw (optional, high-value). Inline call failure MUST NOT block target's main flow.

3. **If `objective` is omitted (Read Mode)**:
   - **Read**: Read the content of `.working/.target.md`.
   - **Display**: Output the structured objective to the conversation window.
4. **Validation**: Confirm the target reflects the user's intent.

## State Transitions

| Current Status | Result | Next Status | Checkpoint | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `draft` | (updated) | `planning` | `post-target` | Target defined, ready for research or planning. |
| `planning` | (updated) | `planning` | `re-plan` | Objective refined during planning; requires plan regeneration. |
| `executing` | (updated) | `executing` | `mid-exec` | Goal adjustment mid-execution; requires impact analysis. |
| `stage-done` | (updated) | `planning` | `stage-advance` | Next stage target defined, enter planning for new stage. |
| `review` | (updated) | `re-planning` | `mid-review` | Objective refined during review; requires re-planning. |
| `re-planning` | (updated) | `re-planning` | `re-plan` | Objective refined during re-planning; plan regeneration needed. |
| `blocked` | (updated) | `planning` | `unblock` | Target revised to unblock; re-enter planning. |
| `complete` | REJECT | — | — | Completed tasks cannot be re-targeted. |
| `cancelled` | REJECT | — | — | Cancelled tasks cannot be re-targeted. |

## Git

| Command | Type | Scope | Subject |
| :--- | :--- | :--- | :--- |
| `target` | `target` | `state` | `target update objective` |
| `target` | `target` | `state` | `target stage <N+1> defined` |

## Notes

- **Read-only in frontend**: `.target.md` is displayed as read-only in the frontend. Users submit change requests via annotations, which are processed by the `target` sub-command to regenerate the document. This prevents format corruption in multi-stage targets.
- **Context Loading**: If the agent's context is compressed, `/task-ai:target` without arguments is the standard way to reload the task's mission into memory.
- **Accepted risk — `stage-done` trust**: In Stage Advance Mode (step 2a), target trusts that the prior stage was genuinely completed (merge set `stage-done` after ACCEPT verdict). There is no re-verification of the prior stage. This is an accepted risk: if `.index.json` is manually corrupted to `stage-done`, target will advance without checking. Mitigation: `.index.json` is only written atomically by lifecycle commands, and manual edits are explicitly unsupported.
