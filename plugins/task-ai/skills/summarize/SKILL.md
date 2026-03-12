---
name: summarize
description: "Regenerate .summary.md files when context is lost, stale, or after manual edits outside the skill flow. Use when the user says 'context is lost', 'refresh summaries', or returns to a task after a long break and needs to rebuild the working context."
model_tier: light
auto_delegatable: true
triggers:
  keywords:
    zh: [摘要, 刷新摘要, 恢复上下文, 重建摘要, 上下文丢了]
    en: [summarize, refresh summary, recover context, rebuild summary, context lost]
  phrases:
    zh: [重新生成摘要, 刷新一下摘要, 上下文丢了恢复一下, 重建summary]
    en: [regenerate summaries, refresh the summary, recover lost context, rebuild summary files]
  disambiguate: >
    Core intent: regenerate .summary.md files when context is lost or stale.
    User says "context is lost" or "refresh summaries" → summarize.
    User wants a formal task REPORT → report. User wants to capture EXPERIENCE → highlight.
arguments:
  - name: all
    description: "Also regenerate each sub-directory's .summary.md"
    required: false
---

# /task-ai:summarize — Context Summary Regeneration

Regenerate `.summary.md` files for a task module. Used to recover lost context or refresh stale summaries after manual edits.

## Usage

```
/task-ai:summarize [--all]
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

## When to Use

- **Context recovery**: After context window compaction or session restart, when `.summary.md` is outdated or missing
- **Manual edit refresh**: After manually editing task files (`.plan.md`, `.target.md`, etc.) outside the normal skill flow
- **Stale summary**: When `.summary.md` no longer reflects the current state of the task module
- **Standalone rebuild**: To regenerate summaries without running a full plan/check/exec cycle

## Execution Steps

1. **Acquire** `.lock` (see Concurrency Protection in `commands/task-ai.md`). If lock is held by another live session, REJECT
2. **Read** `.status.json` — get `status`, `type`, `phase`, `completed_steps`, `depends_on`, metadata. If missing or corrupt, **release `.lock`** and REJECT with error — valid status is required to generate an accurate summary
3. **Read** `.target.md` if exists — requirements and objectives
4. **Read** `.plan.md` if exists — current implementation plan
5. **Read** `.analysis/` all files if directory exists (sorted by filename) — evaluation history
6. **Read** `.bugfix/` all files if directory exists (sorted by filename) — issue history
7. **Read** `.test/` all files if directory exists (sorted by filename) — criteria and results
8. **Read** `.notes/` all files if directory exists (sorted by filename) — research and decisions
9. **If `--all`**: regenerate each directory's `.summary.md` (skip directories that don't exist or that contain no `.md` files). Use atomic write (`.summary.md.tmp` + rename) for each sub-directory summary:
   - `.analysis/.summary.md` — condensed summary of all evaluation entries
   - `.bugfix/.summary.md` — condensed summary of all issues and fixes
   - `.test/.summary.md` — condensed summary of all criteria and results
   - `.notes/.summary.md` — condensed summary of all research and decisions
10. **Generate + write** task-level `.summary.md` (write to `.summary.md.tmp` then rename for crash safety) with condensed context:
    - Status, phase, progress (`completed_steps` from `.status.json` / total steps from `.plan.md`)
    - Plan overview (3-5 sentence summary)
    - Current state (what was last done, what's next)
    - Key decisions (architectural/design decisions)
    - Known issues (active issues, blockers, risks)
    - Lessons learned (patterns, workarounds, discoveries)
11. **Git commit** (skip if no files changed): `task-ai(<notebook>):summarize regenerate context summary`. If the commit fails (e.g., git error), log a warning and continue — summary files are already written
12. **Release** `.lock`
13. **Report** result. Then output: "Summary regenerated. You may resume your current lifecycle step."

## State Transitions

| Current Status | After Summarize | Condition |
|----------------|-----------------|-----------|
| Any | (unchanged) | Pure utility sub-command |

## Git

```
task-ai(<notebook>):summarize regenerate context summary
```

## Notes

- **Utility, not lifecycle**: `summarize` is a maintenance tool for context recovery. It does not participate in the auto loop
- **Non-destructive**: Only writes `.summary.md` files — never modifies source files (`.target.md`, `.plan.md`, etc.) or `.status.json`
- **Graceful degradation**: If any source file (steps 3–8) exists but cannot be read (I/O error, encoding issue), skip it with a warning note in the generated summary — do not abort. Generate the best summary possible from available data
- **Format compliance**: Generated `.summary.md` follows the format specified in `commands/task-ai.md` (Status/Phase/Progress header, Plan Overview, Current State, Key Decisions, Known Issues, Lessons Learned sections). Keep under ~200 lines
- **Concurrency**: Summarize acquires `.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/task-ai.md`)
- **`--all` scope**: Without `--all`, only the task-level `.summary.md` is regenerated. With `--all`, all sub-directory summaries are also regenerated, which requires reading every file in every sub-directory
