---
name: merge
description: "Merge completed task branch to main — with conflict resolution and verification retry. Does not delete branches or worktrees. Triggered after check post-exec ACCEPT verdict confirms all tests pass."
model_tier: medium
auto_delegatable: false
arguments:
  - name: notebook
    description: "Notebook name (e.g., auth-refactor)"
    required: false
---

# /task-ai:merge — Merge Task Branch to Main

Merge a completed task's branch into main, with automated conflict resolution and verification.

## Usage

```
/task-ai:merge <notebook_name>
```

## Prerequisites

- Task status must be `executing`
- Latest `.analysis/` file must contain an ACCEPT verdict (from `check --checkpoint post-exec`)
- **Dependency gate**: All `depends_on` modules must meet their required status — simple string entries require `complete`, extended `{ module, min_status }` entries require at-or-past `min_status` (see depends_on Format in `commands/task-ai.md`). If any dependency is not met, merge REJECTS with error listing blocking dependencies and their current statuses

## Merge Strategy

### Phase 1: Pre-Merge Refactoring

1. **Review** code changes on task branch for cleanup opportunities (dead code, naming, duplication)
2. **Commit** cleanup: `task-ai(<notebook>):refactor cleanup before merge`

### Phase 2: Merge Attempt

1. **If worktree**: `cd <project-root>` first (worktree is locked to task branch)
2. **Checkout main** (non-worktree) or already on main (worktree, from main worktree)
3. **Attempt merge**:
   ```bash
   git merge task/<notebook> --no-ff -m "task-ai(<notebook>):merge merge completed task"
   ```

### Phase 3: Conflict Resolution (if merge fails)

If merge conflict detected:

1. **Analyze** conflict markers in affected files
2. **Resolve** conflicts by applying the task branch's intent while preserving main's changes
3. **Run verification**: build check, test suite, `lsp_diagnostics`
4. **If verification passes**: commit merge resolution, proceed to Phase 4
5. **If verification fails**: abort merge (`git merge --abort`), retry from Phase 2 with different resolution strategy
6. **Max 3 resolution attempts** — after 3 failures → stay `executing`, report unresolvable conflicts (user can manually resolve then re-run merge)

### Phase 4: Post-Merge Finalization

On successful merge:

1. **Update** `.index.json` status → `complete`, update timestamp — **retain** `branch` and `worktree` values (branch/worktree cleanup is the user's responsibility)
2. **Write** `.summary.md` with final task summary: completion status, plan overview, key changes, verification outcome, lessons learned (integrate from directory summaries)
3. **Git commit** state: `task-ai(<notebook>):merge task completed`

> **Note**: Merge does NOT delete branches or worktrees. The user can clean them up manually or via a separate cleanup command when ready.

## Execution Steps

1. **Read** `.index.json` — validate status is `executing`
2. **Validate dependencies**: read `depends_on` from `.index.json`, check each dependency module's `.index.json` status against its required level (simple string → `complete`, extended object → at-or-past `min_status`). If any dependency is not met, REJECT with error listing blocking dependencies
3. **Verify** ACCEPT verdict: check latest `.analysis/` file for `post-exec-accept`
4. **Read** `.summary.md` for task context (plan overview, completed steps, key decisions)
5. **Phase 1**: Task-level refactoring on task branch
6. **Phase 2**: Attempt merge to main
7. **If conflict** (Phase 3):
   7.1. Parse conflict files
   7.2. Attempt resolution (up to 3 tries)
   7.3. Each resolution: fix conflicts → verify (build + test) → if pass commit, if fail abort and retry
   7.4. If all 3 attempts fail → stay `executing`, abort merge, report unresolvable conflicts
8. **Phase 4**: Post-merge finalization (status → `complete` with branch/worktree retained, write `.summary.md`, git commit state)
9. **Write** `.auto-signal` — MUST be written AFTER Phase 4 status update to `complete`, so the daemon reads correct status when routing to `report`
10. **Report** merge result

## State Transitions

| Current Status | After Merge | Condition |
|----------------|-------------|-----------|
| `executing` | `complete` | Merge successful (with or without conflict resolution) |
| `executing` | `executing` | Merge conflict unresolvable after 3 attempts (stays `executing` so merge can be retried after manual conflict resolution) |

## Git

| Action | Commit Message |
|--------|---------------|
| Pre-merge cleanup | `task-ai(<notebook>):refactor cleanup before merge` |
| Merge commit | `task-ai(<notebook>):merge merge completed task` |
| Conflict resolution | `task-ai(<notebook>):merge resolve merge conflict` |
| State update | `task-ai(<notebook>):merge task completed` |

## .auto-signal

| Result | Signal |
|--------|--------|
| Success | `{ "step": "merge", "result": "success", "next": "report", "checkpoint": "", "timestamp": "..." }` |
| Conflict | `{ "step": "merge", "result": "conflict", "next": "(stop)", "checkpoint": "", "timestamp": "..." }` |
| Dependency not met | `{ "step": "merge", "result": "rejected", "next": "(stop)", "checkpoint": "dependency-blocked", "timestamp": "..." }` |
| No ACCEPT verdict | `{ "step": "merge", "result": "rejected", "next": "(stop)", "checkpoint": "no-accept", "timestamp": "..." }` |

## Notes

- Merge is separated from `check` to isolate conflict resolution logic
- The 3-attempt limit prevents infinite resolution loops
- Each resolution attempt includes full verification (build + test) to ensure resolved code is correct
- On merge failure, status stays `executing` (not `blocked`) so merge can be retried. The user should manually resolve conflicts and then run `/task-ai:merge` again
- After manual resolution, if the user has already merged manually, they can update `.index.json` status to `complete` directly
- Pre-merge refactoring is optional — if no cleanup needed, skip directly to merge
- Merge does **not** delete branches or worktrees — the user retains full control over cleanup timing
- **Concurrency**: Merge acquires `.working/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/task-ai.md`)
