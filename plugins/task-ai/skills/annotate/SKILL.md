---
name: annotate
description: "Process file annotations — triage, cross-impact assessment, and execution. Triggered automatically when annotations (Insert/Delete/Replace/Comment) are submitted from the file viewer UI via JSONL prompt."
model_tier: medium
auto_delegatable: false
triggers:
  keywords:
    zh: [批注, 标注, 注释, 修改计划, 计划批注]
    en: [annotate, annotation, mark up, plan comment, plan edit]
  phrases:
    zh: [处理批注, 计划有批注, 批注提交了, 修改计划步骤]
    en: [process annotations, there are annotations, annotations submitted, modify plan steps]
  disambiguate: >
    Core intent: process structured annotations (Insert/Delete/Replace/Comment) on system files (.working/ dotfiles) from the UI.
    Annotations arrive as JSONL in the prompt context (not from file).
    User wants to REGENERATE the whole plan → plan. User wants to change the GOAL → target.
arguments:
  - name: mode
    description: "Execution mode: interactive (default) or silent"
    required: false
    default: interactive
---

# /task-ai:annotate — Annotation Processing

Process JSONL annotations from the file viewer prompt. Supports 4 annotation types: Insert, Delete, Replace, Comment. Each is triaged by file layer and cross-impact before execution.

**Input**: Annotations arrive as JSONL lines in the prompt context (one JSON object per line). The frontend prepends `/task-ai:annotate\n` to invoke this skill — annotations are parsed from the prompt, not from files.

## Input Format — JSONL

Each annotation is a single JSON line with these fields:

```typescript
// All types share these fields
{ file: string;      // absolute path to the annotated file
  type: 'insert' | 'delete' | 'replace' | 'comment';
  selected: string;  // user-selected text (anchor, max 80 chars)
  cursor: number;    // character offset in source file text
}
// Type-specific fields:
// insert:  { content: string }     — text to insert after selection
// replace: { replacement: string } — text to replace selection with
// comment: { comment: string }     — comment on selected text
// delete:  (no extra field)        — delete the selected text
```

**Positioning**: `cursor` is the character offset in the **source file** (not rendered text). The model uses `cursor` + `selected` as dual anchors to locate the exact position in the source file. When multiple annotations target the same file, group them by `file` and read each file only once.

> **See `references/annotation-processing.md`** for processing logic (triage rules, cross-impact assessment, conflict detection) and execution report format.

## File Layer Classification

Annotations are routed by the semantic layer of the target file. Higher layers trigger stronger cascading effects:

```
Requirement layer (strongest) → Planning → Evaluation → Methodology → Information (weakest)
```

| Layer | Files | Annotation semantics |
|-------|-------|---------------------|
| **Requirement** | `.target.md` | Changes "what to do" — cascades to all downstream |
| **Planning** | `.plan.md` | Changes "how to do it" — affects execution but not requirements |
| **Evaluation** | `.analysis/*.md`, `.test/*-criteria.md`, `.test/*-results.md` | Changes judgment criteria or challenges conclusions |
| **Methodology** | `.type-profile.md` | Changes domain judgment and verification methods |
| **Information** | `.summary.md`, `.bugfix/*.md`, `.notes/*.md` | Changes context — lowest impact |

## Execution Steps

1. **Acquire `.working/.lock`** — if lock is held (e.g., auto is running), REJECT immediately (fast-fail, no queue). See §Concurrency
2. **Parse JSONL** from prompt context: extract `file`, `type`, `selected`, `cursor`, and type-specific content fields. Group annotations by `file` — read each source file once. If any JSONL line fails to parse or is missing required fields, **release `.working/.lock`** and REJECT with error identifying the malformed line
3. **Path validation**: each `file` absolute path must resolve (after symlink resolution) to a location under `$NB_WORKSPACES_ROOT/`. If any path escapes, **release `.working/.lock`** and REJECT (prevents path traversal)
4. **Determine file layer** for each annotation (Requirement / Planning / Evaluation / Methodology / Information). Files that don't match any known layer default to Information (lowest impact)
5. **Read `.status.json`** — validate status is not terminal (`cancelled`). If terminal, **release `.working/.lock`** and REJECT. Note: `evolving` and `satisfied` are non-terminal and accept annotations
6. **Read context files**: `.target.md` + `.plan.md` + `.test/` (latest criteria)
7. **Read** the annotated source file(s)
8. **Content sanitization**: strip HTML comments (`<!-- ... -->`), ANSI escape sequences, and control characters (U+0000–U+001F except `\n` and `\t`, and U+007F) from annotation content before writing. Preserve markdown formatting and visible text
9. **Triage** each annotation by type × file layer
10. **Cross-impact assessment** (based on file layer × annotation type — see §Cross-Impact Assessment)
11. **Execute changes**: write to source file. Comment annotations append `> 💬`/`> 📝` blockquotes — never modify existing content. Apply modify-type annotations in reverse cursor order (see `references/annotation-processing.md` §Batch ordering)
12. **Update `.status.json`** (atomic write via `.status.json.tmp` + rename) per State Transitions (three-dimensional: `status × file_layer × annotation_type`):
    - If new status is `re-planning`, set `phase: needs-check`
    - If status is unchanged (including `evolving`), preserve existing `phase`
    - If status changed to something other than `re-planning`, clear `phase` to `""`
    - Update `updated` timestamp
13. **Write `.summary.md`** (atomic write via `.summary.md.tmp` + rename) with condensed context reflecting annotation changes
14. **Execute highlight** protocol `scope=thinking-raw` — see `highlight/SKILL.md` §3.3. Optional (medium-value). Captures cross-impact assessment reasoning. Inline call failure MUST NOT block annotate's main flow
15. **Git commit** (skip if all annotations were unresolvable and no files changed): `task-ai(<notebook>):annotate annotations processed`
16. **Write `.auto-signal`** (route `next` by file layer — see §.auto-signal Routing)
17. **Generate execution report** (print to screen)
18. **Release `.working/.lock`**

## State Transitions — Three-Dimensional

State transitions depend on **(current status, file layer, annotation type)**. Comment annotations **never** trigger state transitions regardless of file layer — they only append blockquotes.

### Requirement Layer — `.target.md`

| Current Status | Modify (Delete/Replace/Insert) | Comment | Next Status |
|----------------|-------------------------------|---------|-------------|
| `draft` | = `draft` | = `draft` | Requirements still being defined |
| `planning` | = `planning` | = `planning` | plan skill reads new target on next run |
| `review` | → `re-planning` | = `review` | Requirements changed after plan review |
| `executing` | → `re-planning` | = `executing` | Heaviest case: mid-execution requirement change |
| `re-planning` | = `re-planning` | = `re-planning` | Continue revision |
| `blocked` | → `planning` | = `blocked` | Unblocking |
| `evolving` | REJECT | = `evolving` | Use `/task-ai:target` to define next stage; direct annotation modification rejected |
| `satisfied` | REJECT | = `satisfied` | Use `/task-ai:target` to re-enter evolution; direct annotation modification rejected |
| `cancelled` | REJECT | REJECT | Terminal state |

> **`planning` does not jump to `re-planning`**: `re-planning` presumes a reviewed plan exists. In `planning`, the plan may be a draft or absent. plan skill in `re-planning` runs gap analysis (assumes reviewed plan), while in `planning` it runs full planning. Jumping would cause plan skill to incorrectly downgrade. plan skill reads `.target.md` fresh each run — requirement changes are absorbed naturally.

### Planning Layer — `.plan.md`

| Current Status | Modify | Comment | Next Status |
|----------------|--------|---------|-------------|
| `draft` | → `planning` | = `draft` | Modify triggers planning; Comment never changes state |
| `planning` | = `planning` | = `planning` | Plan still being drafted |
| `review` | → `re-planning` | = `review` | Reviewed plan modified |
| `executing` | → `re-planning` | = `executing` | Mid-execution plan change |
| `re-planning` | = `re-planning` | = `re-planning` | Continue revision |
| `blocked` | → `planning` | = `blocked` | Unblocking |
| `evolving` | REJECT | = `evolving` | No active plan in evolving; use `/task-ai:target` to start next stage |
| `satisfied` | REJECT | = `satisfied` | No active plan; use `/task-ai:target` to re-enter evolution |
| `cancelled` | REJECT | REJECT | Terminal state |

### Evaluation Layer — `.analysis/*.md`, `.test/*.md`

| Current Status | Target File | Modify | Comment |
|----------------|-------------|--------|---------|
| `executing` | `.analysis/*.md` | = `executing` (mark re-check) | = `executing` |
| `executing` | `.test/*.md` | = `executing` (mark re-verify) | = `executing` |
| `review` | `.analysis/*.md` | → `re-planning` | = `review` |
| other (non-terminal) | any evaluation file | = (keep current) | = (keep current) |
| `cancelled` | any | REJECT | REJECT |

> Terminal states are rejected at step 5 before reaching this table. Evaluation layer annotations typically don't trigger `re-planning` directly — they flag for re-check/re-verify at the next verify/check run. Exception: `review` + `.analysis/*.md` modification = conclusion overturned → `re-planning`. Note: `review` + `.test/*.md` modification does **not** trigger `re-planning` — test changes flag for re-verify only, as they don't overturn the plan-level conclusion.

### Methodology Layer — `.type-profile.md`

All non-terminal statuses:

| Modify | Comment |
|--------|---------|
| = (keep current), mark dirty for next verify/check | = (keep current) |

### Information Layer — `.summary.md`, `.bugfix/*.md`, `.notes/*.md`

All non-terminal statuses:

| Any annotation type | Status |
|---------------------|--------|
| = (keep current) | Pure context improvement, no status change |

## Cross-Impact Assessment

When modify-type annotations (Delete/Replace/Insert) target higher-layer files, assess impact on lower-layer files:

```
.target.md change → check .plan.md for steps referencing modified requirement
                  → check .test/ for criteria based on modified requirement
                  → impact level: None / Low / Medium / High

.plan.md change   → check subsequent steps for dependency chains
                  → check .test/ for coverage of modified steps
                  → impact level: None / Low / Medium / High

.analysis/*.md    → check if current verdict is overturned
.test/*.md        → check if verification results are invalidated
```

Response by impact level (same for all file layers):

| Level | Action |
|-------|--------|
| **None** | Execute directly |
| **Low** | Adjust affected content inline |
| **Medium** | Research approach → execute → document resolution |
| **High — Interactive** | Explain + draft solution → print to screen → 10 min timeout → fall back to Silent |
| **High — Silent** | Write explanation + draft into file → await next annotation |

## Comment Semantics (Unified)

Comment annotations have **identical behavior across all file layers** — they never trigger state transitions and never modify existing content:

| Detection | Action |
|-----------|--------|
| Contains `?` or interrogative words | Research selected content → write `> 💬 ...` blockquote |
| Declarative sentence | Insert `> 📝 ...` blockquote below selected content |

## .auto-signal Routing

The `next` field routes by **(file layer, pre-transition status)**. The routing table uses the status **before** the transition to determine `next`, even though `.auto-signal` is written after `.status.json` is updated (step 16 follows step 12). Comment-only annotations always set `next` to `(none)`.

```json
{ "step": "annotate", "result": "(processed)", "next": "<by-layer>", "checkpoint": "post-annotate", "timestamp": "..." }
```

Terminal states (`cancelled`) are rejected at step 5 and never reach this table.

| Annotation target layer | Current status | `next` | Reason |
|------------------------|----------------|--------|--------|
| Requirement `.target.md` | `draft` | `(none)` | Still defining requirements |
| Requirement `.target.md` | `planning` | `plan` | Requirements changed, plan regenerates (reads new target) |
| Requirement `.target.md` | `review`/`executing` | `check` | Reviewed plan needs re-checking against changed requirements |
| Requirement `.target.md` | `re-planning` | `check` | Requirements changed during re-planning, re-check needed |
| Requirement `.target.md` | `blocked` | `plan` | Unblocking via requirement change, needs planning |
| Requirement `.target.md` | `evolving` | `(none)` | Stage complete; annotations stored for next stage |
| Planning `.plan.md` | `draft` | `plan` | Plan annotation triggers planning phase |
| Planning `.plan.md` | `planning` | `check` | Plan modified, needs review |
| Planning `.plan.md` | `review`/`executing` | `check` | Plan modified after review/during execution, needs re-check |
| Planning `.plan.md` | `re-planning` | `check` | Plan revised during re-planning, re-check needed |
| Planning `.plan.md` | `blocked` | `plan` | Unblocking via plan change, needs planning |
| Planning `.plan.md` | `evolving` | `(none)` | Stage complete; annotations stored for next stage |
| Evaluation `.analysis/*` | any non-terminal (except `evolving`) | `check` | Evaluation conclusion challenged |
| Evaluation `.analysis/*` | `evolving` | `(none)` | Stage complete; annotations stored for next stage |
| Evaluation `.test/*` | any non-terminal (except `evolving`) | `verify` | Test criteria/results changed |
| Evaluation `.test/*` | `evolving` | `(none)` | Stage complete; annotations stored for next stage |
| Methodology `.type-profile.md` | any non-terminal (except `evolving`) | `verify` | Methodology change affects verification |
| Methodology `.type-profile.md` | `evolving` | `(none)` | Stage complete; annotations stored for next stage |
| Information (`.summary.md` etc.) | any | `(none)` | Pure context improvement |
| Comment-only (any file) | any | `(none)` | Comments don't trigger downstream |

## Git

```
task-ai(<notebook>):annotate annotations processed
```

## Concurrency

- Annotate acquires `.working/.lock` before proceeding (see Concurrency Protection in `commands/task-ai.md`)
- **auto holds lock → annotate REJECTS** (fast-fail, no queue, no retry)
- User can retry after auto's current step completes, or `/task-ai:cancel` to stop auto first
- auto releases lock between iterations (at `.auto-stop` check), forming available windows

## Notes

- Annotations arrive via prompt JSONL — no intermediate files (`.tmp-annotations.json` is deprecated)
- `cursor` is a **source file character offset** — use `cursor` + `selected` to locate position precisely in the source file
- Cross-impact assessment should check ALL files in the task module, not just the current file
- **Content sanitization**: strip HTML comments, ANSI escapes, and control chars before writing
- **Frontend routing**: `isTaskSystemFile()` → prompt gets `/task-ai:annotate\n` prefix (skill call); non-system files → no prefix (Claude conversational response). Claude does not need to route — frontend does deterministic dispatch
