# Progressive Evolution — Target Format Reference

## Overview

The progressive evolution model replaces predefined multi-stage planning with emergent stage discovery. Stages are defined one at a time — plan one step, execute it, evaluate results, then decide the next step based on new understanding.

**Key principles:**
- Stages are emergent, not predefined — no `stage.total`
- No terminal "complete" state — `satisfied` is non-terminal, can re-enter evolution
- Each stage follows the full lifecycle: target → plan → check → exec → merge → evolving
- User decides when to continue (`target` next stage) or pause (`target --satisfy`)
- The lifecycle diagram above is simplified; the full loop includes check, verify, and highlight steps — see `auto/SKILL.md` for the complete state machine

## Stage Lifecycle

```
Stage 1: target → plan → exec → merge → evolving
  ↓ user defines next direction
Stage 2: target → plan → exec → merge → evolving
  ↓ user says "enough for now"
target --satisfy → satisfied
  ↓ later, user has new ideas
target (re-enter) → planning → ...
```

## .target.md Progressive Format

### Stage 1 (initial — identical to single-stage format):
```markdown
# Task Target: notebook-name

## Objective
<user's overall goal>

## Requirements
...

## Constraints
...
```

### After Stage 1 completes (merge fills Results):
```markdown
# Task Target: notebook-name

## Overall Objective
<persistent overall goal>

---

## Stage 1: <name> [COMPLETE]
### Stage Objective
### Requirements
### Constraints
### Results
<merge auto-fills>
```

### User defines Stage 2 (appended):
```markdown
## Stage 2: <name> [ACTIVE]
### Stage Objective
<user defines next step direction>
### Requirements
### Constraints
```

**Key differences from old model:**
- No `[PENDING]` stages — future stages are not predefined
- Original top-level Objective becomes `## Overall Objective` when entering stage 2
- Stage 1 content is retroactively wrapped as `## Stage 1 [COMPLETE]` by merge

## Status Transitions

| From | To | Via | Note |
|------|-----|-----|------|
| `executing` | `evolving` | merge | Always (no stage.total comparison) |
| `evolving` | `planning` | target | User defines next stage |
| `evolving` | `satisfied` | target --satisfy | User says "enough" |
| `satisfied` | `planning` | target | User re-enters evolution |
| `satisfied` | `cancelled` | cancel | Permanent abandonment |

## .status.json Stage Field

```json
{
  "stage": {
    "current": 1,
    "history": []
  }
}
```

No `total` field. `history` replaces old `completed`. Each entry: `{ "stage": N, "name": "...", "completed_at": "..." }`.
