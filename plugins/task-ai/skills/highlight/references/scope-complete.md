# scope=complete — Comprehensive Distillation

Referenced from `highlight/SKILL.md` §3.5.

**Caller**: None (not inline)
**Independent execution**: **Yes** — auto loop step after post-exec ACCEPT; manual invocation

This is highlight's core scope for comprehensive experience distillation.

## Trigger & Dual Modes

| Mode | Trigger | Primary Input | Auxiliary Input |
|------|---------|--------------|-----------------|
| **auto-complete** | Auto loop after post-exec ACCEPT | System files (see table below) | None (no conversation context) |
| **manual-complete** | User runs `/task-ai:highlight` | **Current conversation context** | System files (structural supplement) |

- auto-complete: agent starts independently, no conversation history, reads only from filesystem
- manual-complete: user triggers in conversation, conversation context contains rich decision processes — use as primary distillation source
- Manual trigger is not limited by notebook status — any status can be distilled (executing, blocked, cancelled)

## Idempotency Check (auto-complete mode)

auto-complete checks whether distillation is necessary before executing:

```
input_files = [.target.md, .plan.md, .summary.md, *-impl.md, *-verify.md, ...]
latest_input_mtime = max(mtime(f) for f in input_files if exists(f))

# Semantic output filename
filename = "<semantic>-complete.md"

existing_complete = .memory/.experiences/<type>/{filename}

if existing_complete exists AND mtime(existing_complete) >= latest_input_mtime:
    log "No new content since last distillation, skipping"
    return
```

manual-complete mode **skips idempotency check** — user explicit trigger always executes, since conversation context is new input.

## Input Files (auto-complete's full source / manual-complete's auxiliary source)

| Input File | Purpose |
|-----------|---------|
| `.status.json` | Task metadata (type, status, completed_steps) |
| `.target.md` | Objective definition |
| `.plan.md` | Implementation approach |
| `.summary.md` | Task context summary |
| `.analysis/` | Evaluation history (all files) |
| `.test/` | Verification criteria and results (all files) |
| `.bugfix/` | Issue history (all files) |
| `.notes/` | Research notes (all files) |
| `.memory/.thinking/raw/<nb>-*.md` | Raw CoT records |
| `.type-profile.md` | Task-level type profile |
| Existing provisional experience files | `-impl.md`, `-verify.md` (absorb and integrate if present) |

## Output A — Experience Distillation

**Semantic file naming** — all stages use the same filename; stage info is recorded in frontmatter `sources[].stage`:

| Scenario | Target filename |
|----------|----------------|
| All stages (intermediate or final) | `<semantic>-complete.md` |

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type-segment>/{filename}` |
| Write mode | **Overwrite** (.tmp → rename) — final version replaces all provisional versions |
| Lock | `.memory/.experiences/.lock` |
| quality_status | `verified` |
| completeness | `complete` |
| source | `highlight-complete` |

For multi-type (e.g., `data-pipeline|ml`), split on `|` and write one file per segment. Each segment name uses directory-safe transform (`:` → `-`, e.g., `audio:dsp` → `audio-dsp`).

**Final stage distillation** (convergence ≥ 0.95 → user says `satisfied`): uses `<semantic>-complete.md`. Since all stages append to the same file (with stage info in frontmatter `sources[]`), the final distillation overwrites with a synthesized version incorporating all stage experiences.

**Context budget guard**: When reading input files for distillation, apply an upper bound of ~50k tokens on total input. If combined input exceeds the context budget, prioritize in this order: `.status.json` > `.target.md` > `.summary.md` > `.plan.md` > `.type-profile.md` > existing provisional experience > `.analysis/` > `.test/` > `.bugfix/` > `.notes/` > `.thinking/raw/`. Truncate lowest-priority sources first. Log a warning if truncation occurs.

### Frontmatter

```yaml
---
semantic_name: <kebab-case-knowledge-domain>
quality_status: verified
completeness: complete
source: highlight-complete
type: <full type string>
sources:
  - notebook: <notebook-name>
    project: <project-path>
    stage: <stage-number>
    date: <YYYY-MM-DD>
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2, ...]
---
```

### Content Structure

```markdown
# Experience: <notebook>

## Context
<task background, objective summary>

## What Worked
- <successful approaches, decisions, tools>

## What Didn't Work
- <failed attempts, dead ends, and why>

## Key Decisions
- <decision>: <rationale and outcome>

## Patterns Discovered
- <reusable patterns/techniques>

## Tools & Techniques
- <specific tools, configurations, commands that proved useful>

## Lessons Learned
- <high-level takeaways for future tasks>
```

## Output B — Thinking Patterns Distillation

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.thinking/patterns/<problem-type>.md` |
| Write mode | Overwrite (.tmp → rename) |
| Lock | `.memory/.thinking/patterns/.lock` |

Steps:
1. Read `.memory/.thinking/raw/<notebook>-*.md` all files
2. Filter to entries with `quality.thinking: H`
3. For each identified reasoning pattern:
   - acquire `.thinking/patterns/.lock`
   - write/update `patterns/<problem-type>.md`
   - update `.thinking/patterns/.index.md` (state: `draft` if new / `active` if existing)
   - release lock
4. Scan git REPLAN history: `git log --grep="REPLAN"` in this notebook's commits
5. For each REPLAN, if `.plan.md` referenced a pattern, increment that pattern's `failure_count`
6. changelog append: `<ts> | pattern | .memory/.thinking/patterns/<problem-type>.md | source:<notebook>`

## Output C — Type-profiles Sync

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/<primary-type>.md` |
| Write mode | merge overwrite |
| Lock | `.memory/.type-profiles/.lock` |

Steps:
1. Read task-level `.type-profile.md`
2. acquire `.type-profiles/.lock`
3. If shared profile exists → merge (prefer more recent dates, higher confidence info)
4. If not exists → write directly
5. append changelog
6. update `.type-profiles/.index.md`
7. release lock

## Output D — Adoption Tracking

Steps:
1. Read `.plan.md` `## Adopted Experiences` section (if exists)
2. For each `← .experiences/<type>/<source-file>.md` reference found:
   - acquire `.memory/.experiences/.lock` (reuse if still held from step 4)
   - read the source experience file
   - increment `adoption_count` in frontmatter (default 0 → 1); append `adopted_by: <notebook>` and `adopted_at: <date>` to the frontmatter list
   - write atomically (.tmp → rename)
   - release lock
3. This creates a feedback loop: experiences that prove useful across tasks accumulate higher `adoption_count`, enabling plan to prioritize high-adoption lessons

## Complete Execution Steps

1. **Read** `.status.json` — get type, status, notebook metadata
2. **Read** all input files (see table above), respecting the context budget guard: read in priority order, stop or truncate when approaching the ~50k token budget
3. **Absorb** existing provisional experience (`-impl.md`, `-verify.md`), integrate into final distillation
4. **Output A** — Experience distillation, per type segment:
   - 4a. `mkdir -p .memory/.experiences/<segment>/`
   - 4b. acquire `.memory/.experiences/.lock`
   - 4c. write `<semantic>-complete.md` (overwrite)
   - 4d. changelog append (per segment)
   - 4e. update `<segment>/.index.md` (overwrite matching row or append)
   - 4f. overwrite `<segment>/.summary.md` (distilled patterns + entry index table)
   - 4g. overwrite top-level `.memory/.experiences/.summary.md`
   - 4h. release `.memory/.experiences/.lock`
5. **Output D** — Adoption tracking (steps above)
6. **Output B** — Thinking Patterns distillation
7. **Output C** — Type-profiles sync
8. **library maintain --compact** (only check if `.changelog` exceeds 2000-line threshold)
9. **Git commit**: `task-ai(<notebook>):highlight complete distillation`
10. **Report** distillation summary. Then output next step prompt: "Experience distilled. Next: `/task-ai:report` to generate the completion report."
