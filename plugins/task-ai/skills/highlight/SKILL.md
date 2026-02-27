---
name: highlight
description: "Experience distillation engine — defines the unified protocol for experience/thinking library writes, and provides independent complete distillation and ad-hoc experience capture. Replaces light."
model_tier: medium
auto_delegatable: true
arguments:
  - name: notebook
    description: "Notebook name for task-context distillation (e.g., auth-refactor)"
    required: false
  - name: description
    description: "Natural language description for ad-hoc experience capture (e.g., '总结下上面成功的操作经验')"
    required: false
---

# /task-ai:highlight — Experience Distillation Engine

Unified protocol for experience and thinking library writes. Defines 7 scopes covering all experience/thinking write operations across the task lifecycle. Also serves as an independent skill for comprehensive distillation (complete) and ad-hoc experience capture (adhoc).

## Usage

```
/task-ai:highlight <notebook>         # scope=complete — comprehensive distillation
/task-ai:highlight "<description>"    # scope=adhoc — conversation experience capture
/task-ai:highlight                    # scope=complete on current notebook (if in context)
```

**Parameter routing:**
- `highlight <notebook>` → scope=complete (independent execution, comprehensive distillation of a notebook)
- `highlight "<description>"` → scope=adhoc (conversation experience capture)
- No arguments → if in notebook context (CWD has `.working/.index.json`), equivalent to `highlight <current-notebook>`; otherwise error

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
└──────────────────────────┴───────────────────────────────────┘
```

**Dependency direction (single direction, downward):**
- target/research/plan/exec/check/verify/merge/security/annotate → highlight protocol (reference)
- highlight → Library Write Protocol (call)
- No circular dependencies

## Scope Definitions

highlight defines 7 scopes. Scopes §3.1–§3.4 are **inline protocols** (executed by calling skills). Scopes §3.5–§3.6 are **independent executions** (run as standalone skill invocations).

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

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<notebook>-impl.md` |
| Write mode | O_APPEND + `---` separator (create if not exists) |
| Lock | `.memory/.experiences/.lock` |
| quality_status | `provisional` |
| completeness | `partial` |
| source | `highlight-exec` |

#### Frontmatter

```yaml
---
quality_status: provisional
completeness: partial
source: highlight-exec
type: <from .index.json>
notebook: <notebook-name>
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2]
---
```

#### Content Structure

```markdown
## Implementation Experience — <notebook> (<date>)

### Decisions
- <decision 1>: <rationale>

### Patterns
- <pattern/technique discovered>

### Pitfalls
- <pitfall/workaround>

### Deviations from Plan
- <what changed and why>
```

#### Write Steps

1. acquire `.memory/.experiences/.lock`
2. O_APPEND write to `<notebook>-impl.md` (if file has frontmatter, append after `---` separator)
3. acquire `.changelog.lock` → append: `<ts> | experience | .memory/.experiences/<type>/<notebook>-impl.md | quality_status:provisional | source:highlight-exec` → release `.changelog.lock`
4. update `<type>/.index.md` (overwrite matching row or append new row)
5. release `.memory/.experiences/.lock`

#### Fault Isolation

> Inline call failure MUST NOT block exec's main flow. exec's code implementation, state transitions, and .auto-signal write are unaffected. On failure: log warning and continue.

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

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<notebook>-verify.md` |
| Write mode | O_APPEND + `---` separator |
| Lock | `.memory/.experiences/.lock` |
| quality_status | `provisional` |
| completeness | `partial` |
| source | `highlight-verify` |

#### Frontmatter

```yaml
---
quality_status: provisional
completeness: partial
source: highlight-verify
type: <from .index.json>
notebook: <notebook-name>
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2]
---
```

#### Content Structure

```markdown
## Verification Experience — <notebook> (<date>)

### Test Results
- <outcome summary>

### Effective Methods
- <what verification approaches worked>

### Thresholds
- <discovered metric ranges>

### VFP Patterns (software types)
- <VH stub techniques, CGG results, refactoring patterns>
```

#### Write Steps

Same as scope=impl (steps 1-5), with different filename and source field.

#### Fault Isolation

> Same as scope=impl. Inline call failure MUST NOT block verify's main flow.

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
| **Medium-value** | merge | During conflict resolution | Conflict resolution strategy reasoning (only when conflicts occur) |
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

Follow `library/references/quality-rubric.md` H/M/L self-assessment standards.

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
3. No lock needed (filename contains notebook + caller + date, naturally unique)

#### Fault Isolation

> Same as other inline scopes. CoT capture is optional — failure does not affect caller's main flow.

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

#### Write Steps (promotion)

1. acquire `.memory/.experiences/.lock`
2. read target file frontmatter
3. modify `quality_status: provisional → verified`
4. atomic write (.tmp → rename)
5. acquire `.changelog.lock` → append: `<ts> | experience | <path> | quality_status:verified | promoted-by:check` → release
6. release `.memory/.experiences/.lock`

#### Write Steps (invalidation)

Same as promotion, but `quality_status: provisional → invalidated`, changelog marks `invalidated-by:check`.

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

This is highlight's core scope, carrying all logic previously in report steps 13-15.

#### Trigger & Dual Modes

| Mode | Trigger | Primary Input | Auxiliary Input |
|------|---------|--------------|-----------------|
| **auto-complete** | Auto loop after merge | System files (see table below) | None (no conversation context) |
| **manual-complete** | User runs `/task-ai:highlight <notebook>` | **Current conversation context** | System files (structural supplement) |

- auto-complete: agent starts independently, no conversation history, reads only from filesystem
- manual-complete: user triggers in conversation, conversation context contains rich decision processes — use as primary distillation source
- Manual trigger is not limited by notebook status — any status can be distilled (executing, blocked, cancelled)

#### Idempotency Check (auto-complete mode)

auto-complete checks whether distillation is necessary before executing:

```
input_files = [.target.md, .plan.md, .summary.md, *-impl.md, *-verify.md, ...]
latest_input_mtime = max(mtime(f) for f in input_files if exists(f))

# Stage-aware output filename
Read .index.json stage field (default { current: 1, total: 1, completed: [] }):
  IF stage.total > 1 AND status == "stage-done":
    filename = "<notebook>-stage-<stage.current>-complete.md"
  ELSE:
    filename = "<notebook>-complete.md"

existing_complete = .memory/.experiences/<type>/{filename}

if existing_complete exists AND mtime(existing_complete) >= latest_input_mtime:
    log "No new content since last distillation, skipping"
    write .auto-signal { step: "highlight", result: "(skipped-idempotent)", next: "report" }
    return
```

manual-complete mode **skips idempotency check** — user explicit trigger always executes, since conversation context is new input.

#### Input Files (auto-complete's full source / manual-complete's auxiliary source)

| Input File | Purpose |
|-----------|---------|
| `.index.json` | Task metadata (type, status, completed_steps) |
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

**Stage-aware file naming** — read `.index.json` `stage` field (default `{ current: 1, total: 1, completed: [] }` if missing):

| Scenario | Target filename |
|----------|----------------|
| Intermediate stage (`stage.total > 1` AND `status == "stage-done"`) | `<notebook>-stage-<stage.current>-complete.md` |
| Final stage (`stage.current == stage.total`, including `total: 1`) | `<notebook>-complete.md` |

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type-segment>/{filename}` |
| Write mode | **Overwrite** (.tmp → rename) — final version replaces all provisional versions |
| Lock | `.memory/.experiences/.lock` |
| quality_status | `verified` |
| completeness | `complete` |
| source | `highlight-complete` |

For multi-type (e.g., `data-pipeline|ml`), write one file per pipe segment. Segments use directory-safe transform (`:` → `-`).

**Final stage distillation** (last stage merge → `complete`): uses `<notebook>-complete.md` (no stage prefix). Additionally reads ALL prior `-stage-*-complete.md` files as input to synthesize cumulative cross-stage experience into the final distillation.

**Context budget guard**: When reading input files for distillation, apply an upper bound of ~50k tokens on total input. If combined input exceeds the context budget, prioritize in this order: `.index.json` > `.target.md` > `.summary.md` > `.plan.md` > prior `-stage-*-complete.md` > existing provisional experience > `.analysis/` > `.test/` > `.bugfix/` > `.notes/` > `.thinking/raw/`. Truncate lowest-priority sources first. Log a warning if truncation occurs.

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

1. **Read** `.index.json` — get type, status, notebook metadata
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
5. **Output B** — Thinking Patterns distillation
6. **Output C** — Type-profiles sync
7. **library maintain --compact** (only check if `.changelog` exceeds 2000-line threshold)
8. **Git commit**: `task-ai(<notebook>):highlight complete distillation`
9. **Write .auto-signal** (only when running within auto loop):
   ```json
   { "step": "highlight", "result": "(distilled)", "next": "report", "checkpoint": "", "timestamp": "..." }
   ```

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

**Step 1 — Instruction Understanding**

Identify from user's natural language:
- Content scope to summarize (which conversation fragments, which operations)
- Why it's valuable (what problem was solved, what pattern was discovered)
- If instruction is ambiguous (cannot determine what to summarize) → clarify with user before continuing

**Step 2 — Type Determination**

```
if in notebook context (CWD has .working/.index.json):
    type = .index.json type field
elif user specified a domain in instruction:
    type = user-specified domain, match .type-registry.md existing types
else:
    agent infers type from experience content
    prefer matching .type-registry.md existing types
    no match → type = "general"
```

**Step 3 — Experience Extraction**

Review current conversation context, extract:
- Key decisions and rationale
- Discovered patterns and techniques
- Tools/technologies/commands used
- Problems solved and methods
- Pitfalls and workarounds encountered

Filter out:
- Temporary debug output (only useful for this session)
- Unverified guesses and speculation
- Sensitive information (tokens, passwords, usernames in paths, etc.)

**Step 4 — Content Structuring**

```markdown
## Context
<scenario that produced this experience, problem background>

## What Worked
- <successful approaches>

## What Didn't Work
- <failed attempts and reasons (if any)>

## Key Decisions
- <decision>: <rationale>

## Patterns
- <reusable patterns/techniques>
```

**Step 5 — Frontmatter Generation**

```yaml
---
quality_status: provisional
completeness: partial
source: highlight-adhoc
type: <determined in step 2>
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2, ...]
---
```

**Step 6 — Filename Generation**

- Extract 2-4 semantic keywords (English) from experience content
- Convert to kebab-case slug (e.g., `websocket-reconnect-debugging`)
- Validate slug matches `[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*`
- Filename: `<slug>-adhoc.md`

> User's natural language input is NOT used directly as filename. Slug is generated by agent from experience content semantics.

**Step 7 — Write**

1. `mkdir -p $NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/`
2. acquire `.memory/.experiences/.lock`
3. write `.memory/.experiences/<type>/<slug>-adhoc.md` (create new or overwrite same-name file)
4. acquire `.changelog.lock` → append: `<ts> | experience | .memory/.experiences/<type>/<slug>-adhoc.md | quality_status:provisional | source:highlight-adhoc` → release `.changelog.lock`
5. update `<type>/.index.md` (append row)
6. update `<type>/.summary.md` (overwrite rewrite)
7. update top-level `.memory/.experiences/.summary.md` (overwrite rewrite)
8. release `.memory/.experiences/.lock`

**Step 8 — Git commit**

```
task-ai(<scope>):highlight adhoc experience captured
```

scope = notebook slug (if in notebook context) or project directory name (fallback).

**Step 9 — Feedback**

Output to user: captured experience summary, write path, type classification.

#### Does NOT Write .auto-signal

adhoc mode does not participate in auto loop, does not write .auto-signal.

---

## State Transitions

highlight **does not change notebook status**. Regardless of scope, `.index.json` status is unaffected.

| scope | Status impact |
|-------|-------------|
| impl | None (exec manages status) |
| verify | None (verify manages status) |
| thinking-raw | None (callers manage their own status) |
| quality-update | None (check manages status) |
| complete | None (merge already set complete) |
| adhoc | None (no notebook lifecycle) |

## Git

| Action | Commit Message |
|--------|---------------|
| complete distillation | `task-ai(<notebook>):highlight complete distillation` |
| adhoc capture | `task-ai(<scope>):highlight adhoc experience captured` |

> Inline calls (impl/verify/thinking-raw/quality-update) do not produce independent commits. Their changelog updates are included in the caller's git commit (e.g., exec's commit includes impl experience write changelog changes).

## .auto-signal

| scope | signal |
|-------|--------|
| complete (success) | `{ "step": "highlight", "result": "(distilled)", "next": "report", "checkpoint": "", "timestamp": "..." }` |
| complete (idempotent skip) | `{ "step": "highlight", "result": "(skipped-idempotent)", "next": "report", "checkpoint": "", "timestamp": "..." }` |
| complete (failure) | `{ "step": "highlight", "result": "failed", "next": "report", "checkpoint": "", "timestamp": "..." }` |
| adhoc | No signal (not part of auto) |
| inline scopes | No signal (callers write their own signals) |

## Notes

- **Protocol, not runtime**: Inline scopes (§3.1–§3.4) define write format and steps. Calling skills execute these steps in their own context — highlight is not invoked as a separate skill for inline scopes
- **Fault isolation is universal**: All 9 inline callers have the same guarantee — highlight protocol failure never blocks the caller's main flow
- **No state mutations**: highlight is transparent to the state machine. This is consistent with the former `light` behavior
- **.type-profiles/ dual ownership**: research creates/updates profiles (knowledge acquisition); highlight syncs during complete (experience write-back). Both use Library Write Protocol locks for concurrency safety
- **Concurrency**: Independent executions (complete, adhoc) acquire `.working/.lock` before proceeding and release on completion (see Concurrency Protection in `commands/task-ai.md`)
