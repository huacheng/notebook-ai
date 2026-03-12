---
description: "Structured task lifecycle management with 18 skills for AI-driven development. Use when tasks need structured planning, domain-aware verification, and tracked execution through $NB_WORKSPACES_ROOT/ directory workflow. Sub-commands: init, target, highlight, plan, research, read, security, check, verify, exec, merge, report, auto, cancel, list, annotate, summarize, library."
arguments:
  - name: subcommand
    description: "Sub-command: init, target, highlight, plan, research, read, security, check, verify, exec, merge, report, auto, cancel, list, annotate, summarize, library"
    required: true
  - name: args
    description: "Sub-command arguments (varies by sub-command)"
    required: false
---

# /task-ai:task-ai — Task Lifecycle Management

Single entry point for task lifecycle management in the `$NB_WORKSPACES_ROOT/` directory.

## Arguments

{{ARGUMENTS}}

## Lifecycle Overview

```
init → target → research(target) → plan → research(test) → verify → check → exec → merge → report
            ↑                ↑         ↑              ↑       ↑       ↑
            └──────────────── research can be invoked independently at any phase ───────────────┘
```

Auxiliary commands (available anytime): `highlight` · `read` · `security` · `auto` · `cancel` · `list` · `annotate` · `summarize` · `library`

> **research** acts as the **intelligence officer** — the only sub-command callable at every phase independently. See [research standalone invocation examples](#research--intelligence-collection-) below.

---

## Shared Context

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NB_WORKSPACES_ROOT` | `/home/user/nb-workspaces` | Workspace root directory, stores all notebooks and global indexes |
| `NB_WORKSPACES_LIBRARY` | `$NB_WORKSPACES_ROOT/.library` | Shared library directory, stores cross-task knowledge assets |

All sub-commands read these two environment variables first when resolving paths. If not set, default values are used.

### Directory Convention

> **See `commands/references/directory-convention.md`** for the full directory tree (`$NB_WORKSPACES_ROOT/`, `.library/`, `<project>/.worktrees/task-<notebook>/`), file naming conventions, and path resolution rules.

### System File Path Rule (CRITICAL)

**All task-ai system files MUST be in `$TASKAI_WORK_DIR/` (= `$NB_WORK_DIR/.working/`), NOT in `$NB_WORK_DIR/` directly.**

```
$NB_WORK_DIR/                         ← notebook 根目录 (worktree)
├── .deliverables/                    ← 产出目录 (在 .working/ 外)
└── .working/                         ← $TASKAI_WORK_DIR — 系统文件目录
    ├── .status.json                  ✓ 正确位置
    ├── .target.md                    ✓ 正确位置
    ├── .convergence-baseline.md      ✓ 正确位置
    ├── .plan.md                      ✓ 正确位置
    ├── .summary.md                   ✓ 正确位置
    ├── .type-profile.md              ✓ 正确位置
    ├── .analysis/                    ✓ 正确位置
    ├── .test/                        ✓ 正确位置
    ├── .bugfix/                      ✓ 正确位置
    └── .notes/                       ✓ 正确位置
```

**错误示例**（直接放在 worktree 根目录）:
```
$NB_WORK_DIR/.status.json             ✗ 错误！
$NB_WORK_DIR/.target.md               ✗ 错误！
```

**正确示例**:
```
$TASKAI_WORK_DIR/.status.json         ✓ 即 $NB_WORK_DIR/.working/.status.json
$TASKAI_WORK_DIR/.target.md           ✓ 即 $NB_WORK_DIR/.working/.target.md
```

When SKILL.md mentions `.status.json`, `.target.md`, `.plan.md`, etc. without explicit path, it ALWAYS means `$TASKAI_WORK_DIR/<file>`, NEVER `$NB_WORK_DIR/<file>`.

### .summary.md Format

`.summary.md` is overwritten (not appended) on each write. Recommended structure:

```markdown
# Task Summary: <title>

**Status**: <status> | **Phase**: <phase> | **Progress**: <completed_steps>/<total_steps>

## Plan Overview
<!-- 3-5 sentence summary of the implementation approach -->

## Current State
<!-- What was last done, what's next -->

## Key Decisions
<!-- Important architectural/design decisions made so far -->

## Known Issues
<!-- Active issues, blockers, or risks -->

## Lessons Learned
<!-- Patterns, workarounds, or discoveries from execution -->
```

Writers should keep `.summary.md` under ~200 lines. It is a context window optimization — not a full record (that's `.report.md`).

### Global Directory .summary.md Format

`.memory/.experiences/.summary.md` and `.memory/.references/.summary.md` serve as keyword indexes for fast file discovery. Skills read the relevant `.summary.md` first, match keywords, then drill into matched files.

> **See `commands/references/summary-formats.md`** for the detailed table formats (experiences index, per-type summaries, references index) and filename conventions.

### .status.json Schema

```json
{
  "title": "Human-readable task title",
  "type": "",
  "status": "draft",
  "phase": "",
  "completed_steps": 0,
  "created": "2024-01-01T00:00:00Z",
  "updated": "2024-01-01T00:00:00Z",
  "depends_on": [],
  "tags": [],
  "branch": "task/notebook-name",
  "worktree": ".worktrees/task-notebook-name",
  "stage": {
    "current": 1,
    "history": []
  }
}
```

Notes: `worktree` is empty string `""` if not using worktree. `depends_on` entries can be simple strings (require `satisfied`) or objects `{ "module": "...", "min_status": "..." }`.

#### Stage Field (Progressive Evolution)

The `stage` field tracks progressive task evolution. Default: `{ "current": 1, "history": [] }`. There is no `total` — stages are emergent, not predefined.

| Sub-field | Type | Description |
|-----------|------|-------------|
| `stage.current` | integer | Current stage number (1-based, only increases) |
| `stage.history` | array | Records of completed stages |
| `stage.history[].stage` | integer | Stage number |
| `stage.history[].name` | string | Stage name/description |
| `stage.history[].completed_at` | string | ISO 8601 completion timestamp |
| `stage.history[].commit` | string | Git commit SHA at stage completion (set by merge) |
| `stage.history[].convergence` | number | Convergence score at completion (0.0–1.0) |

**Validation Rules**: `stage.current >= 1`. If violated, treat as corrupted — log warning and fall back to `{ "current": 1, "history": [] }`.

**Default handling**: If `.status.json` lacks the `stage` field, all commands MUST treat it as `{ "current": 1, "history": [] }`.

**Hard upgrade (v2)**: Old `stage.total` and `stage.completed` fields are not recognized. Old `.status.json` files must be manually migrated (`completed` → `history`, remove `total`) or re-initialized.

#### Type Field

The `type` field identifies the task's domain, **auto-discovered** by `research` during planning. Format: single (`software`) or pipe-separated hybrid (`data-pipeline|ml`).

> **See `commands/references/type-field.md`** for format spec, auto-discovery, registry, hybrid types, validation rules, and directory-safe transform.

#### Phase Field

The `phase` field disambiguates sub-states within a status, primarily for `re-planning` auto recovery:

| Status | Phase | Meaning | Auto Entry Action |
|--------|-------|---------|-------------------|
| `re-planning` | `needs-plan` | check REPLAN set status, plan hasn't run yet | `plan --generate` |
| `re-planning` | `needs-check` | plan regenerated, ready for assessment | `verify` → `check --checkpoint post-plan` |
| (other) | `""` (empty) | No sub-state needed | Status-based routing |

Writers: `check` sets `phase: needs-plan` on REPLAN and on NEEDS_REVISION when status is `re-planning`. `plan` sets `phase: needs-check` when completing on `re-planning` status. `annotate` sets `phase: needs-check` when the new status is `re-planning` (same rule as `plan`). All other transitions clear `phase` to `""`.

### Status State Machine

| Status | Description | Transitions To |
|--------|-------------|----------------|
| `draft` | Task target being defined | `planning`, `cancelled` |
| `planning` | Plan being researched | `review`, `blocked`, `cancelled` |
| `review` | Plan passed assessment | `executing`, `re-planning`, `cancelled` |
| `executing` | Implementation in progress | `evolving`, `re-planning`, `blocked`, `cancelled` |
| `re-planning` | Plan being revised | `review`, `blocked`, `cancelled` |
| `evolving` | Current stage complete, ready for next evolution | `planning`, `satisfied`, `cancelled` |
| `satisfied` | User temporarily satisfied (non-terminal, can re-enter) | `evolving`, `planning`, `cancelled` |
| `blocked` | Blocked by dependency/issue | `planning`, `cancelled` |
| `cancelled` | Abandoned (via `cancel`) | — (terminal) |

> **See `commands/references/state-matrix.md`** for the complete state × command matrix with all (state, sub-command) combinations and verification properties.

Terminal states: only `cancelled`.

### Phase Awareness Protocol

`.status.json` is the single source of truth for task phase information. The agent maintains phase awareness through two mechanisms:

1. **Change sensing**: Each skill modifies `.status.json` on completion. The agent re-reads `.status.json` after each `/task-ai:` command to load current `status`, `stage`, and `phase` values.

2. **Compression recovery**: After Claude Code triggers context compression, the agent MUST re-read `.status.json` to restore phase information lost during compression.

**Non-notebook context**: If `.status.json` does not exist (CWD is not a notebook directory and not on a `task/` branch), the agent does not attempt phase-aware behavior — no research/refine calls, no status checks. Falls back to normal conversation mode.

### Retry-Safe Design

All skill scripts are designed to be **retry-safe** (non-atomic): if a script fails midway, re-running it produces the correct result without corruption. Status transitions occur after file writes, so partial failures leave the task in the pre-transition state. Idempotent file writes (overwrite, not append) ensure repeated runs converge.

### Annotation Format (for `annotate` sub-command)

> **See `commands/references/annotation-format.md`** for the JSONL prompt format — four annotation types (Insert/Delete/Replace/Comment) with rendered-text context positioning.

### depends_on Format

Simple string `"module"` → requires `satisfied`. Extended object `{ "module", "min_status" }` → requires at-or-past that status. `exec`/`merge` MUST validate before proceeding; `check` flags unmet as BLOCKED.

> **See `commands/references/depends-on-format.md`** for full format specification, status progression order, and enforcement rules.

### Git Integration

Every task has a dedicated branch (`task/<notebook-name>`) with optional worktree. Commits follow `task-ai(<module>):<type> <description>` format.

> **See `commands/references/git-details.md`** for branch convention, commit message format table, commit examples, worktree execution, rollback, and `.gitignore` entries.

### Computation Rule

**No mental math.** When ANY sub-command involves numerical reasoning — performance estimates, size calculations, capacity limits, threshold comparisons, algorithm parameters, benchmarks, option evaluation — write a script and run it in shell instead of computing mentally. Scripts produce verifiable, reproducible results.

---

## Input Validation

All sub-commands auto-detect the notebook from context. Detection priority (first match wins):

1. **CWD-based**: Walk up from CWD to find `.status.json` — extract notebook and project from the directory path
2. **Branch-based**: If CWD detection fails, read current git branch. If it matches `task/<notebook>`, resolve the notebook directory from `$NB_WORKSPACES_ROOT`
3. **Neither**: REJECT with error "No active task context detected. Enter a notebook directory or switch to a task branch."

The resolved `<project>` and `<notebook>` paths MUST be validated before processing:

| Check | Rule | Example |
|-------|------|---------|
| **Path containment** | Resolved path must be under `$NB_WORKSPACES_ROOT/` directory (no `..` traversal) | `$NB_WORKSPACES_ROOT/../etc/passwd` → REJECT |
| **Project name** | Must match `[a-zA-Z0-9_-]+` (ASCII letters/digits/hyphens/underscores only) | `project-a` ✓, `../foo` ✗ |
| **Notebook name** | Must match `[a-zA-Z0-9_-]+` (ASCII letters/digits/hyphens/underscores only) | `notebook-1` ✓, `../../foo` ✗ |
| **No symlinks** | Task module directory must not be a symlink (prevent symlink-based escape) | REJECT if `lstat` ≠ `stat` |
| **Existence** | Directory must exist (except for `init` which creates it) | REJECT if missing |
| **User text sanitization** | All user-provided text written to `.status.json` or `.md` files (e.g., `--title`, `--reason`, `--tags`) must be sanitized: strip HTML comments (`<!-- ... -->`), ANSI escape sequences, and control characters (except `\n`). This prevents hidden content injection when values appear in `.summary.md` or other markdown files | Sanitize before write |

Validation is performed by resolving the absolute path and confirming it starts with the `$NB_WORKSPACES_ROOT/` prefix (resolved from the environment variable). This prevents path traversal attacks where a crafted project or notebook name could read/write files outside the workspace directory.

### Concurrency Protection

Sub-commands that modify task module files MUST acquire `.lock` (O_CREAT | O_EXCL). Shared library directories have directory-level locks. Global lock ordering (priority 1-6) prevents deadlocks.

> **See `commands/references/concurrency.md`** for full lock protocol, stale-lock recovery, shared directory write protection table, `.changelog.lock`, and lock ordering convention.

### .status.json Safety

**Atomic write**: All sub-commands that modify `.status.json` MUST write atomically — write to `.status.json.tmp` first, then `rename` to `.status.json`. POSIX `rename` is atomic, preventing concurrent readers from seeing partially written JSON.

**Corruption recovery**: If `.status.json` fails to parse (malformed JSON):

1. **Git recovery**: `git show HEAD:<project>/.worktrees/task-<notebook>/.working/.status.json` — restore from latest committed version
2. **If git recovery fails**: Reconstruct minimal `.status.json` with `"status": "draft"`, `"phase": ""`, preserve only what's parseable
3. **Log**: Record corruption event and recovery action in `.analysis/<date>-index-recovery.md`

### Plugin Delegation (Extension Point)

Lifecycle skills can discover and delegate to system-installed external plugins at runtime, following the protocol in `auto/references/plugin-delegation.md`. Capability slots include: `doc-parse`, `brainstorm`, `code-review`, `frontend-design`, `debugging`, `tdd`, and `domain-*` (open-ended). Delegation executes through Task subagent isolation — the main context receives only a <=500 char summary. All delegation is optional: when no matching plugin is found, skills fall back to their existing inline logic. Discovered capabilities are cached in `$NB_WORKSPACES_LIBRARY/.plugin-registry.md` for faster future matching.

### Model Routing (Extension Point)

Sub-commands have different cognitive demands. Each SKILL.md frontmatter declares `model_tier` (heavy/medium/light) and `auto_delegatable` (true/false) to enable the auto loop to dispatch lighter sub-commands to cheaper/faster model tiers via Task subagent.

> **See `commands/references/model-routing.md`** for tier definitions, the full routing table for all 18 skills, and the auto mode delegation protocol.

---

## Sub-commands

> Each sub-command's core logic is in `skills/<name>/SKILL.md`. Reference material is in `skills/<name>/references/` and loaded on demand.

### Lifecycle Commands (in phase order)

| Command | Role | Description |
|---------|------|-------------|
| `init` | Initialize | Create task module, branch, target template |
| `target` | Target Definition | Define/review task objective and requirements (`.target.md`) |
| `research` ★ | **Intelligence Collection** | Cross-phase intelligence officer, independently callable (see section below) |
| `plan` | Planning | Generate implementation plan |
| `verify` | Verification | Execute tests, produce result files |
| `check` | Assessment | Six-perspective audit, render verdict |
| `exec` | Execution | Implement plan step by step |
| `merge` | Merge | Merge task branch to main |
| `report` | Report | Generate completion report, distill lessons |

### Automation Commands

| Command | Description |
|---------|-------------|
| `auto` | Single-session autonomous execution of full lifecycle |

### Management Commands

| Command | Description |
|---------|-------------|
| `highlight` | Experience distillation engine (synthesis distillation, conversation experience capture) |
| `cancel` | Cancel task |
| `list` | Query task status and dependencies |
| `annotate` | Process Plan panel annotations |
| `summarize` | Rebuild .summary.md context summary |
| `library` | Knowledge base management (search / list / status / maintain) |

### research — Intelligence Collection ★

`research` is the only sub-command independently callable at **every** lifecycle phase.
It acts as the task's intelligence officer — proactively gathering domain knowledge,
deepening requirements, or building testing methodology before each phase.

#### Standalone Invocation Examples

```bash
# ── Target Deepening (two phases, human confirmation between) ──
# Phase 1: Research domain standards → propose refined Objective
/task-ai:research <module> --caller target --phase objective

# Phase 2: Based on confirmed Objective → propose missing Requirements
/task-ai:research <module> --caller target --phase requirements

# ── Plan Support ──
# Full collection before plan (when target research was skipped)
/task-ai:research <module> --caller plan --scope full

# Gap-only collection (supplementing existing references)
/task-ai:research <module> --caller plan --scope gap

# ── Test Intelligence ──
# Testing methodology (call before plan, when status=planning)
/task-ai:research <module> --caller test

# Testing tools + benchmarks (call before verify, when status=executing)
/task-ai:research <module> --caller test

# ── Mid-execution Supplement ──
# Encountered unknown technology during exec
/task-ai:research <module> --caller exec --scope gap
```

#### Caller Quick Reference

| `--caller` | `--phase` | Typical Timing | Primary Output | `next` |
|-----------|---------|----------------|----------------|--------|
| `target` | `objective` | After writing `.target.md` draft | Proposed Objective Refinement in `.target.md` | `(stop)` |
| `target` | `requirements` | After confirming Objective | Proposed Requirements in `.target.md` | `plan` |
| `plan` | — | Before or during plan | `.references/<topic>.md` | `plan` |
| `test` | — | Before plan (planning) or verify (executing) | `.test/<date>-research-*.md` | `plan`/`verify` |
| `verify` | — | Inside verify (gap detection) | `.references/testing-<type>.md` | `verify` |
| `check` | — | Inside check (gap detection) | `.references/<domain-standards>.md` | `check` |
| `exec` | — | Inside exec (unknown tech) | `.references/<impl-detail>.md` | `exec` |

### Skill File Structure

```
skills/<name>/
├── SKILL.md                # Core logic: steps, state transitions, git conventions
└── references/             # On-demand reference material (loaded when needed)
    └── *.md                # Domain guidelines, annotation processing, audit frameworks, etc.
```

Per-type seed methodology files are centralized in `skills/init/references/seed-types/` (one file per type, with `.summary.md` index). Each per-type file contains Phase Intelligence for all 4 lifecycle phases (plan/verify/check/exec), structured to mirror `.type-profile.md`.

**Main SKILL.md** contains the workflow: prerequisites, execution steps, state transitions, git conventions, and notes. It should be self-sufficient for understanding the sub-command's behavior.

**references/** contains large reference tables and domain-specific details that are only needed in specific situations. The main SKILL.md references these files with `See references/<file>.md` directives — the agent reads them on demand when the context requires it.

18 sub-commands: `init`, `target`, `highlight`, `plan`, `research`, `read`, `security`, `check`, `verify`, `exec`, `merge`, `report`, `auto`, `cancel`, `list`, `annotate`, `summarize`, `library`. Each skill's SKILL.md frontmatter contains the authoritative description, arguments, model tier, and delegation flag. Read `skills/<name>/SKILL.md` for full details.
