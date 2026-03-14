---
name: target
description: "Define task objectives and requirements in .target.md. Use when the user describes what they want to build, says 'I want to...', 'the goal is...', 'set the target', 'define requirements', or needs to clarify/refine what should be accomplished before planning."
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
    User states a concrete goal ("I want to do X") or modifies existing one ("change to Y") -> target.
    User says "deepen objective" or "feasibility research" -> research --caller target, NOT target.
    Ambiguous word "requirements": user DESCRIBING requirement content -> target; user INVESTIGATING what's missing -> research.
arguments:
  - name: objective
    description: "The task goal, requirements, and constraints (optional — omit to read current target)"
    required: false
  - name: --refine
    description: "Append a refinement to existing target (used by agent during target-refinement phase). Requires a value argument: --refine \"content\""
    required: false
  - name: --refine-item
    description: "Incremental R# splitting for a single Overall Objective sub-item. Called by auto during Phase 1 dialog. Decomposes the sub-item into atomic R# requirements and writes to .target.md ## Requirements section. Value: the sub-item text."
    required: false
  - name: --refine-item-delete
    description: "Remove a sub-item's R# entries from .target.md ## Requirements section and re-number remaining R# globally. Called by auto when user drops a sub-item. Value: the sub-item text to match."
    required: false
  - name: --satisfy
    description: "Mark task as satisfied (only valid in evolving status). Non-terminal — can re-enter evolution later via /task-ai:target"
    required: false
---

# /task-ai:target — Define and Review Task Objective

Define or review the core mission for a notebook. This command acts as the cognitive anchor for `plan` and `exec`. It provides a bidirectional bridge between the user's natural language and the physical `.target.md` file.

> **Path Rule**: All system files (`.status.json`, `.target.md`, `.plan.md`, etc.) are in `$TASKAI_WORK_DIR/` (= `$NB_WORK_DIR/.working/`), NOT in `$NB_WORK_DIR/` directly. See `commands/task-ai.md` §System File Path Rule.

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

The agent maintains phase awareness via `.status.json` (see Phase Awareness Protocol in `commands/task-ai.md`).

When the user expresses intent to modify the target during `planning` status, the agent calls `/task-ai:target --refine "..."` naturally. No additional phase file is needed — `.status.json` `status: planning` is sufficient context.

### .target.md Structure

**Status Markers** (see `commands/references/progressive-target.md` for full lifecycle):

| Marker | Applies To | Meaning |
|--------|------------|---------|
| (no marker) | Objective item | Item is being discussed/refined — not included in plan |
| `[CONFIRMED]` | Objective item | Item confirmed by user, will be included in plan |
| `[PROCESSED]` | Objective item | Plan generated for this item, execution in progress |

**Plan gate**: At least one `[CONFIRMED]` item required before plan can proceed. Items without markers are excluded from current plan scope.
| `[ACTIVE]` | Stage | Currently executing stage |
| `[COMPLETE]` | Stage | Completed stage |

**Phase 1 (draft status, objective under discussion):**
```markdown
# Task Target: notebook-name

## Overall Objective

- Build a JWT authentication system for user login
- Support refresh tokens for session extension
- Integrate with existing user database

## Refinements

- [2026-03-04 10:05] Add OAuth2 provider support

## Requirements

<!-- List specific requirements -->

## Constraints

<!-- Any constraints or limitations -->
```

**Phase 1 (partial confirmation — some items confirmed):**
```markdown
## Overall Objective

- Build a JWT authentication system for user login [CONFIRMED]
- Support refresh tokens for session extension [CONFIRMED]
- Integrate with existing user database
- Add OAuth2 provider support
```

**Overall Objective Format**: Always break down into itemized bullet points. Never write as a single long paragraph. Each item should be:
- One atomic goal (testable completion)
- Concrete and specific (not vague)
- Independent enough to track separately
- Marked `[CONFIRMED]` when user approves, or no marker if still discussing

**Phase 1 complete (all items confirmed, status → planning):**
```markdown
# Task Target: notebook-name

## Overall Objective

- Build a JWT authentication system for user login [CONFIRMED]
- Support refresh tokens for session extension [CONFIRMED]
- Integrate with existing user database [CONFIRMED]
- Add OAuth2 provider support (Google, GitHub) [CONFIRMED]

## Requirements
...
```

**Stage 1 active (status=executing, plan generated):**
```markdown
# Task Target: notebook-name

## Overall Objective

- Build a JWT authentication system for user login [PROCESSED]
- Support refresh tokens for session extension [PROCESSED]
- Integrate with existing user database [CONFIRMED]
- Add OAuth2 provider support (Google, GitHub) [CONFIRMED]

---

## Stage 1: Basic JWT Auth [ACTIVE]
### Stage Objective
...
```

## Execution Steps

1. **Context discovery**:
   - Locate the current notebook via path-based discovery (`.working/` directory) or branch-based discovery (`task/<name>`).
   - If context cannot be identified, abort with error: "No active task context detected. Enter a notebook directory or switch to a task branch."
   - **Read** `.status.json` `stage` field (default `{ current: 1, history: [] }` if missing) and `status`.
   - **If status is `cancelled`**: REJECT with error "Cancelled tasks cannot be re-targeted." Abort execution.

2. **If `--satisfy` is provided**:
   - If status != `evolving` → REJECT with error "Can only satisfy tasks in evolving status."
   - **MANDATORY STATUS UPDATE**:
     - Read current `.status.json`
     - Set `"status"`: `"satisfied"`
     - Update `"updated"` timestamp
     - Write back with Edit tool
     - **VERIFY**: After write, read `.status.json` again to confirm `status` is `satisfied`. If unchanged, retry or abort
   - Git commit `task-ai(<notebook>):target mark satisfied`, output message "Task marked as satisfied."

2b. **If `--refine-item` is provided** (Incremental R# Splitting):
   - **Precondition**: status == `draft` (Phase 1 dialog). If status != `draft` → REJECT with error "Incremental R# splitting is only valid during Phase 1 (draft status)."
   - Read `.target.md` `## Requirements` section
   - Decompose the sub-item text into atomic R# requirements (same atomization rules as step 3e):
     - **Atomic**: One verifiable behavior per R#
     - **Testable**: Concrete acceptance criteria
     - **Independent**: Can be scored 0.0-1.0 independently
   - Assign weight: critical = 3, important = 2, optional = 1
   - **If sub-item already has R# entries** (re-split on update):
     - Find the sub-heading matching the sub-item under `## Requirements`
     - Remove all existing R# entries under that sub-heading
     - Write new R# entries
     - Re-number all R# globally (R1, R2, ... sequential across all sub-items)
   - **If new sub-item**:
     - Append new sub-heading + R# table under `## Requirements`
     - Number R# continuing from the last existing R#
   - Update `(R: N)` annotation on the matching sub-item in `## Overall Objective`
   - **Do NOT generate `.convergence-baseline.md`** — that happens at final confirmation (see `auto/references/objective-extraction.md` §Final Confirmation)
   - **Do NOT change `.status.json` status** — remains `draft`
   - No git commit (lightweight operation during dialog; committed at confirmation)
   - Output: brief confirmation — "Sub-item '{sub-item}' → {N} requirements (R{start}-R{end})"

2c. **If `--refine-item-delete` is provided** (Sub-item R# Deletion):
   - **Precondition**: status == `draft`. If status != `draft` → REJECT.
   - Find the sub-heading matching the sub-item text under `## Requirements` (semantic match, same as `--refine-item`)
   - If no matching sub-heading found → output "No R# entries found for '{sub-item}' — nothing to delete." and return
   - Remove the sub-heading and all R# entries beneath it
   - Re-number remaining R# globally (R1, R2, ... sequential)
   - **Do NOT change `.status.json` status** — remains `draft`
   - No git commit
   - Output: brief confirmation — "Sub-item '{sub-item}' R# entries removed. {remaining} requirements remain."

3. **If `objective` is provided (Write Mode)** — three-branch routing:

   3a. **IF status == `evolving`** → **Stage Advance Mode**:
      Trigger: auto Phase 4 evolving entry auto-invocation (sub-stage objectives are LLM-generated), or user manual `/task-ai:target`
      1. Read `.target.md`, archive old plan: `.plan.md` → `.plan-stage-<N>.md` (where N = current stage); `.plan-superseded.md` → `.plan-superseded-stage-<N>.md` (if exists); `.analysis/` → `.analysis-stage-<N>/` (if exists); `.test/` → `.test-stage-<N>/` (if exists). Skip missing files (non-fatal).
      2. Clear (non-fatal — skip if directory missing or empty): `.bugfix/` directory contents
      3. Increment `stage.current`, append new Stage section to `.target.md` with user's objective
      4. **MANDATORY STATUS UPDATE**:
         - Read current `.status.json`
         - Set `stage.current` incremented
         - Set `"status"`: `"planning"`
         - Set `"completed_steps"`: `0`
         - Update `"updated"` timestamp
         - Write back with Edit tool
         - **VERIFY**: After write, read `.status.json` again to confirm `status` is `planning`. If unchanged, retry or abort
      5. Git commit: `task-ai(<notebook>):target stage <N+1> defined`
      6. Execute highlight protocol scope=thinking-raw (optional, high-value)

      **Atomicity**: status change (step 4) occurs AFTER archive/clear (steps 1-2). If steps 1-2 fail, status stays `evolving` — user can retry. If step 4 succeeds but step 5 fails, status is already `planning` — re-running target detects `planning` and routes to normal update path.

   3b. **ELIF `stage.current > 1`** → **Multi-stage Update Mode**:
      - Update current `[ACTIVE]` Stage's content in `.target.md`
      - Atomic write + Git commit: `task-ai(<notebook>):target update objective`
      - Execute highlight protocol scope=thinking-raw (optional, high-value)

   3c. **ELIF status == `satisfied`** → **Re-enter Evolution**:
      - **MANDATORY STATUS UPDATE**:
        - Read current `.status.json`
        - Set `"status"`: `"planning"`
        - Update `"updated"` timestamp
        - Write back with Edit tool
        - **VERIFY**: After write, read `.status.json` again to confirm `status` is `planning`. If unchanged, retry or abort
      - Write user's objective to `.target.md`
      - Git commit: `task-ai(<notebook>):target re-enter evolution`

   3d. **ELSE** (normal mode, including first definition) → **Normal/Multi-stage Analysis Mode**:
      - **IF status == `draft`** (Phase 1 dialog in progress):
        - Write `.target.md` with `## Overall Objective` and itemized goals (no markers — all items under discussion)
        - When user confirms specific items: add `[CONFIRMED]` marker to each confirmed item (e.g., `- Build JWT auth [CONFIRMED]`)
        - Plan can proceed once at least one item has `[CONFIRMED]`
        - Evaluate objective complexity:
          - Is it beyond a single plan→exec→ACCEPT cycle?
          - Are there natural stage boundaries?
          - **IF suggests splitting**: propose stages to user as guidance (e.g., "Suggest starting with: 1.Basic auth, then evolving to OAuth, then RBAC"), but generate only the first stage in `.target.md` — subsequent stages emerge through the evolving → target cycle
        - When generating Stage 1: remove `[CONFIRMED]` from Overall Objective, add `## Stage 1: <name> [ACTIVE]`
        - **MANDATORY STATUS UPDATE** (after Stage 1 generated):
          - Read current `.status.json`
          - Set `"status"`: `"planning"`
          - Update `"updated"` timestamp
          - Write back with Edit tool
          - **VERIFY**: After write, read `.status.json` again to confirm `status` is `planning`. If unchanged, retry or abort
      - **ELIF status == `planning`**: update existing `.target.md` content (no marker changes)
      - **ELSE** (status ∉ {`draft`, `planning`}): update current stage target content (no multi-stage analysis — plan is already based on current stage target)
      - Atomic write to `.target.md` + Git commit: `task-ai(<notebook>):target update objective`
      - Execute highlight protocol scope=thinking-raw (optional, high-value). Inline call failure should not block target's main flow — highlight is enhancement, not gating.

   3e. **Convergence Baseline Generation** (after `.target.md` write, before Git commit):

      Generate or update `.convergence-baseline.md` — a structured file containing atomized requirements from `.target.md` with weights. Format:

      ```markdown
      # Convergence Baseline

      Generated from: .target.md Overall Objective + Requirements
      Updated: <ISO-8601 timestamp>

      | # | Requirement | Acceptance Criteria | Weight | Source |
      |---|-------------|---------------------|--------|--------|
      | R1 | JWT token generation on login | Returns valid JWT with user_id, exp, iat claims; token verifiable with secret | 3 | Objective |
      | R2 | Token expiration handling | Rejects expired tokens with 401; exp claim honored | 3 | Objective |
      | R3 | Refresh token issuance | Refresh token stored securely; longer TTL than access token | 2 | Requirements §1 |
      | R4 | Refresh token rotation | Old refresh token invalidated on use; new pair issued | 2 | Requirements §1 |
      | R5 | Token revocation | Logout invalidates all tokens for user; revoked tokens rejected | 2 | Requirements §2 |
      ```

      **R# Atomization Rules** — each R# must be:
      - **Atomic**: One verifiable behavior per R# (not "authentication system" but "login returns JWT")
      - **Testable**: Has concrete acceptance criteria (not "works correctly" but "returns 401 on expired token")
      - **Independent**: Can be scored 0.0-1.0 without depending on other R# completion
      - **Granular**: If a requirement has multiple aspects, split into multiple R# (e.g., R1, R2, R3 instead of one "JWT auth")

      Weight levels: **critical = 3** (core functionality, must-have), **important = 2** (main feature, can degrade), **optional = 1** (nice-to-have).

      **Trigger-based behavior:**

      | Trigger | Baseline action |
      |---------|----------------|
      | First write (stage 1, from draft) | Extract atomic requirements from `.target.md` -> generate `.convergence-baseline.md` |
      | `--refine` | Incremental update — add/modify R# entries |
      | Stage advance (evolving → planning, step 3a) | Baseline unchanged (Overall Objective unchanged) |
      | Modify Overall Objective | Regenerate baseline (preserve existing score records) |
      | Re-enter from satisfied (step 3c) | Regenerate baseline (new Overall Objective) |

      Include `.convergence-baseline.md` in the Git commit scope alongside `.target.md` and `.status.json`.

4. **If `objective` is omitted (Read Mode)**:
   - **Read**: Read the content of `.target.md`.
   - **Display**: Output the structured objective to the conversation window.
5. **Validation**: Confirm the target reflects the user's intent.
6. **Next Step Prompt** (output after write mode completes — guides the user to the correct next lifecycle step).

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
| `evolving` | (updated) | `planning` | `post-target` | LLM auto-generates next substage target → stage advance |
| `evolving` | --satisfy | `satisfied` | — | User temporarily satisfied |
| `satisfied` | refine Overall Objective | `evolving` | — | User refines Overall Objective → update baseline → convergence decreases |
| `satisfied` | (updated) | `planning` | `post-target` | Re-enter evolution |
| `cancelled` | REJECT | — | — | Terminal state |

## Git

| Command | Commit Message |
| :--- | :--- |
| `target` | `task-ai(<notebook>):target update objective` |
| `target --refine` | `task-ai(<notebook>):target refine objective` |
| `target --refine-item` | No commit (lightweight Phase 1 dialog operation) |
| `target --refine-item-delete` | No commit (lightweight Phase 1 dialog operation) |
| `target` (stage advance) | `task-ai(<notebook>):target stage <N+1> defined` |
| `target --satisfy` | `task-ai(<notebook>):target mark satisfied` |
| `target` (re-enter from satisfied) | `task-ai(<notebook>):target re-enter evolution` |

Files committed: `.target.md`, `.status.json` (if changed), `.convergence-baseline.md` (if generated/updated).

## Notes

- **Read-only in frontend**: `.target.md` is displayed as read-only in the frontend. Users submit change requests via annotations, which are processed by the `target` sub-command to regenerate the document. This prevents format corruption in multi-stage targets.
- **Context Loading**: If the agent's context is compressed, `/task-ai:target` without arguments is the standard way to reload the task's mission into memory.
- **Accepted risk (evolving trust)**: In the progressive evolution model, `--satisfy` relies on user judgment — the system accepts the risk that "satisfied" may be premature. This is by design: `satisfied` is non-terminal, so users can re-enter evolution at any time.
- **Baseline upper limit**: `.convergence-baseline.md` should contain ≤ 30 R# items — too many low-weight items dilute the signal from critical requirements, causing convergence scores to become noise. If the objective decomposes into more, merge fine-grained items to maintain a manageable convergence surface.
