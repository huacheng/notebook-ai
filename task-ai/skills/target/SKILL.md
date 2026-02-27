---
name: target
description: "Define, refine, and review task objectives and requirements in .target.md. Supports both conversational definition and file-based editing."
model_tier: heavy
auto_delegatable: true
arguments:
  - name: objective
    description: "The task goal, requirements, and constraints (optional — omit to read current target)"
    required: false
---

# /task-ai:target — Define and Review Task Objective

Define or review the core mission for a notebook. This command acts as the cognitive anchor for `plan` and `exec`. It provides a bidirectional bridge between the user's natural language and the physical `.target.md` file.

## Usage

- **Write Mode**: `/task-ai:target "Objective content..."` — Updates `.target.md` and commits the change.
- **Read Mode**: `/task-ai:target` — Reads and displays the current `.target.md` to ensure common understanding.

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
