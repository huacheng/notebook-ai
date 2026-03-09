---
name: highlight
description: "Distill and persist reusable experience, lessons learned, and thinking patterns into the knowledge library. Supports comprehensive task distillation, ad-hoc experience capture from conversation, and experience-to-skill promotion. Use when the user says 'what did we learn', 'capture this insight', 'distill experience', or wants to save lessons for future tasks."
model_tier: medium
auto_delegatable: true
triggers:
  keywords:
    zh: [经验, 提炼, 总结经验, 学到了, 记住, 教训, 心得]
    en: [experience, distill, lessons learned, takeaway, remember this, insight]
  phrases:
    zh: [总结一下经验, 提炼经验, 记住这个经验, 学到了什么, 沉淀一下, 这次有什么教训]
    en: [distill the experience, what did we learn, capture this insight, save this lesson, extract takeaways]
  disambiguate: >
    Core intent: distill and persist reusable experience/thinking into the library.
    User wants to capture lessons or insights → highlight.
    User wants a formal task REPORT → report. User wants to refresh .summary.md → summarize.
arguments:
  - name: description
    description: "Natural language description for ad-hoc experience capture (e.g., '总结下上面成功的操作经验')"
    required: false
---

# /task-ai:highlight — Experience Distillation Engine

Unified protocol for experience and thinking library writes. Defines 7 scopes covering all experience/thinking write operations across the task lifecycle. Also serves as an independent skill for comprehensive distillation (complete), ad-hoc experience capture (adhoc), and experience-to-skill promotion (promote).

## Usage

```
/task-ai:highlight                    # scope=complete — comprehensive distillation (notebook auto-detected)
/task-ai:highlight "<description>"    # scope=adhoc — conversation experience capture
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.working/.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

**Parameter routing:**
- No arguments → scope=complete (auto-detect notebook from CWD or task branch; error if not in notebook context)
- `highlight "<description>"` → scope=adhoc (conversation experience capture)

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 0: Library Write Protocol                              │
│  (commands/references/library-write-protocol.md)              │
│  lock · changelog · atomic write · index update               │
├──────────────────────────┬───────────────────────────────────┤
│  Layer 1a: highlight     │  Layer 1b: other skills            │
│  experience + thinking   │  external knowledge + security     │
│                          │                                    │
│  Manages:                │  Manages:                          │
│  · .memory/.experiences/ │  · .memory/.references/ (research) │
│  · .memory/.thinking/    │  · .type-registry.md (research)    │
│  · .memory/.type-profiles│  · quarantine (security)           │
│    (complete sync only)  │                                    │
│  · quality_status        │                                    │
│  · .skills/.candidates/  │                                    │
│    .drafts/ .active/     │                                    │
│    (promote scope)       │                                    │
└──────────────────────────┴───────────────────────────────────┘
```

**Dependency direction (single direction, downward):**
- target/research/plan/exec/check/verify/merge/security/annotate → highlight protocol (reference)
- highlight → Library Write Protocol (call)
- No circular dependencies

## Scope Definitions

highlight defines 7 scopes. Scopes §3.1–§3.4 are **inline protocols** (executed by calling skills). Scopes §3.5–§3.7 are **independent executions** (run as standalone skill invocations).

---

### §3.1 scope=impl — Implementation Experience

**Caller**: exec (inline, after all plan steps complete)
**Independent execution**: No

#### Trigger

exec completes all plan steps.

#### Content Extraction

From exec's current context:
- Key implementation decisions and rationale
- Tool/framework patterns used
- Workarounds and pitfalls discovered
- Deviations from plan and reasons

#### Write Spec

Target: `.memory/.experiences/<type>/<notebook>-impl.md` | Mode: O_APPEND | Lock: `.memory/.experiences/.lock` | quality_status: `provisional`

> See [references/scope-impl-spec.md](references/scope-impl-spec.md) for full write spec table, frontmatter template, content structure, and write steps.

#### Fault Isolation

> Inline call failure should not block the caller's main flow — highlight is an enhancement step, not a gating requirement.

---

### §3.2 scope=verify — Verification Experience

**Caller**: verify (inline, step 12)
**Independent execution**: No

#### Trigger

verify checkpoint completes AND checkpoint != quick.

#### Content Extraction

From verify's current context (type-adaptive, not limited to software):
- Test results summary (pass/fail/partial)
- Domain verification patterns (what verification methods work for this type)
- Threshold discoveries (reasonable metric ranges)
- Type-specific verification patterns:
  - software: VFP cycles (test framework effectiveness, VH stub techniques, common VH→HS failure reasons, refactoring patterns)
  - data-pipeline: schema validation strategies, data quality thresholds, sampling methods
  - image/video: SSIM/PSNR thresholds, visual comparison methods
  - audio/dsp: SNR thresholds, spectral analysis methods
  - document: structural integrity checks, content validation methods
  - other types: extract from `.type-profile.md` "Verification Standards"

#### Write Spec

Target: `.memory/.experiences/<type>/<notebook>-verify.md` | Mode: O_APPEND | Lock: `.memory/.experiences/.lock` | quality_status: `provisional`

> See [references/scope-verify-spec.md](references/scope-verify-spec.md) for full write spec table, frontmatter template, content structure, and write steps.

#### Fault Isolation

> **Fault isolation**: Same principle as §3.1 — inline call failure does not block the caller's main flow.

---

### §3.3 scope=thinking-raw — Raw Thinking Capture

**Callers (9 commands, two tiers)**:

| Tier | Command | Call Point | Notes |
|------|---------|------------|-------|
| **High-value** | target | During objective analysis | Goal decomposition and constraint reasoning |
| **High-value** | research | After research completes | Technology selection and feasibility reasoning |
| **High-value** | plan | step 24 | Design and trade-off reasoning |
| **High-value** | exec | After step execution | Implementation decisions and problem-solving reasoning |
| **High-value** | check | step 16 | Quality judgment and ACCEPT/REPLAN decision reasoning |
| **High-value** | verify | After verification completes | Verification strategy selection and result analysis reasoning |
| **Low-value** | merge | After deliverables copy | Deliverables selection reasoning (only when non-trivial) |
| **Medium-value** | security | During security audit | Threat model and risk assessment reasoning |
| **Medium-value** | annotate | During annotation processing | Cross-impact assessment reasoning |

**Independent execution**: No

#### Trigger

Caller's execution involves complex reasoning or novel domain judgment (optional, encouraged). High-value commands should actively capture; medium-value commands capture only when reasoning complexity is clearly above routine.

#### Write Spec

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.thinking/raw/<notebook>-<caller>-<YYYY-MM-DD>.md` |
| Write mode | O_APPEND (no lock — filename is unique, no conflict) |
| Index | O_APPEND `.memory/.thinking/raw/.index.md` |

#### Frontmatter

```yaml
---
source: highlight-<caller>
notebook: <notebook-name>
created_at: <ISO-8601>
quality:
  thinking: <H|M|L>
  justification: "<1-sentence reason>"
---
```

#### Content Structure

Follow `$NB_WORKSPACES_LIBRARY/references/quality-rubric.md` H/M/L self-assessment standards.

```markdown
## CoT Capture — <caller> phase (<date>)

### Problem
<what was being reasoned about>

### Reasoning Chain
<key reasoning steps>

### Conclusion
<what was decided>

### Quality Self-Assessment
<H/M/L with justification>
```

#### Write Steps

1. O_APPEND write to `<notebook>-<caller>-<YYYY-MM-DD>.md`
2. O_APPEND append one row to `.memory/.thinking/raw/.index.md`
3. No lock needed (filename contains notebook + caller + date, naturally unique per day). Note: multiple calls within the same day append to the same file — O_APPEND ensures atomicity of individual writes

#### Fault Isolation

> **Fault isolation**: Same principle as §3.1 — inline call failure does not block the caller's main flow.

---

### §3.4 scope=quality-update — Quality Status Change

**Caller**: check (inline, step 12)
**Independent execution**: No

#### Trigger

| check verdict | Action |
|--------------|--------|
| ACCEPT (post-exec) | Same notebook's `provisional` experience files → `quality_status: verified` |
| REPLAN | Misleading experience files → `quality_status: invalidated` |

#### Write Spec

| Field | Value |
|-------|-------|
| Target files | `.memory/.experiences/` existing `-impl.md` or `-verify.md` |
| Write mode | Frontmatter field overwrite (atomic: read → modify → .tmp → rename) |
| Lock | `.memory/.experiences/.lock` |

#### Write Steps (status upgrade to verified)

1. acquire `.memory/.experiences/.lock`
2. read target file frontmatter
3. modify `quality_status: provisional → verified`
4. atomic write (.tmp → rename)
5. acquire `.changelog.lock` → append: `<ts> | experience | <path> | quality_status:verified | promoted-by:check` → release
6. release `.memory/.experiences/.lock`

#### Write Steps (invalidation)

Same as status upgrade steps above, but `quality_status: provisional → invalidated`, changelog marks `invalidated-by:check`.

#### Related Operation — failure_count Update

check REPLAN may also need to update `.memory/.references/` `failure_count`. This operation **does NOT belong to highlight protocol** — `.references/` is managed by research/read. check operates directly via Library Write Protocol:

1. acquire `.memory/.references/.lock`
2. read frontmatter → `failure_count++`
3. atomic write
4. append changelog: `<ts> | reference | <path> | failure_count:<n>`
5. release `.memory/.references/.lock`

---

### §3.5 scope=complete — Comprehensive Distillation

**Caller**: None (not inline)
**Independent execution**: **Yes** — auto loop step after merge; manual invocation

This is highlight's core scope for comprehensive experience distillation.

#### Trigger & Dual Modes

| Mode | Trigger | Primary Input | Auxiliary Input |
|------|---------|--------------|-----------------|
| **auto-complete** | Auto loop after merge | System files (see table below) | None (no conversation context) |
| **manual-complete** | User runs `/task-ai:highlight` | **Current conversation context** | System files (structural supplement) |

- auto-complete: agent starts independently, no conversation history, reads only from filesystem
- manual-complete: user triggers in conversation, conversation context contains rich decision processes — use as primary distillation source
- Manual trigger is not limited by notebook status — any status can be distilled (executing, blocked, cancelled)

#### Idempotency Check (auto-complete mode)

auto-complete checks whether distillation is necessary before executing:

```
input_files = [.target.md, .plan.md, .summary.md, *-impl.md, *-verify.md, ...]
latest_input_mtime = max(mtime(f) for f in input_files if exists(f))

# Stage-aware output filename
Read .status.json stage field (default { current: 1, history: [] }):
  IF status == "evolving" AND stage.current > 1:
    filename = "<notebook>-stage-<stage.current>-complete.md"
  ELSE:
    filename = "<notebook>-complete.md"

existing_complete = .memory/.experiences/<type>/{filename}

if existing_complete exists AND mtime(existing_complete) >= latest_input_mtime:
    log "No new content since last distillation, skipping"
    return
```

manual-complete mode **skips idempotency check** — user explicit trigger always executes, since conversation context is new input.

#### Input Files (auto-complete's full source / manual-complete's auxiliary source)

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

#### Output A — Experience Distillation

**Stage-aware file naming** — read `.status.json` `stage` field (default `{ current: 1, history: [] }` if missing):

| Scenario | Target filename |
|----------|----------------|
| Intermediate stage (`status == "evolving"` AND `stage.current > 1`) | `<notebook>-stage-<stage.current>-complete.md` |
| Final stage (`status == "satisfied"`, including `total: 1`) | `<notebook>-complete.md` |

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type-segment>/{filename}` |
| Write mode | **Overwrite** (.tmp → rename) — final version replaces all provisional versions |
| Lock | `.memory/.experiences/.lock` |
| quality_status | `verified` |
| completeness | `complete` |
| source | `highlight-complete` |

For multi-type (e.g., `data-pipeline|ml`), split on `|` and write one file per segment. Each segment name uses directory-safe transform (`:` → `-`, e.g., `audio:dsp` → `audio-dsp`).

**Final stage distillation** (last stage merge → `satisfied`): uses `<notebook>-complete.md` (no stage prefix). Additionally reads ALL prior `-stage-*-complete.md` files as input to synthesize cumulative cross-stage experience into the final distillation.

**Context budget guard**: When reading input files for distillation, apply an upper bound of ~50k tokens on total input. If combined input exceeds the context budget, prioritize in this order: `.status.json` > `.target.md` > `.summary.md` > `.plan.md` > `.type-profile.md` > prior `-stage-*-complete.md` > existing provisional experience > `.analysis/` > `.test/` > `.bugfix/` > `.notes/` > `.thinking/raw/`. Truncate lowest-priority sources first. Log a warning if truncation occurs.

Frontmatter:

```yaml
---
quality_status: verified
completeness: complete
source: highlight-complete
type: <full type string>
notebook: <notebook-name>
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2, ...]
---
```

Content structure:

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

#### Output B — Thinking Patterns Distillation

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

#### Output C — Type-profiles Sync

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

#### Complete Execution Steps

1. **Read** `.status.json` — get type, status, notebook metadata
2. **Read** all input files (see table above), respecting the context budget guard: read in priority order, stop or truncate when approaching the ~50k token budget
3. **Absorb** existing provisional experience (`-impl.md`, `-verify.md`), integrate into final distillation
4. **Output A** — Experience distillation, per type segment:
   - 4a. `mkdir -p .memory/.experiences/<segment>/`
   - 4b. acquire `.memory/.experiences/.lock`
   - 4c. write `<notebook>-complete.md` (overwrite)
   - 4d. changelog append (per segment)
   - 4e. update `<segment>/.index.md` (overwrite matching row or append)
   - 4f. overwrite `<segment>/.summary.md` (distilled patterns + entry index table)
   - 4g. overwrite top-level `.memory/.experiences/.summary.md`
   - 4h. release `.memory/.experiences/.lock`
5. **Output D** — Adoption tracking:
   - 5a. Read `.plan.md` `## Adopted Experiences` section (if exists)
   - 5b. For each `← .experiences/<type>/<source-file>.md` reference found:
     - acquire `.memory/.experiences/.lock` (reuse if still held from step 4)
     - read the source experience file
     - increment `adoption_count` in frontmatter (default 0 → 1); append `adopted_by: <notebook>` and `adopted_at: <date>` to the frontmatter list
     - write atomically (.tmp → rename)
     - release lock
   - 5c. This creates a feedback loop: experiences that prove useful across tasks accumulate higher `adoption_count`, enabling plan to prioritize high-adoption lessons
6. **Output B** — Thinking Patterns distillation
7. **Output C** — Type-profiles sync
9. **library maintain --compact** (only check if `.changelog` exceeds 2000-line threshold)
10. **Git commit**: `task-ai(<notebook>):highlight complete distillation`
11. **Report** distillation summary. Then output next step prompt: "Experience distilled. Next: `/task-ai:report` to generate the completion report."

---

### §3.6 scope=adhoc — Conversation Experience Capture

**Caller**: None
**Independent execution**: **Yes** — purely manual trigger, outside auto lifecycle

#### Usage

```
/task-ai:highlight "<natural language instruction>"
```

Examples:
- `/task-ai:highlight "总结下上面成功的操作经验"`
- `/task-ai:highlight "这次调试 WebSocket 连接的方法很有效，记录下来"`
- `/task-ai:highlight "记录这次 CSS 布局问题的解决思路"`

#### Execution Protocol

9-step procedure: understand instruction → determine type → extract experience from conversation → structure content → generate frontmatter → generate filename slug → write with locks → git commit → user feedback.

> See [references/scope-adhoc-steps.md](references/scope-adhoc-steps.md) for the full step-by-step execution protocol (Steps 1-9 with all sub-steps).

---

## State Transitions

highlight **does not change notebook status**. Regardless of scope, `.status.json` status is unaffected.

| scope | Status impact |
|-------|-------------|
| impl | None (exec manages status) |
| verify | None (verify manages status) |
| thinking-raw | None (callers manage their own status) |
| quality-update | None (check manages status) |
| satisfied | None (merge already set satisfied) |
| adhoc | None (no notebook lifecycle) |
| promote | None (batch operation, no notebook lifecycle) |

## Git

| Action | Commit Message |
|--------|---------------|
| complete distillation | `task-ai(<notebook>):highlight complete distillation` |
| adhoc capture | `task-ai(<scope>):highlight adhoc experience captured` |
| promote | No independent commit (changelog update only; candidates are committed by subsequent skill-review) |

> Inline calls (impl/verify/thinking-raw/quality-update) do not produce independent commits. Their changelog updates are included in the caller's git commit (e.g., exec's commit includes impl experience write changelog changes).

---

### §3.7 scope=promote — Experience to Skill Promotion

**Caller**: None (batch operation)
**Independent execution**: **Yes** — manual or scheduled invocation

#### Trigger Conditions

All three must be met:
1. `quality_status: verified` in experience frontmatter
2. `usage_count >= 3` (counted from `.changelog` entries with `| referenced |` type only — excludes initial write entries)
3. Contains structural patterns: `## Patterns` or `## Steps` headers

#### Usage

```bash
# Scan all experiences and promote eligible ones
bash skills/highlight/scripts/promote.sh

# Dry-run to see what would be promoted
bash skills/highlight/scripts/promote.sh --dry-run

# Promote specific experience file
bash skills/highlight/scripts/promote.sh --target <experience-file.md>
```

#### Output

| File | Location | Content |
|------|----------|---------|
| SKILL.md | `.skills/.candidates/<slug>/SKILL.md` | Generated skill definition |
| trust-report.md | `.skills/.candidates/<slug>/trust-report.md` | Promotion criteria and trust assessment |

#### Pipeline

```
1. Static scan of .memory/.experiences/
2. Filter: quality_status=verified
3. Filter: usage_count >= 3 (from changelog)
4. Filter: has structural patterns
5. D2 Security static analysis + D1/D3/D5 Semantic review (pre-promotion score >= 0.5)
6. Generate SKILL.md (trust_tier: T1)
7. Generate trust-report.md (includes pre-promotion scores)
8. Write to .skills/.candidates/<slug>/
9. Acquire .changelog.lock → append: `<ts> | skill-candidate | .skills/.candidates/<slug> | source:promote | from:<experience-file>` → release
```

> **Note**: The `skill-candidate` changelog type is specific to promote operations and extends the standard types (`experience`, `reference`, `type-profile`, `pattern`, `referenced`) defined in `commands/references/library-write-protocol.md`.

#### Next Steps After Promotion

1. `check --checkpoint skill-review --target SKILL.md` → L2 six-dimension audit, score ≥ 0.70 → move to `.skills/.drafts/` (T2)
2. `check --checkpoint skill-deep-review --target SKILL.md` → L3 deep semantic review, score ≥ 0.85 → move to `.skills/.active/<name>/` (T3)
3. Production validation (usage_count ≥ 3 post-activation, zero failures) → T4 (fully verified)

## Notes

- **Protocol, not runtime**: Inline scopes (§3.1–§3.4) define write format and steps. Calling skills execute these steps in their own context — highlight is not invoked as a separate skill for inline scopes
- **Fault isolation is universal**: All inline caller commands (the 9 commands listed in §3.3, plus check's additional §3.4 quality-update role) have the same guarantee — highlight protocol failure never blocks the caller's main flow
- **No state mutations**: highlight is transparent to the state machine. This is consistent with the former `light` behavior
- **.type-profiles/ dual ownership**: research creates/updates profiles (knowledge acquisition); highlight syncs during complete (experience write-back). Both use Library Write Protocol locks for concurrency safety
- **Concurrency**: Independent executions (complete, adhoc) acquire `.working/.lock` before proceeding and release on completion (see Concurrency Protection in `commands/task-ai.md`). promote does NOT acquire `.working/.lock` — it operates on library-level paths (`.skills/.candidates/`, `.changelog`) with its own `.changelog.lock`
