---
name: report
description: "Generate a completion report for a finished task module. Triggered after merge completes, or manually for blocked/cancelled tasks to document progress and lessons learned."
model_tier: medium
auto_delegatable: true
triggers:
  keywords:
    zh: [报告, 总结, 复盘, 结项, 汇报]
    en: [report, summary, wrap-up, postmortem, retrospective, completion report]
  phrases:
    zh: [生成报告, 出个总结, 任务复盘, 结项报告, 做个汇报]
    en: [generate a report, write a summary, task retrospective, completion report, what did we accomplish]
  disambiguate: >
    Core intent: generate a structured completion report documenting the full task lifecycle.
    User asks for a formal task report → report.
    User asks to distill EXPERIENCES/LESSONS → highlight. User asks to refresh summaries → summarize.
arguments:
  - name: format
    description: "Report format: full (default) or summary"
    required: false
    default: full
---

# /task-ai:report — Generate Completion Report

Generate a structured completion report for a task module, documenting what was planned, executed, and verified.

## Usage

```
/task-ai:report [--format full|summary]
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.working/.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

## Prerequisites

- Task module should have status `complete` or `stage-done` (post-exec assessment passed)
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
- **Type**: <task type>

## Overview
<!-- From .summary.md if exists — condensed context overview -->
<!-- If .summary.md does not exist, omit this section -->

## Execution Timeline
<!-- From .auto-timeline.md if exists (auto mode execution history) -->
<!-- Include full table and flow line as-is -->
<!-- If .auto-timeline.md does not exist, omit this section -->

## Objective
<!-- From .target.md -->

## Plan
<!-- Summary of implementation approach from .plan.md -->

## Changes Made
<!-- Git commit log from task-ai(<notebook>) commits -->

## Verification
<!-- From .test/ criteria and results files, build status, evaluation outcomes -->

## Analysis
<!-- From .analysis/ evaluation history if exists -->

## Issues Encountered
<!-- From .bugfix/ if exists, or "None" -->

## Dependencies
<!-- Status of depends_on modules from .status.json -->

## Lessons Learned
<!-- From .notes/ if exists — notable patterns, workarounds, or discoveries -->
```

### Summary Format

Compact single-section report with: status, type, created/completed timestamps, objective (1 line), key changes (git log in code block), verification result.

## Output

The report is written to `$NB_PROJECT_DELIVERABLES/<notebook>/.report.md` (the project's deliverables directory, not `.working/`) and also printed to screen. The deliverables directory is resolved as `<project-dir>/.deliverables/<notebook>/`.

## Execution Steps

1. **Read** `.status.json` for task metadata (status, title, created, completed, type, depends_on)
2. **Read** `.target.md` for objectives
3. **Read** `.plan.md` for implementation approach
4. **Read** `.summary.md` if exists (condensed context overview)
5. **Read** `.auto-timeline.md` if exists (auto mode execution timeline — phase table, timing, flow). Include its content verbatim as the "Execution Timeline" section in the report. If the file does not exist (manual execution), omit the section
6. **Read** `.test/` for verification criteria and test results (all files, sorted by name, if exists)
7. **Read** `.analysis/` for evaluation history (all files, sorted by name, if exists)
8. **Read** `.bugfix/` for issue history (all files, sorted by name, if exists)
9. **Read** `.notes/` for research findings and experience log (all files, sorted by name, if exists)
10. **Collect** git changes related to the task (if identifiable via `git log --oneline --all --max-count=200 --fixed-strings --grep="task-ai(<notebook>)"`)
11. **Compose** report in requested format
12. **Write** to `$NB_PROJECT_DELIVERABLES/<notebook>/.report.md`
13. **Git commit**: `task-ai(<notebook>):report generate completion report`
14. **Write** `.auto-signal`: `{ "step": "report", "result": "(generated)", "next": "(stop)", "checkpoint": "", "timestamp": "..." }`
15. **Print** report to screen. Then output: "Task lifecycle complete. Report saved to `.deliverables/<notebook>/.report.md`."

> *Note: Library experience distillation (formerly steps in report) has moved to `highlight(scope=complete)` — see `highlight/SKILL.md` §3.5. In auto loop, highlight runs as an independent step between merge and report. For manual workflows: run `/task-ai:highlight` before `/task-ai:report` if distillation is needed.*

**Note**: Report is a terminal step — it reads ALL history files (not just latest) to produce a comprehensive record. `.summary.md` is used as an overview, not a replacement for full history in report context.

## State Transitions

| Current Status | After Report | Condition |
|----------------|--------------|-----------|
| `draft` | `draft` | Minimal output (see Prerequisites) |
| `planning` | `planning` | Progress snapshot |
| `review` | `review` | Progress snapshot |
| `executing` | `executing` | Progress snapshot |
| `re-planning` | `re-planning` | Progress snapshot |
| `complete` | `complete` | Full completion report |
| `blocked` | `blocked` | Document blocked state |
| `cancelled` | `cancelled` | Document cancellation |
| `stage-done` | `stage-done` | Interim report for completed stage |

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
- For `complete` tasks, report includes change history via `git log --oneline --all --max-count=200 --fixed-strings --grep="task-ai(<notebook>)"` (uses `--fixed-strings` to avoid regex interpretation of parentheses; `--max-count=200` caps output for performance; works even after task branch deletion)
- **Concurrency**: Report acquires `.working/.lock` before proceeding and releases on completion. Stale locks (holding PID is dead) are automatically recovered. (See Concurrency Protection in `commands/task-ai.md`)
