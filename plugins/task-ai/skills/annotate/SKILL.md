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

> **See `references/annotation-processing.md`** for processing logic (triage rules, cross-impact assessment, conflict detection), and execution report format.

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

1. **Parse JSONL** from prompt context: extract `file`, `type`, `selected`, `cursor`, and type-specific content fields. Group annotations by `file` — read each source file once
2. **Path validation**: each `file` absolute path must resolve (after symlink resolution) to a location under `$NB_WORKSPACES_ROOT/`. Reject if any path escapes (prevents path traversal)
3. **Determine file layer** for each annotation (Requirement / Planning / Evaluation / Methodology / Information)
4. **Read `.index.json`** — validate status is not terminal (`complete` / `cancelled` / `stage-done`). If terminal, REJECT
5. **Read context files**: `.target.md` + `.plan.md` + `.test/` (latest criteria)
6. **Read** the annotated source file(s)
7. **Content sanitization**: strip HTML comments (`<!-- ... -->`), ANSI escape sequences, and control characters (U+0000–U+001F except `\n` and `\t`, and U+007F) from annotation content before writing. Preserve markdown formatting and visible text
8. **Triage** each annotation by type × file layer
9. **Cross-impact assessment** (based on file layer × annotation type — see §Cross-Impact Assessment)
10. **Execute changes**: write to source file. Comment annotations append `> 💬`/`> 📝` blockquotes — never modify existing content
11. **Update `.index.json`** per State Transitions (two-dimensional: `status × file_layer × annotation_type`):
    - If new status is `re-planning`, set `phase: needs-check`
    - Otherwise clear `phase` to `""`
    - Update `updated` timestamp
12. **Write `.summary.md`** with condensed context reflecting annotation changes
13. Execute highlight protocol scope=thinking-raw — see `highlight/SKILL.md` §3.3. Optional (medium-value). Capture cross-impact assessment reasoning. Inline call failure MUST NOT block annotate's main flow
14. **Git commit**: `task-ai(<notebook>):annotate annotations processed`
15. **Write `.auto-signal`** (route `next` by file layer — see §.auto-signal Routing)
16. **Generate execution report** (print to screen)

## State Transitions — Two-Dimensional

State transitions depend on **(current status, file layer, annotation type)**. Comment annotations **never** trigger state transitions across all file layers — they only append blockquotes.

### Requirement Layer — `.target.md`

| Current Status | Modify (Delete/Replace/Insert) | Comment | Next Status |
|----------------|-------------------------------|---------|-------------|
| `draft` | = `draft` | = `draft` | Requirements still being defined |
| `planning` | = `planning` | = `planning` | plan skill reads new target on next run |
| `review` | → `re-planning` | = `review` | Requirements changed after plan review |
| `executing` | → `re-planning` | = `executing` | Heaviest case: mid-execution requirement change |
| `re-planning` | = `re-planning` | = `re-planning` | Continue revision |
| `blocked` | → `planning` | = `blocked` | Unblocking |
| `complete`/`cancelled`/`stage-done` | REJECT | REJECT | Terminal states |

> **`planning` does not jump to `re-planning`**: `re-planning` presumes a reviewed plan exists. In `planning`, the plan may be a draft or absent. plan skill in `re-planning` runs gap analysis (assumes reviewed plan), while in `planning` it runs full planning. Jumping would cause plan skill to incorrectly downgrade. plan skill reads `.target.md` fresh each run — requirement changes are absorbed naturally.

### Planning Layer — `.plan.md`

| Current Status | Modify | Comment | Next Status |
|----------------|--------|---------|-------------|
| `draft` | → `planning` | → `planning` | First annotation triggers planning |
| `planning` | = `planning` | = `planning` | Plan still being drafted |
| `review` | → `re-planning` | = `review` | Reviewed plan modified |
| `executing` | → `re-planning` | = `executing` | Mid-execution plan change |
| `re-planning` | = `re-planning` | = `re-planning` | Continue revision |
| `blocked` | → `planning` | = `blocked` | Unblocking |

### Evaluation Layer — `.analysis/*.md`, `.test/*.md`

| Current Status | Target File | Modify | Comment |
|----------------|-------------|--------|---------|
| `executing` | `.analysis/*.md` | = `executing` (mark re-check) | = `executing` |
| `executing` | `.test/*.md` | = `executing` (mark re-verify) | = `executing` |
| `review` | `.analysis/*.md` | → `re-planning` | = `review` |
| other | any evaluation file | = (keep current) | = (keep current) |

> Evaluation layer annotations typically don't trigger `re-planning` directly — they flag for re-check/re-verify at the next verify/check run. Exception: review status + analysis modification = conclusion overturned → `re-planning`.

### Methodology Layer — `.type-profile.md`

| Modify | Comment |
|--------|---------|
| = (keep current), mark dirty for next verify/check | = (keep current) |

### Information Layer — `.summary.md`, `.bugfix/*.md`, `.notes/*.md`

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

The `next` field routes by **(file layer, current status)**. Comment-only annotations always set `next` to `(none)`.

```json
{ "step": "annotate", "result": "(processed)", "next": "<by-layer>", "checkpoint": "post-annotate", "timestamp": "..." }
```

| Annotation target layer | Current status | `next` | Reason |
|------------------------|----------------|--------|--------|
| Requirement `.target.md` | `planning` | `plan` | Requirements changed, plan regenerates (reads new target) |
| Requirement `.target.md` | `review`/`executing` | `check` | Reviewed plan needs re-checking against changed requirements |
| Requirement `.target.md` | `draft` | `(none)` | Still defining requirements |
| Planning `.plan.md` | `planning` | `check` | Plan modified, needs review |
| Planning `.plan.md` | `review`/`executing` | `check` | Same |
| Evaluation `.analysis/*` | any | `check` | Evaluation conclusion challenged |
| Evaluation `.test/*` | any | `verify` | Test criteria/results changed |
| Methodology `.type-profile.md` | any | `verify` | Methodology change affects verification |
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
