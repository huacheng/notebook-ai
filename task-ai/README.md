# task-ai

Structured task lifecycle management for Claude Code — 18 skills for AI-driven development with project/notebook hierarchy, domain-aware verification, knowledge library, and autonomous execution.

## Design Philosophy: Emergent Evolution

task-ai embraces an **emergent model** for complex, exploratory tasks — both objectives and stages evolve through dialog rather than being predefined.

### The Problem with Waterfall

Traditional task systems assume:
- Objectives are fully known upfront
- Stages can be planned in advance
- "Complete" is a terminal state

This works for repetitive, well-understood tasks. But for exploratory work — research, design, complex debugging — reality is different: you discover what you're building as you build it.

### The Emergent Model

```
Waterfall:
  Define 3 stages upfront → Execute stage 1 → Execute stage 2 → Execute stage 3 → Complete (terminal)

Emergent:
  Define current step only → Execute → Reflect → Define next step → Execute → ...
  → User says "enough" → Satisfied (non-terminal, can re-enter)
```

| Dimension | Waterfall | Emergent |
|-----------|-----------|----------|
| **Objectives** | Defined once, minor refinements only | Continuous evolution — each dialog turn checks for power/robustness/completeness/realism/excellence/precision signals |
| **Stages** | Predefined `stage.total` | No total — complete one stage, then decide next based on new understanding |
| **Terminal State** | `complete` is final | No terminal state — `satisfied` can re-enter `evolving` |

### Core Insight

```
For exploratory tasks:
  Objective ≠ one-time input
  Stages    ≠ upfront planning
  Done      ≠ system-determined

Instead:
  Objective = f(initial intent, dialog insights, implementation feedback)
  Stage     = optimal next step within current knowledge boundary
  Done      = user judgment at a point in time (not permanent)
```

## Architecture

```
$NB_WORKSPACES_ROOT/
├── .library/                    # Shared knowledge library
│   └── .memory/                 # Experiences, references, thinking patterns
├── project-a/
│   ├── .deliverables/           # Project-level deliverables (shared by all notebooks)
│   └── .worktrees/              # Git worktrees directory
│       └── task-notebook-1/     # Notebook worktree on branch task/notebook-1
│           ├── .deliverables/   # Task deliverables (merged to project level)
│           └── .working/        # System state files (TASKAI_WORK_DIR)
│               ├── .status.json     # Task status, stage, phase
│               ├── .target.md       # Objectives (evolves through dialog)
│               ├── .plan.md         # Implementation plan
│               └── .convergence-baseline.md  # Weighted R# scoring
└── project-b/
    └── ...
```

## Skills (18)

| Skill | Description |
|-------|-------------|
| `auto` | Conversational task lifecycle orchestration — the main entry point |
| `init` | Initialize notebook with git branch and working directory |
| `target` | Define and evolve objectives in `.target.md` |
| `plan` | Generate implementation plans with verification hypotheses |
| `exec` | Execute plan steps with RED-GREEN-Refactor discipline |
| `check` | Six-dimension gated review (D1-D6) |
| `verify` | Domain-adapted test execution |
| `merge` | Copy deliverables from task branch to main |
| `report` | Generate completion reports |
| `research` | Intelligence collection for objectives and implementation |
| `highlight` | Distill experiences to shared library |
| `read` | Ingest documents, deduplicate against library |
| `library` | Knowledge library management |
| `security` | Runtime guardian — audit plans, intercept risky commands |
| `annotate` | Process plan annotations (Insert/Delete/Replace/Comment) |
| `summarize` | Regenerate `.summary.md` for context recovery |
| `list` | Query task status and dependencies |
| `cancel` | Cancel task, cleanup resources |

## Usage

```bash
# Start a new task
/task-ai:auto

# Or use individual skills
/task-ai:init my-project my-notebook
/task-ai:target "Build a REST API for user management"
/task-ai:plan
/task-ai:exec
```

## Key Concepts

### Four-Phase Flow

1. **Phase 1 (Target)** — Human in the loop: define objectives through dialog
2. **Phase 2 (Planning)** — Auto with intervention: generate and review plan
3. **Phase 3 (Execution)** — Auto with intervention: execute with checkpoints
4. **Phase 4 (Acceptance)** — Distill experiences, generate report

### Objective Evolution

Every conversation turn, Claude checks for evolution signals:

| Type | Signal | Example |
|------|--------|---------|
| Power | New capability | "Also support batch operations" |
| Robustness | Edge case | "What if network fails?" |
| Completeness | Missing requirement | "Need permission control too" |
| Realism | Constraint discovered | "Server only has 2GB RAM" |
| Excellence | Quality bar raised | "Must respond within 100ms" |
| Precision | Scope clarification | "Only Chrome support needed" |

### Six-Dimension Review (D1-D6)

All checkpoints evaluate against:
- **D1 Correctness** — Does it do what's required?
- **D2 Security** — Does it resist what shouldn't happen?
- **D3 Reliability** — Does it degrade gracefully?
- **D4 Performance** — Is it fast and efficient enough?
- **D5 Architecture** — Does structure support change?
- **D6 Maintainability** — Can the next person understand it?

### Convergence Tracking

Progress toward objectives is quantified:
```
convergence = Σ(weight × completion) / Σ(weight)
```

Each requirement in `.convergence-baseline.md` is scored 0.0-1.0. Stages must show monotonic convergence improvement — regression triggers rollback.

## License

MIT
