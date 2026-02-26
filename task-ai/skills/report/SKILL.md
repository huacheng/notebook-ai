---
name: report
description: "Generate a completion report for a finished task module. Triggered after merge completes, or manually for blocked/cancelled tasks to document progress and lessons learned."
model_tier: medium
auto_delegatable: true
arguments:
  - name: notebook
    description: "Notebook name (e.g., auth-refactor)"
    required: false
  - name: format
    description: "Report format: full (default) or summary"
    required: false
    default: full
---

# /task-ai:report — Generate Completion Report

Generate a structured completion report for a task module, documenting what was planned, executed, and verified.

## Usage

```
/task-ai:report <notebook_name> [--format full|summary]
```

## Prerequisites

- Task module should have status `complete` (post-exec assessment passed)
- Can also be run on `blocked` or `cancelled` tasks for documentation purposes
- **Minimum content**: If status is `draft` and `.plan.md` does not exist, report outputs a brief notice ("No meaningful content to report — task is still in draft with no plan") instead of generating an empty report structure

## Report Structure

### Full Format

```markdown
# Task Report: <title>

## Summary
- **Status**: complete | blocked | cancelled
- **Created**: <timestamp>
- **Completed**: <timestamp>
- **Duration**: <calculated>

## Execution Timeline
<!-- From .auto-timeline.md if exists (auto mode execution history) -->
<!-- Include full table and flow line as-is -->
<!-- If .auto-timeline.md does not exist, omit this section -->

## Objective
<!-- From .target.md -->

## Plan
<!-- Summary of implementation approach from .plan.md -->

## Changes Made
<!-- List of files modified/created/deleted with brief descriptions -->

## Verification
<!-- From .test/ criteria and results files, build status, evaluation outcomes -->

## Issues Encountered
<!-- From .bugfix/ if exists, or "None" -->

## Dependencies
<!-- Status of depends_on modules -->

## Lessons Learned
<!-- Any notable patterns, workarounds, or discoveries -->
```

### Summary Format

Compact single-section report with: status, objective (1 line), key changes (bullet list), verification result.

## Output

The report is written to `[deliverables-dir]/.report.md` (the notebook's deliverables directory, not `.working/`) and also printed to screen.

## Execution Steps

1. **Read** `.index.json` for task metadata (including `completed_steps`)
2. **Read** `.target.md` for objectives
3. **Read** `.plan.md` for implementation approach
4. **Read** `.summary.md` if exists (condensed context overview)
5. **Read** `.auto-timeline.md` if exists (auto mode execution timeline — phase table, timing, flow). Include its content verbatim as the "Execution Timeline" section in the report. If the file does not exist (manual execution), omit the section
6. **Read** `.test/` for verification criteria and test results (all files, sorted by name, if exists)
7. **Read** `.analysis/` for evaluation history (all files, sorted by name, if exists)
8. **Read** `.bugfix/` for issue history (all files, sorted by name, if exists)
9. **Read** `.notes/` for research findings and experience log (all files, sorted by name, if exists)
10. **Collect** git changes related to the task (if identifiable)
11. **Compose** report in requested format
12. **Write** to `.report.md`
13. **Distill experience**: If task status is `complete` and `type` is non-empty, follow the **Library Write Protocol** (`library/SKILL.md`). Validate each pipe-separated segment matches `[a-zA-Z0-9_:-]+`. **Directory-safe transform**: replace `:` with `-` in segment when used as directory name. Extract key learnings for **each** segment (type `data-pipeline|ml` → write to both directories). Steps:
    - (a) `mkdir -p $NB_WORKSPACES_LIBRARY/.memory/.experiences/<segment>/`
    - (b) Acquire `$NB_WORKSPACES_LIBRARY/.memory/.experiences/.lock`
    - (c) Write `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<segment>/<notebook>-complete.md` (overwrite; `.tmp → rename`): what worked, what didn't, key decisions, tools/patterns discovered; frontmatter includes `quality_status: verified`, `completeness: complete`
    - (d) Acquire `.changelog.lock` → append one line per segment written: `<timestamp> | experience | .memory/.experiences/<segment>/<notebook>-complete.md | quality_status:verified` → release `.changelog.lock`
    - (e) Update `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<segment>/.index.md` (overwrite matching row or append new row for this notebook)
    - (f) Overwrite `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<segment>/.summary.md` (distilled patterns + entry index table)
    - (g) Overwrite top-level `$NB_WORKSPACES_LIBRARY/.memory/.experiences/.summary.md` (all type directories index)
    - (h) Release `$NB_WORKSPACES_LIBRARY/.memory/.experiences/.lock`
14. **Distill thinking patterns**: Read `.memory/.thinking/raw/<notebook>-*.md` files (glob); filter to entries with `quality.thinking: H`. For each identified reasoning pattern: acquire `$NB_WORKSPACES_LIBRARY/.memory/.thinking/patterns/.lock` → write/update `.memory/.thinking/patterns/<problem-type>.md` (overwrite; `.tmp → rename`) → append changelog line (`<timestamp> | pattern | .memory/.thinking/patterns/<problem-type>.md | source:<notebook>`) → update `.memory/.thinking/patterns/.index.md` (state: `draft` if new, `active` if already used) → release lock. **Batch update** `failure_count`: scan this task's git history for REPLAN commits (`git log --grep="REPLAN"`); for each REPLAN, if `.plan.md` at that commit referenced a pattern, increment that pattern's `failure_count` in its frontmatter (overwrite with `.tmp → rename`).
15. **Sync shared type profile**: If `.type-profile.md` exists, merge refined profile back to `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/<primary-type>.md` for ALL types. Apply directory-safe transform. Acquire `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/.lock` before writing. If shared profile already exists, update sections with higher-confidence info (check refinement log dates); append task's refinement log entries. Append changelog line: `<timestamp> | type-profile | .memory/.type-profiles/<type>.md | source:<notebook>`. Update `.memory/.type-profiles/.index.md`. Release lock after write.
16. **Git commit**: `task-ai(<notebook>):report generate completion report`
17. **Write** `.auto-signal`: `{ "step": "report", "result": "(generated)", "next": "(stop)", "checkpoint": "", "timestamp": "..." }`
18. **Lightweight maintain**: Call `library maintain --compact` (compact-threshold check only — no I/O unless `.changelog` exceeds 2000-line threshold). This runs **after** `.auto-signal` is written so the automation loop advances first.
19. **Print** report to screen

**Note**: Report is a terminal step — it reads ALL history files (not just latest) to produce a comprehensive record. `.summary.md` is used as an overview, not a replacement for full history in report context.

## State Transitions

| Current Status | After Report | Condition |
|----------------|--------------|-----------|
| `complete` | `complete` | Always |
| `blocked` | `blocked` | Always |
| `cancelled` | `cancelled` | Always |

## Git

- `task-ai(<notebook>):report generate completion report`

## .auto-signal

`{ "step": "report", "result": "(generated)", "next": "(stop)", "checkpoint": "", "timestamp": "..." }`

Report is always a terminal step — `next` is always `(stop)`.

## Notes

- Reports are overwritten on regeneration (only latest report kept)
- For `blocked` tasks, the report documents what was completed and what blocks remain
- For `cancelled` tasks, the report documents the reason for cancellation
- The report serves as a permanent record even after task files are archived
- For `complete` tasks, report includes change history via `git log --oneline --all --fixed-strings --grep="task-ai(<notebook>)"` (uses `--fixed-strings` to avoid regex interpretation of parentheses; works even after task branch deletion)
- **Concurrency**: Report acquires `.working/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/task-ai.md`)
