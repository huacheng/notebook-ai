# Git Integration — Extended Details

## Branch Convention

| Item | Format | Example |
|------|--------|---------|
| Branch name | `task/<notebook-name>` | `task/notebook-1` |
| Worktree path | `.worktrees/task-<notebook-name>` | `.worktrees/task-notebook-1` |

## Commit Message Convention

All task-ai triggered commits use `--` prefix to distinguish from user manual commits:

```
task-ai(<module>):<type> <description>
```

| type | Scenario | Commit Scope |
|------|----------|-------------|
| `init` | Task initialization | $NB_WORKSPACES_ROOT/ directory files |
| `target` | Objective definition; stage advance | $NB_WORKSPACES_ROOT/ directory files |
| `plan` | Plan generation | $NB_WORKSPACES_ROOT/ directory files |
| `check` | Check evaluation results | $NB_WORKSPACES_ROOT/ directory files |
| `research` | Reference collection | $NB_WORKSPACES_LIBRARY/.memory/.references/ files |
| `verify` | Test execution and verification | $NB_WORKSPACES_ROOT/ directory files |
| `annotate` | Annotation processing | $NB_WORKSPACES_ROOT/ directory files |
| `summarize` | Context summary regeneration | $NB_WORKSPACES_ROOT/ directory files |
| `exec` | Execution state changes | $NB_WORKSPACES_ROOT/ directory files |
| `feat` | New feature code during exec | Project files |
| `fix` | Bugfix code during exec | Project files |
| `refactor` | Code cleanup before merge | Project files |
| `merge` | Merge to main + conflict resolution; stage completion | — (merge commit) / $NB_WORKSPACES_ROOT/ directory files |
| `report` | Report generation | $NB_WORKSPACES_ROOT/ directory files |
| `cancel` | Task cancellation | $NB_WORKSPACES_ROOT/ directory files |
| `highlight` | Experience distillation and ad-hoc capture | $NB_WORKSPACES_LIBRARY/ files |
| `maintain` | Library maintenance (rebuild index, compact) | $NB_WORKSPACES_LIBRARY/ files |

Commit scope: $NB_WORKSPACES_ROOT/ directory files (state/plan) or project files (feat/fix).

## Commit Message Examples

```
task-ai(auth-refactor):init initialize notebook
task-ai(auth-refactor):plan generate implementation plan
task-ai(auth-refactor):research collect references
task-ai(auth-refactor):check post-plan PASS → review
task-ai(auth-refactor):feat add user auth middleware
task-ai(auth-refactor):fix fix token expiration check
task-ai(auth-refactor):exec step 2/5 done
task-ai(auth-refactor):check post-exec ACCEPT
task-ai(auth-refactor):refactor cleanup before merge
task-ai(auth-refactor):merge merge completed task
task-ai(auth-refactor):merge resolve merge conflict
task-ai(auth-refactor):merge task completed
task-ai(auth-refactor):report generate completion report
task-ai(auth-refactor):verify full verification
task-ai(auth-refactor):annotate annotations processed
task-ai(auth-refactor):summarize regenerate context summary
task-ai(auth-refactor):cancel user cancelled
task-ai(auth-refactor):highlight complete distillation
task-ai(auth-refactor):highlight adhoc experience captured
task-ai(auth-refactor):merge stage 1 completed
task-ai(auth-refactor):target stage 2 defined
```

## Refactoring & Merge

After task completion confirmed (`check --checkpoint post-exec` ACCEPT), the `merge` sub-command handles the full merge lifecycle:

1. **Task-level refactoring** (on task branch, before merge)
2. **Merge to main** (with conflict resolution — up to 3 attempts with verification)
3. **Cleanup** (worktree removal, branch deletion)

See `skills/merge/SKILL.md` for detailed merge strategy and conflict resolution flow.

**Recommended:** After all related tasks merge to main, do a project-level refactoring pass on main (cross-task cleanup, shared utilities, API consistency). This is a manual activity, not part of auto mode.

## Worktree Parallel Execution

Without `--worktree`: all work happens on the task branch in the main worktree. Only one task can execute at a time (branch switching required).

With `--worktree` (passed to `init`):
```bash
git worktree add .worktrees/task-<module> -b task/<notebook>
```

- Each task runs in an isolated directory with full project copy
- Multiple tasks can `exec` simultaneously without conflict
- `auto` daemon operates in the task's worktree directory
- On completion, merge back: `git merge task/<notebook>` from main branch

## Rollback

To revert a task to a previous checkpoint:
```bash
git log --oneline task/<notebook>    # find checkpoint commit
git reset --hard <commit>          # in the task's worktree
```

**Warning**: `git reset --hard` is irreversible — all uncommitted changes are lost. Only use in the task's dedicated worktree, never in the main worktree (which may contain other work). Consider `git stash` first if unsure.

## .gitignore

Add to project `.gitignore`:
```
.worktrees/
**/.working/.tmp-annotations.json
**/.working/.auto-signal
**/.working/.auto-signal.tmp
**/.working/.auto-stop
**/.working/.lock
.library/.changelog
.library/.changelog-archive/.lock
.library/.memory/.thinking/raw/
.library/.memory/.thinking/patterns/.lock
.library/.inconsistency.log
.library/.ioc.md
**/.library-state.json
**/.lock
**/.lock.stale.*
```
