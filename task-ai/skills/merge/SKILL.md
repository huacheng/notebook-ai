---
name: merge
description: "Copy deliverables from task branch to main — selective merge of <notebook>/.deliverables/ only. Does not delete branches or worktrees. Triggered after check post-exec ACCEPT verdict."
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
    Core intent: copy deliverables from a completed task branch to main.
    User says "merge" or "land it" → merge.
    User says "is it done?" → check post-exec. User says "commit" → git commit (not this skill).
arguments: []
---

# /task-ai:merge — Copy Deliverables to Main

Copy a completed task's `<notebook>/.deliverables/` to `<project>/.deliverables/<notebook>/` on main.

## Usage

```
/task-ai:merge
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.working/.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

## Prerequisites

- Task status must be `executing` or `evolving`
- Latest `.analysis/` file must contain an ACCEPT verdict (from `check --checkpoint post-exec`)
- **Dependency gate**: All `depends_on` modules must meet their required status — simple string entries require `satisfied`, extended `{ module, min_status }` entries require at-or-past `min_status` (see depends_on Format in `commands/task-ai.md`). If any dependency is not met, merge REJECTS with error listing blocking dependencies and their current statuses

## Merge Strategy

### Phase 1: Selective Deliverables Copy

1. **If worktree**: `cd <project-root>` first (worktree is locked to task branch)
2. **Checkout main** (non-worktree) or already on main (worktree, from main worktree)
3. **Copy deliverables only** — does NOT do full git merge:
   - Save `<notebook>/.deliverables/` content from task branch to a temp directory (before branch switch)
   - Checkout main
   - Copy temp content to `<project>/.deliverables/<notebook>/` on main
   - Commit
   ```
   Source: <project>/<notebook>/.deliverables/*  (task branch)
   Target: <project>/.deliverables/<notebook>/*  (main branch)
   ```
   Where `<task-branch>` is read from `.status.json` `branch` field (defaults to `task/<notebook>` if unset).
   If the task branch has no `<notebook>/.deliverables/` directory, the copy is silently skipped (no error).

> **Why not full git merge?** Task branches contain system files (`.working/`, `.status.json`, `.plan.md`, etc.) that should NOT pollute the main branch. Only `<notebook>/.deliverables/` content (actual code output) is copied to the project-level `.deliverables/` on main.

### Phase 3: Post-Merge Finalization (on task branch)

After deliverables are copied and committed on main, checkout back to task branch for state update:

1. **If status is `executing`**: Update `.status.json`: status → `evolving`, push completed stage entry to `stage.history` (with commit hash and convergence score)
2. **If status is `evolving`**: Skip stage.history write (auto Phase 4 already wrote it). Merge only copies deliverables in this case
3. Git commit state changes on task branch

**Atomicity**: If state transition fails, status remains `executing` — user can retry merge. If status update succeeds but git commit fails, status is `evolving` — auto re-enters from evolving entry point (highlight → report), no repeated merge.

> **Note**: Merge does NOT delete branches or worktrees. The user can clean them up manually or via a separate cleanup command when ready.

## Execution Steps

1. **Read** `.status.json` — validate status is `executing` or `evolving`
2. **Validate dependencies**: read `depends_on` from `.status.json`, check each dependency module's `.status.json` status against its required level (simple string → `satisfied`, extended object → at-or-past `min_status`). If any dependency is not met, REJECT with error listing blocking dependencies
3. **Verify** ACCEPT verdict: check latest `.analysis/` file for `post-exec-accept`
4. **Read** `.summary.md` for task context (plan overview, completed steps, key decisions)
5. **Phase 1**: Save `<notebook>/.deliverables/` to temp → checkout main → copy to `<project>/.deliverables/<notebook>/` → commit
6. **If no `<notebook>/.deliverables/`**: skip copy, proceed to Phase 3 (state update still happens)
7. **Checkout back** to task branch (state files live on task branch, not master)
8. **Phase 3**: Update `.status.json`: status → `evolving`, push entry to `stage.history` → git commit `stage <N> completed`
9. **Report** merge result. Then output next step prompt based on outcome:
    - `evolving` → "Stage <N> deliverables copied. Next: `/task-ai:highlight` to distill stage experience, then `/task-ai:report` for the stage report."

## State Transitions

| Current Status | After Merge | Condition |
|----------------|-------------|-----------|
| `executing` | `evolving` | Deliverables copied (or no deliverables to copy) |
| `executing` | `executing` | Checkout failed, no ACCEPT verdict, or state transition failed |

## Git

| Action | Commit Message |
|--------|---------------|
| Copy deliverables | `task-ai(<notebook>):merge copy deliverables from <task-branch>` |
| State update | `task-ai(<notebook>):merge stage <N> completed` |

## Notes

- Merge copies only `.deliverables/` from the task branch — no full git merge, no conflict resolution needed
- If the task branch has no `.deliverables/`, the copy is skipped silently and state still transitions to `evolving`
- Refactoring is exec's per-step responsibility (exec Per-Step step 6 Refactor window) — merge does not refactor
- Merge does **not** delete branches or worktrees — the user retains full control over cleanup timing
- **Concurrency**: Lock acquisition/release is handled by the caller (auto mode or CLI dispatcher). `merge.sh` assumes `.working/.lock` is already held (see Concurrency Protection in `commands/task-ai.md`)
