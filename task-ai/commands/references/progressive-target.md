# Progressive Evolution — Target Format Reference

## Overview

The progressive evolution model replaces predefined multi-stage planning with emergent stage discovery. Stages are defined one at a time — plan one step, execute it, evaluate results, then decide the next step based on new understanding.

**Key principles:**
- Stages are emergent, not predefined — no `stage.total`
- No terminal "complete" state — `satisfied` is non-terminal, can re-enter evolution
- Each stage follows the full lifecycle: target → plan → exec → check ACCEPT → auto sets evolving → highlight → report
- LLM auto-generates next substage target based on convergence gap (see `auto/SKILL.md` Phase 4)
- User can pause (`target --satisfy`) or refine Overall Objective to re-enter from `satisfied`
- Deliverables accumulate on the task branch. User can call merge anytime to copy deliverables to main (merge is pure file copy, no status changes)
- The lifecycle diagram above is simplified; the full loop includes check, verify, and highlight steps — see `auto/SKILL.md` for the complete state machine

## Stage Lifecycle

```
Stage 1: target → plan → exec → check ACCEPT → auto sets evolving → highlight → report
  ↓ convergence < 0.95 → LLM auto-generates next substage target (see auto/SKILL.md Phase 4)
Stage 2: target → plan → exec → check ACCEPT → auto sets evolving → highlight → report
  ↓ convergence ≥ 0.95 → satisfied → final report (task complete, automatic)
  ↓ later, user refines Overall Objective
satisfied → evolving → auto-generates substage → planning → ...
```

## .target.md Progressive Format

### Status Markers

| Marker | Applies To | Meaning |
|--------|------------|---------|
| (no marker) | Objective item | Item is being discussed — excluded from plan scope |
| `[CONFIRMED]` | Objective item | Item confirmed by user — included in plan scope |
| `[PROCESSED]` | Objective item | Plan generated for this item — execution in progress |

**Plan gate**: At least one `[CONFIRMED]` item required. Unconfirmed items are excluded from current plan.
| (no marker) | Overall Objective | Goal is being executed (Stage 1+ active) |
| `[ACTIVE]` | Stage | Currently executing stage |
| `[COMPLETE]` | Stage | Completed stage |

### Phase 1: Draft (status=draft, objective being refined):
```markdown
# Task Target: notebook-name

## Overall Objective
- <goal item 1>
- <goal item 2>
- <goal item 3>
<!-- No markers — all items under discussion -->

## Requirements
...

## Constraints
...
```

### Phase 1 complete (items confirmed, status → planning):
```markdown
# Task Target: notebook-name

## Overall Objective
- <goal item 1> [CONFIRMED]
- <goal item 2> [CONFIRMED]
- <goal item 3>
<!-- Only [CONFIRMED] items included in plan -->

## Requirements
...

## Constraints
...
```

### Stage 1 active (status=executing, plan generated):
```markdown
# Task Target: notebook-name

## Overall Objective
- <goal item 1> [PROCESSED]
- <goal item 2> [PROCESSED]
- <goal item 3> [CONFIRMED]
<!-- [PROCESSED] = in current plan; [CONFIRMED] = queued for later -->

---

## Stage 1: <name> [ACTIVE]
### Stage Objective
### Requirements
### Constraints
```

### Stage 1 complete (auto fills Results on ACCEPT):
```markdown
# Task Target: notebook-name

## Overall Objective
- <goal item 1> [PROCESSED]
- <goal item 2> [PROCESSED]
- <goal item 3> [CONFIRMED]

---

## Stage 1: <name> [COMPLETE]
### Stage Objective
### Requirements
### Constraints
### Results
<auto fills on check ACCEPT>
```

### Stage 2 auto-generated (appended by target via auto Phase 4):
```markdown
## Stage 2: <name> [ACTIVE]
### Stage Objective
<LLM auto-generates based on convergence gap — see auto/SKILL.md Phase 4>
### Requirements
### Constraints
```

**Key differences from old model:**
- Markers are per-item, not per-section
- No marker = item under discussion (excluded from plan)
- `[CONFIRMED]` = item confirmed (included in plan scope)
- `[PROCESSED]` = item in execution (plan generated)
- `[ACTIVE]` and `[COMPLETE]` track Stage execution status
- Stage 1 content is retroactively wrapped as `## Stage 1 [COMPLETE]` by auto (on check ACCEPT)

## Status Transitions

| From | To | Via | Note |
|------|-----|-----|------|
| `executing` | `evolving` | auto (check ACCEPT) | Auto handles: update .target.md, .status.json, push stage.history |
| `evolving` | `planning` | target | LLM auto-generates next substage target (convergence < 0.95) |
| `evolving` | `satisfied` | auto (convergence ≥ 0.95) or `target --satisfy` | Automatic when convergence ≥ 0.95; or user manually says "enough" at any convergence level |
| `satisfied` | `evolving` | target (refine) | User refines Overall Objective → convergence drops |
| `satisfied` | `planning` | target | Direct re-entry (shortcut: satisfied → evolving → planning) |
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

No `total` field. `history` replaces old `completed`. Each entry: `{ "stage": N, "name": "...", "completed_at": "...", "commit": "...", "convergence": 0.0 }`.

## Convergence Tracking (v2)

Convergence quantifies how close current deliverables are to the overall objective. Each requirement R# in `.target.md` is scored and weighted:

```
convergence = Σ(wᵢ × cᵢ) / Σ(wᵢ)
```

Where `wᵢ` is the weight of requirement i (default 1.0) and `cᵢ` is its completion score (0.0–1.0). The R# items and weights are defined in `.convergence-baseline.md` (generated by `target`). The per-R# scores are recorded in `.analysis/<date>-convergence.md` after each `check post-exec`, and the aggregate convergence value is stored in `stage.history[].convergence` upon stage completion.

### Convergence Trend & Direction Gate

The convergence score must **monotonically increase** across stages. After `check post-exec`, the current convergence is compared against the previous stage's baseline:

| Condition | Verdict | Action |
|-----------|---------|--------|
| convergence > previous | ACCEPT | Stage accepted → evolving (auto writes stage.history; merge optional for deliverables copy) |
| convergence ≤ previous | ROLLBACK | Revert to previous stage commit |

### Auto Rollback

When `check post-exec` emits ROLLBACK:

1. `git reset --hard <previous_stage_commit>` — revert to the commit recorded in `stage.history[-1].commit`
2. Status transitions to `evolving` (stage.current decremented)
3. The auto loop re-enters `target` to redefine the stage with a different approach
4. `.convergence-baseline.md` is restored to the previous stage's version

This prevents wasted iteration on approaches that move the task further from its objective.

## Pending Refinement Buffer (v2)

During auto execution, new requirements or scope changes may be discovered but cannot be acted on mid-stage. These are captured in `.pending-refinements.md` as an async buffer:

- **Writers**: any skill during auto mode that observes unaddressed scope (exec, check, verify)
- **Consumers**: `target` reads and incorporates pending refinements when transitioning from `evolving` → `planning`
- **Format**: append-only markdown list with source attribution and timestamp
- **Lifecycle**: cleared after `target` consumes the entries into the next stage's requirements
