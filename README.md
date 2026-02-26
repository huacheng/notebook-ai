# Moonview

[中文文档](README_CN.md)

A Claude Code plugin marketplace for structured task lifecycle management.

> *"Standing on the moon, looking at Earth"* — [老王来了@dlw2023](https://www.youtube.com/@dlw2023)

## Installation

Add the Moonview marketplace to your preferred agent:

```bash
# For Gemini CLI
gemini plugin add huacheng/moonview

# For Claude Code
claude plugin add huacheng/moonview

# For Codex CLI
codex plugin add huacheng/moonview
```

## Plugins

### task-ai (v0.8.3)

Structured task lifecycle management with **18 skills** for AI-driven development. Git-integrated branch-per-task workflow with project/notebook hierarchy, domain-aware verification, knowledge library, and autonomous execution.

```
/task-ai:<subcommand> [args]
```

## Lifecycle

```
init → target → research(target) → plan → research(test) → verify → check → exec → merge → report
            ↑                ↑         ↑              ↑       ↑       ↑
            └──────────────── research callable at every phase ────────┘
```

Utility commands (available anytime): `auto` · `cancel` · `list` · `annotate` · `summarize` · `library`

### Skills (18)

| Skill | Tier | Description |
|-------|------|-------------|
| `init` | light | Create notebook — directory, git branch, optional worktree |
| `target` | light | **Demand Anchor** — define/review objectives in .target.md |
| `light` | light | **Inline Fix** — lightweight current-branch operation, single commit |
| `read` | medium | **System Immunity** — ingest local docs safely |
| `security` | heavy | **Runtime Guardian** — audit plans and commands |
| `research` | medium | Intelligence officer — target deepening, reference collection, type discovery |
| `plan` | heavy | Generate implementation plan from `.target.md` with domain-adapted methodology |
| `verify` | medium | Run domain-adapted tests, produce result files |
| `check` | heavy | Six-perspective audit at post-plan, mid-exec, post-exec checkpoints |
| `exec` | heavy | Execute plan step-by-step with per-step verification |
| `merge` | medium | Merge task branch to main with conflict resolution (up to 3 retries) |
| `report` | medium | Generate completion report, distill experience to knowledge library |
| `auto` | heavy | Autonomous loop: plan → verify → check → exec → merge → report |
| `cancel` | light | Cancel task, optionally cleanup worktree and branch |
| `list` | light | Query task status, dependency graph, status timeline (read-only) |
| `annotate` | medium | Process Plan panel annotations (Insert/Delete/Replace/Comment) |
| `summarize` | light | Regenerate `.summary.md` for context recovery |
| `library` | light | Knowledge library management (search/list/status/maintain) |

### Status State Machine

```
draft → planning → review → executing → complete
                 ↗            ↘
          re-planning    ←    blocked
```

8 statuses with validated transitions. `light` operates statelessly. Terminal states: `complete`, `cancelled`.

## Quick Start

```bash
# 1. Initialize a notebook under a project
/task-ai:init my-project auth-refactor --title "Refactor auth to JWT"

# 2. Write requirements in .target.md, then let research deepen them
/task-ai:research my-project/auth-refactor --caller target

# 3. Generate plan
/task-ai:plan auth-refactor --generate

# 4. Verify → check plan quality
/task-ai:verify auth-refactor
/task-ai:check auth-refactor --checkpoint post-plan

# 5. Execute the plan
/task-ai:exec auth-refactor

# 6. Merge to main + generate report
/task-ai:merge auth-refactor
/task-ai:report auth-refactor

# Or run the full lifecycle automatically:
/task-ai:auto auth-refactor --start
```

## Features

- **Project hierarchy** — `$NB_WORKSPACES_ROOT/<project>/<notebook>/` two-level organization
- **18 skills** — full lifecycle from init to report, plus utility commands
- **Domain-aware** — 19 seed types (software, science:\*, image-processing, video-production, DSP, literary, screenwriting, mechatronics, chip-design, ...) with auto-discovery and hybrid support (`data-pipeline|ml`)
- **Knowledge library** — `.library/.memory/` with experiences, references, type profiles, and thinking patterns across tasks
- **Git integration** — branch-per-task, worktree isolation for parallel execution, structured commit messages
- **Annotation-driven** — frontend Plan panel annotations processed into plan updates
- **Auto mode** — single-session autonomous orchestration with stall detection, context quota, plugin delegation
- **Six-perspective audit** — check skill evaluates plans and implementations from 6 independent viewpoints
- **Research intelligence** — standalone callable at every phase for domain knowledge, requirement deepening, testing methodology
- **Concurrency protection** — lockfile-based mutual exclusion with 6-priority lock ordering and stale lock recovery

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NB_WORKSPACES_ROOT` | `/home/user/nb-workspaces` | Root directory for all projects and notebooks |
| `NB_WORKSPACES_LIBRARY` | `$NB_WORKSPACES_ROOT/.library` | Shared knowledge library directory |

## Related

- [ai-cli-online](https://github.com/huacheng/ai-cli-online) — Web interface  with Plan annotation panel and Chat editor

## License

MIT
