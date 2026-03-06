---
name: cancel
description: "Cancel a task module — set status to cancelled, stop auto if running, optionally clean up worktree. Use when a task becomes infeasible, is deprioritized, or needs to be abandoned."
model_tier: light
auto_delegatable: true
triggers:
  keywords:
    zh: [取消, 放弃, 废弃, 不做了, 中止, 作废]
    en: [cancel, abort, abandon, drop, stop task, kill task]
  phrases:
    zh: [取消这个任务, 不做了, 放弃这个, 任务作废, 停掉这个任务]
    en: [cancel this task, abandon the task, drop this task, I don't want to do this anymore]
  disambiguate: >
    Core intent: permanently cancel a task module and mark it as cancelled.
    User explicitly abandons a task → cancel.
    User wants to PAUSE → not cancel (no pause skill; user just stops invoking commands).
    User wants to stop auto mode only → auto --action stop, not cancel.
arguments:
  - name: reason
    description: "Cancellation reason (recorded in .status.json cancel_reason field)"
    required: false
  - name: cleanup
    description: "Also remove git worktree and delete the task branch (flag, no value)"
    required: false
---

# /task-ai:cancel — Cancel Task Module

Cancel a task module, stopping any active auto loop and optionally cleaning up the git worktree.

## Usage

```
/task-ai:cancel [--reason "..."] [--cleanup]
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.working/.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

## Arguments
- **--reason** (optional): cancellation reason, recorded in `.status.json` `cancel_reason` field
- **--cleanup** (optional): also remove the git worktree and delete the task branch

## Execution Steps

1. **Read** `.status.json` — get current status
2. **Validate status**: If current status is `complete` or `cancelled`, REJECT — terminal states cannot be cancelled
3. **Stop auto** if running:
   - Call `GET /api/task-auto/lookup?taskDir=<notebook_working_dir>` to find the session running this task's auto loop
   - If found (200): call `DELETE /api/sessions/<session_name>/task-auto`
   - If not found (404): no auto loop running, skip
   - Delete `.working/.auto-signal` file if it exists
   - Delete `.working/.auto-stop` file if it exists
   - Handle `.working/.lock` — first read lock content and verify the holder:
     - (a) if holder `pid` is dead → delete lock (stale)
     - (b) if holder `session` matches the auto session being cancelled → delete lock (same session)
     - (c) if held by a **different live session** → REJECT with error identifying the holding session — user must stop that session first or use `cancel` from the holding session. Cancel does NOT force-override locks held by other live sessions to prevent concurrent write corruption
4. **Acquire** `.working/.lock` (see Concurrency Protection in `commands/task-ai.md`). After step 3 cleans up any auto-held lock, this acquires a fresh lock for cancel's own writes. If lock is still held by a different live session, REJECT — user must stop that session first
5. **If uncommitted changes exist**, git commit snapshot: `task-ai(<notebook>):cancel pre-cancel snapshot`. If the snapshot commit fails (e.g., git error), log a warning and continue — the cancel operation should not abort due to a snapshot failure
6. **Update** `.status.json` (atomic write via `.status.json.tmp` + rename). If the atomic write fails, **release `.working/.lock`** and ABORT with error — cancel requires a successful status update:
   - Set `status` to `cancelled`
   - Update `updated` timestamp
   - If `--reason` provided, add `"cancel_reason"` field with the sanitized reason text
7. **Write** `.summary.md` (atomic write via `.summary.md.tmp` + rename) with condensed context: previous status (before cancellation), cancellation reason, progress at time of cancellation (`completed_steps`), any known issues
8. **Git commit**: `task-ai(<notebook>):cancel user cancelled`
9. **Release** `.working/.lock`
10. **If `--cleanup`**:
    - Remove worktree: `git worktree remove .worktrees/task-<notebook>`
    - Delete branch: `git branch -d task/<notebook>` (safe delete — warns if unmerged). If `-d` fails because the branch has unmerged work, report warning to user with the unmerged commit count. User can manually run `git branch -D task/<notebook>` to force-delete
11. **Report** cancellation result

## State Transitions

| Current Status | After Cancel | Condition |
|----------------|--------------|-----------|
| `draft` | `cancelled` | Always |
| `planning` | `cancelled` | Always |
| `review` | `cancelled` | Always |
| `executing` | `cancelled` | Always |
| `re-planning` | `cancelled` | Always |
| `blocked` | `cancelled` | Always |
| `stage-done` | `cancelled` | Always |
| `complete` | REJECT | Terminal state |
| `cancelled` | REJECT | Terminal state |

## Git

```
task-ai(<notebook>):cancel pre-cancel snapshot   # (only if uncommitted changes)
task-ai(<notebook>):cancel user cancelled
```

## .auto-signal

None — `cancel` does not write `.auto-signal`. It is a lifecycle-terminating command that stops the auto loop rather than continuing it.

## Notes

- **Input sanitization**: The `--reason` text must be sanitized before writing to `.status.json` or `.summary.md` — strip HTML comments, ANSI escape sequences, and control characters (except `\n` and `\t`) per the Input Validation rules in `commands/task-ai.md`
- Cancel is rejected on terminal statuses: `complete` (use a separate workflow to reopen) and `cancelled` (already terminal)
- If the task has uncommitted code changes in a worktree, `--cleanup` will warn before deleting
- Without `--cleanup`, the branch and worktree are preserved for reference
- A cancelled task can be referenced by the `report` sub-command for documentation purposes
- **Concurrency**: Cancel acquires `.working/.lock` before modifying files and releases on completion (see Concurrency Protection in `commands/task-ai.md`). Lock cleanup for the auto session (step 3) is separate from cancel's own lock acquisition (step 4)
- **Cleanup after lock release**: `--cleanup` (step 10) runs after lock release (step 9). This is intentional — worktree/branch removal is a git-level operation that does not modify `.working/` files. The brief window between lock release and cleanup is an accepted risk
