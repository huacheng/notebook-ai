---
name: cancel
description: "Cancel a task module — set status to cancelled, stop auto if running, optionally clean up worktree. Use when a task becomes infeasible, is deprioritized, or needs to be abandoned."
model_tier: light
auto_delegatable: true
arguments:
  - name: notebook
    description: "Notebook name (e.g., auth-refactor)"
    required: false
  - name: reason
    description: "Cancellation reason (recorded in .index.json)"
    required: false
  - name: cleanup
    description: "Also remove git worktree and delete the task branch (flag, no value)"
    required: false
---

# /task-ai:cancel — Cancel Task Module

Cancel a task module, stopping any active auto loop and optionally cleaning up the git worktree.

## Usage

```
/task-ai:cancel <notebook_name> [--reason "..."] [--cleanup]
```

## Arguments

- **notebook** (required): notebook name
- **--reason** (optional): cancellation reason, recorded in `.index.json` body
- **--cleanup** (optional): also remove the git worktree and delete the task branch

## Execution Steps

1. **Read** `.index.json` — get current status
2. **Stop auto** if running:
   - Call `GET /api/task-auto/lookup?taskDir=<notebook_working_dir>` to find the session running this task's auto loop
   - If found (200): call `DELETE /api/sessions/<session_name>/task-auto`
   - If not found (404): no auto loop running, skip
   - Delete `.auto-signal` file if exists
   - Delete `.auto-stop` file if exists
   - Delete `.lock` file if exists — first read lock content and verify the holder: (a) if holder `pid` is dead → delete lock (stale); (b) if holder `session` matches the auto session being cancelled → delete lock (same session); (c) if held by a **different live session** → REJECT with error identifying the holding session — user must stop that session first or use `cancel` from the holding session. Cancel does NOT force-override locks held by other live sessions to prevent concurrent write corruption
3. **Acquire** `.working/.lock` (see Concurrency Protection in `commands/task-ai.md`). If lock is held by a different live session (not the auto session stopped in step 2), REJECT — user must stop that session first
4. **If uncommitted changes exist**, git commit snapshot: `task-ai(<notebook>):cancel pre-cancel snapshot`
5. **Update** `.index.json`:
   - Set `status` to `cancelled`
   - Update `updated` timestamp
   - Append cancellation reason to body (if provided)
6. **Write** `.summary.md` with condensed context: current status, cancellation reason, progress at time of cancellation (`completed_steps`), any known issues
7. **Git commit**: `task-ai(<notebook>):cancel user cancelled`
8. **Release** `.working/.lock`
9. **If `--cleanup`**:
   - Remove worktree: `git worktree remove .worktrees/task-<module>`
   - Delete branch: `git branch -d task/<notebook>` (safe delete — warns if unmerged). If `-d` fails because branch has unmerged work, report warning to user with the unmerged commit count. User can explicitly re-run with `git branch -D` if they want to force-delete
10. **Report** cancellation result

## State Transitions

| Current Status | After Cancel | Condition |
|----------------|--------------|-----------|
| `draft` | `cancelled` | Always |
| `planning` | `cancelled` | Always |
| `review` | `cancelled` | Always |
| `executing` | `cancelled` | Always |
| `re-planning` | `cancelled` | Always |
| `blocked` | `cancelled` | Always |
| `complete` | REJECT | Terminal state |
| `cancelled` | REJECT | Terminal state |

## Notes

- Cancel is rejected on terminal statuses: `complete` (use a separate workflow to reopen) and `cancelled` (already terminal)
- If the task has uncommitted code changes in a worktree, `--cleanup` will warn before deleting
- Without `--cleanup`, the branch and worktree are preserved for reference
- A cancelled task can be referenced by `report` for documentation purposes
- **Concurrency**: Cancel acquires `.working/.lock` before modifying files and releases on completion (see Concurrency Protection in `commands/task-ai.md`). Lock cleanup for the auto session (step 2) is separate from cancel's own lock acquisition (step 3)
