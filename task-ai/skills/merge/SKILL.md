---
name: merge
description: "Merge completed task branch to main — with conflict resolution and verification retry. Does not delete branches or worktrees. Triggered after check post-exec ACCEPT verdict."
model_tier: medium
auto_delegatable: false
triggers:
  keywords:
    zh: [合并, 合入, merge, 入主分支, 提交合并]
    en: [merge, integrate, merge to main, land, ship it]
  phrases:
    zh: [合并到主分支, 合入master, 可以合了吗, 提交合并, 合并代码]
    en: [merge to main, merge the branch, ready to merge, land the changes, integrate into master]
  disambiguate: >
    Core intent: merge a completed task branch into main with conflict resolution.
    User says "merge" or "land it" → merge.
    User says "is it done?" → check post-exec. User says "commit" → git commit (not this skill).
arguments: []
---

# /task-ai:merge — Merge Task Branch to Main

Merge a completed task's branch into main, with automated conflict resolution and verification.

## Usage

```
/task-ai:merge
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.working/.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

## Prerequisites

- Task status must be `executing`
- Latest `.analysis/` file must contain an ACCEPT verdict (from `check --checkpoint post-exec`)
- **Dependency gate**: All `depends_on` modules must meet their required status — simple string entries require `complete`, extended `{ module, min_status }` entries require at-or-past `min_status` (see depends_on Format in `commands/task-ai.md`). If any dependency is not met, merge REJECTS with error listing blocking dependencies and their current statuses

## Merge Strategy

### Phase 1: Merge Attempt

1. **If worktree**: `cd <project-root>` first (worktree is locked to task branch)
2. **Checkout main** (non-worktree) or already on main (worktree, from main worktree)
3. **Attempt merge**:
   ```bash
   git merge --no-ff -m "task-ai(<notebook>):merge merge completed task" -- <task-branch>
   ```
   Where `<task-branch>` is read from `.status.json` `branch` field (defaults to `task/<notebook>` if unset).

### Phase 2: Conflict Resolution (if merge fails)

If merge conflict detected:

1. **Analyze** conflict markers in affected files
2. **Resolve** conflicts by applying the task branch's intent while preserving main's changes
3. **Run verification**: build check, test suite, `lsp_diagnostics`
4. **If verification passes**: commit merge resolution, proceed to Phase 3
5. **If verification fails**: abort merge (`git merge --abort`), retry from Phase 1 with different resolution strategy
6. **Max 3 resolution attempts** — after 3 failures → stay `executing`, report unresolvable conflicts (user can manually resolve then re-run merge)

### Phase 3: Post-Merge Finalization

7. **Phase 3**: Post-merge finalization — unified path (always):
   - Write `.summary.md` → update `.target.md` (mark `[COMPLETE]`, fill Results) → status → `evolving` with history push → git commit `stage <N> completed`

**Atomicity**: status change occurs AFTER `.summary.md` and `.target.md` writes. If those fail, status remains `executing` — user can retry merge. If status update succeeds but git commit fails, status is `evolving` — auto re-enters from evolving entry point (highlight → report), no repeated merge.

> **Note**: Merge does NOT delete branches or worktrees. The user can clean them up manually or via a separate cleanup command when ready.

## Execution Steps

1. **Read** `.status.json` — validate status is `executing`
2. **Validate dependencies**: read `depends_on` from `.status.json`, check each dependency module's `.status.json` status against its required level (simple string → `complete`, extended object → at-or-past `min_status`). If any dependency is not met, REJECT with error listing blocking dependencies
3. **Verify** ACCEPT verdict: check latest `.analysis/` file for `post-exec-accept`
4. **Read** `.summary.md` for task context (plan overview, completed steps, key decisions)
5. **Phase 1**: Attempt merge to main
6. **If conflict** (Phase 2):
   6.1. Parse conflict files
   6.2. Attempt resolution (up to 3 tries)
   6.3. Each resolution: fix conflicts → verify (build + test) → if pass commit, if fail abort and retry
   6.4. If all 3 attempts fail → stay `executing`, abort merge, report unresolvable conflicts
   6.5. If conflicts were resolved: execute highlight protocol scope=thinking-raw — see `highlight/SKILL.md` §3.3. Optional (medium-value, only when conflicts occurred). Capture conflict resolution strategy reasoning. Inline call failure MUST NOT block merge's main flow
7. **Phase 3**: Post-merge finalization — unified path (always):
   - Write `.summary.md` → update `.target.md` (mark `[COMPLETE]`, fill Results) → update `.status.json`: status → `evolving`, increment `stage.current`, push entry to `stage.history` → git commit `stage <N> completed`
8. **Write** `.auto-signal` — MUST be written AFTER Phase 3 status update, so the daemon reads correct status when routing
9. **Report** merge result. Then output next step prompt based on outcome:
    - `evolving` → "Stage <N> merged. Next: `/task-ai:highlight` to distill stage experience, then `/task-ai:report` for the stage report."
    - Conflict unresolvable → "Merge conflict could not be resolved automatically. Please resolve manually, then retry `/task-ai:merge`."

## State Transitions

| Current Status | After Merge | Condition |
|----------------|-------------|-----------|
| `executing` | `evolving` | Merge successful (always, via merge) |
| `executing` | `executing` | Merge conflict unresolvable after 3 attempts |
| `executing` | `executing` | Checkout failed, no ACCEPT verdict, or state transition failed (status unchanged, `.auto-signal` written for routing) |

## Git

| Action | Commit Message |
|--------|---------------|
| Merge commit | `task-ai(<notebook>):merge merge completed task` |
| Conflict resolution | `task-ai(<notebook>):merge resolve merge conflict` |
| State update | `task-ai(<notebook>):merge stage <N> completed` |

## .auto-signal

| Result | Signal |
|--------|--------|
| Merged | `{ "step": "merge", "result": "evolving", "next": "highlight", "checkpoint": "", "timestamp": "..." }` |
| Conflict | `{ "step": "merge", "result": "conflict", "next": "(stop)", "checkpoint": "", "timestamp": "..." }` |
| Dependency not met | `{ "step": "merge", "result": "rejected", "next": "(stop)", "checkpoint": "dependency-blocked", "timestamp": "..." }` |
| No ACCEPT verdict | `{ "step": "merge", "result": "rejected", "next": "(stop)", "checkpoint": "no-accept", "timestamp": "..." }` |
| Checkout failed | `{ "step": "merge", "result": "rejected", "next": "(stop)", "checkpoint": "checkout-failed", "timestamp": "..." }` |
| State transition failed | `{ "step": "merge", "result": "rejected", "next": "(stop)", "checkpoint": "state-transition-failed", "timestamp": "..." }` |

## Notes

- Merge is separated from `check` to isolate conflict resolution logic
- The 3-attempt limit prevents infinite resolution loops
- Each resolution attempt includes full verification (build + test) to ensure resolved code is correct
- On merge failure, status stays `executing` (not `blocked`) so merge can be retried. The user should manually resolve conflicts and then run `/task-ai:merge` again
- After manual resolution, if the user has already merged manually, they can update `.status.json` status to `evolving` directly
- Refactoring is exec's per-step responsibility (exec Per-Step step 6 Refactor window) — merge does not refactor. This ensures all code changes are verified within exec's RED→GREEN cycle
- Merge does **not** delete branches or worktrees — the user retains full control over cleanup timing
- **Concurrency**: Lock acquisition/release is handled by the caller (auto mode or CLI dispatcher). `merge.sh` assumes `.working/.lock` is already held (see Concurrency Protection in `commands/task-ai.md`)
