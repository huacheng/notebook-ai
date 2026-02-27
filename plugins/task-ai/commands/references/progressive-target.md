# Progressive Target — Stage Lifecycle Reference

Multi-stage target support for complex tasks that span multiple plan→exec→merge cycles.

## Overview

The `stage` field in `.index.json` enables progressive task execution. A task with `stage.total > 1` proceeds through multiple stages, each following the full lifecycle: `planning → review → executing → stage-done`, before advancing to the next stage.

## Stage Lifecycle

```
Stage 1: target → plan → check → exec → merge → stage-done
  ↓ (target: define next stage)
Stage 2: planning → check → exec → merge → stage-done
  ↓
Stage N: planning → check → exec → merge → complete
```

*(Simplified — verify→check loops omitted. See `auto/SKILL.md` for the full loop with verify checkpoints.)*

Key transitions:
- `executing → stage-done` via merge (when `stage.current < stage.total`)
- `stage-done → planning` via target (next stage defined)
- `executing → complete` via merge (when `stage.current == stage.total`)

## Configuration

The `stage` field is defined in `task-ai.md` § Stage Field (Progressive Target). Default: `{ "current": 1, "total": 1, "completed": [] }`.

See `task-ai.md` for validation rules, default handling, and retry-safe design.

## Skills Affected

| Skill | Stage Behavior |
|-------|---------------|
| target | Three-branch routing: stage-done advance / multi-stage update / normal |
| plan | Reads only current `[ACTIVE]` stage from `.target.md` |
| merge | Routes to `stage-done` or `complete` based on stage progress |
| highlight | Stage-aware file naming for experience distillation |
| cancel | Available from `stage-done` (non-terminal state) |
| report | Available from `stage-done` (interim stage report) |
| auto | Entry point for `stage-done`: highlight → report → stop |

## Related References

- `task-ai.md` § Stage Field — schema, validation, defaults
- `state-matrix.md` — complete state × command matrix including `stage-done`
- `git-details.md` — stage-specific commit messages
