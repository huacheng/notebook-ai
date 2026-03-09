# State Transitions — Three-Dimensional

> Extracted from `annotate/SKILL.md` — full state transition tables by (current status, file layer, annotation type).

State transitions depend on **(current status, file layer, annotation type)**. Comment annotations **never** trigger state transitions regardless of file layer — they only append blockquotes.

### Requirement Layer — `.target.md`

| Current Status | Modify (Delete/Replace/Insert) | Comment | Next Status |
|----------------|-------------------------------|---------|-------------|
| `draft` | = `draft` | = `draft` | Requirements still being defined |
| `planning` | = `planning` | = `planning` | plan skill reads new target on next run |
| `review` | -> `re-planning` | = `review` | Requirements changed after plan review |
| `executing` | -> `re-planning` | = `executing` | Heaviest case: mid-execution requirement change |
| `re-planning` | = `re-planning` | = `re-planning` | Continue revision |
| `blocked` | -> `planning` | = `blocked` | Unblocking |
| `evolving` | REJECT | = `evolving` | Use `/task-ai:target` to define next stage; direct annotation modification rejected |
| `satisfied` | REJECT | = `satisfied` | Use `/task-ai:target` to re-enter evolution; direct annotation modification rejected |
| `cancelled` | REJECT | REJECT | Terminal state |

> **`planning` does not jump to `re-planning`**: `re-planning` presumes a reviewed plan exists. In `planning`, the plan may be a draft or absent. plan skill in `re-planning` runs gap analysis (assumes reviewed plan), while in `planning` it runs full planning. Jumping would cause plan skill to incorrectly downgrade. plan skill reads `.target.md` fresh each run — requirement changes are absorbed naturally.

### Planning Layer — `.plan.md`

| Current Status | Modify | Comment | Next Status |
|----------------|--------|---------|-------------|
| `draft` | -> `planning` | = `draft` | Modify triggers planning; Comment never changes state |
| `planning` | = `planning` | = `planning` | Plan still being drafted |
| `review` | -> `re-planning` | = `review` | Reviewed plan modified |
| `executing` | -> `re-planning` | = `executing` | Mid-execution plan change |
| `re-planning` | = `re-planning` | = `re-planning` | Continue revision |
| `blocked` | -> `planning` | = `blocked` | Unblocking |
| `evolving` | REJECT | = `evolving` | No active plan in evolving; use `/task-ai:target` to start next stage |
| `satisfied` | REJECT | = `satisfied` | No active plan; use `/task-ai:target` to re-enter evolution |
| `cancelled` | REJECT | REJECT | Terminal state |

### Evaluation Layer — `.analysis/*.md`, `.test/*.md`

| Current Status | Target File | Modify | Comment |
|----------------|-------------|--------|---------|
| `executing` | `.analysis/*.md` | = `executing` (mark re-check) | = `executing` |
| `executing` | `.test/*.md` | = `executing` (mark re-verify) | = `executing` |
| `review` | `.analysis/*.md` | -> `re-planning` | = `review` |
| other (non-terminal) | any evaluation file | = (keep current) | = (keep current) |
| `cancelled` | any | REJECT | REJECT |

> Terminal states are rejected at step 5 before reaching this table. Evaluation layer annotations typically don't trigger `re-planning` directly — they flag for re-check/re-verify at the next verify/check run. Exception: `review` + `.analysis/*.md` modification = conclusion overturned -> `re-planning`. Note: `review` + `.test/*.md` modification does **not** trigger `re-planning` — test changes flag for re-verify only, as they don't overturn the plan-level conclusion.

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
