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
            └──────────────── research 可在任意阶段独立调用 ─────────────────────┘
```

辅助命令（随时可用）: `highlight` · `read` · `security` · `auto` · `cancel` · `list` · `annotate` · `summarize` · `library`

> **research** acts as the **intelligence officer** — the only sub-command callable at every phase independently. See [research standalone invocation examples](#research--intelligence-collection-) below.

---

## Shared Context

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NB_WORKSPACES_ROOT` | `/home/user/nb-workspaces` | 工作区根目录，存放所有 notebook 和全局索引 |
| `NB_WORKSPACES_LIBRARY` | `$NB_WORKSPACES_ROOT/.library` | 共享图书馆目录，存放跨任务知识资产 |

所有子命令在解析路径时，优先读取这两个环境变量。若未设置，使用默认值。

### Directory Convention

> **See `commands/references/directory-convention.md`** for the full directory tree (`$NB_WORKSPACES_ROOT/`, `.library/`, `<project>/<notebook>/.working/`), file naming conventions, and path resolution rules.

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

Notes: `worktree` is empty string `""` if not using worktree. `depends_on` entries can be simple strings (require `complete`) or objects `{ "module": "...", "min_status": "..." }`.

#### Stage Field (Progressive Evolution)

The `stage` field tracks progressive task evolution. Default: `{ "current": 1, "history": [] }`. There is no `total` — stages are emergent, not predefined.

| Sub-field | Type | Description |
|-----------|------|-------------|
| `stage.current` | integer | Current stage number (1-based, only increases) |
| `stage.history` | array | Records of completed stages |
| `stage.history[].stage` | integer | Stage number |
| `stage.history[].name` | string | Stage name/description |
| `stage.history[].completed_at` | string | ISO 8601 completion timestamp |

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
| `satisfied` | User temporarily satisfied (non-terminal, can re-enter) | `planning`, `cancelled` |
| `blocked` | Blocked by dependency/issue | `planning`, `cancelled` |
| `cancelled` | Abandoned (via `cancel`) | — (terminal) |

> **See `commands/references/state-matrix.md`** for the complete state × command matrix with all (state, sub-command) combinations and verification properties.

Terminal states: only `cancelled`.

### Phase Awareness Protocol

`.status.json` is the single source of truth for task phase information. The agent maintains phase awareness through two mechanisms:

1. **Change sensing**: Each skill modifies `.status.json` on completion. The agent re-reads `.status.json` after each `/task-ai:` command to load current `status`, `stage`, and `phase` values.

2. **Compression recovery**: After Claude Code triggers context compression, the agent MUST re-read `.status.json` to restore phase information lost during compression.

**Non-notebook context**: If `.status.json` does not exist (CWD is not inside `.working/` and not on a `task/` branch), the agent does not attempt phase-aware behavior — no research/refine calls, no status checks. Falls back to normal conversation mode.

No `.session-context` file is used. Phase awareness is derived entirely from `.status.json`.

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

#### .auto-signal Convention

Every sub-command that participates in the automation loop (plan, check, exec, merge, report, research, verify, annotate) MUST write `.auto-signal` on completion, regardless of whether auto mode is active. Utility sub-commands (list, summarize) do NOT write `.auto-signal`:

```json
{
  "step": "<sub-command>",
  "result": "<outcome>",
  "next": "<next sub-command or (stop)>",
  "checkpoint": "<checkpoint hint for next command, optional>",
  "timestamp": "<ISO 8601>"
}
```

- The `next` field follows the signal routing table documented in the `auto` sub-command.
- The `checkpoint` field provides context for the next command (e.g., `"post-plan"`, `"mid-exec"`, `"post-exec"`) when the `next` command needs it. Optional — omit when not applicable. If auto mode is not active, the file is harmless (gitignored, ephemeral). This fire-and-forget pattern avoids each skill needing to detect auto mode.

**Result value format convention**: The `result` field uses two distinct formats depending on the skill's role:

| Format | Used By | Examples | Rationale |
|--------|---------|---------|-----------|
| `UPPERCASE` | `check` (judgment skills) | `PASS`, `ACCEPT`, `NEEDS_FIX`, `REPLAN`, `BLOCKED` | Verdicts that drive state transitions — emphasized as formal decisions |
| `(lowercase)` | `plan`, `exec`, `verify`, `research`, `report`, `annotate` (action skills) | `(generated)`, `(done)`, `(pass)`, `(collected)`, `(processed)` | Outcomes wrapped in parentheses — informational status without state-changing authority |
| `lowercase` | `merge` (git operations) | `success`, `conflict`, `rejected` | Git-style bare results — merge outcomes are self-descriptive |

The auto daemon's signal validation whitelist (see `auto/SKILL.md`) accepts all three formats. New skills SHOULD follow this convention: judgment → UPPERCASE, action → (lowercase), git → lowercase.
- **Atomic write**: `.auto-signal` MUST be written atomically — write to `.auto-signal.tmp` first, then `rename` to `.auto-signal`. POSIX `rename` is atomic, preventing the daemon from reading partially written JSON.

**Worktree note**: In worktree mode, `.auto-signal` MUST be written to the **main worktree's** `$NB_WORKSPACES_ROOT/<project>/<notebook>/.working/` directory (not the task worktree copy) to survive worktree removal during merge cleanup.

### Computation Rule

**No mental math.** When ANY sub-command involves numerical reasoning — performance estimates, size calculations, capacity limits, threshold comparisons, algorithm parameters, benchmarks, option evaluation — write a script and run it in shell instead of computing mentally. Scripts produce verifiable, reproducible results.

---

## Input Validation

All sub-commands auto-detect the notebook from context. Detection priority (first match wins):

1. **CWD-based**: Walk up from CWD to find `.working/.status.json` — extract notebook and project from the directory path
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

Sub-commands that modify task module files MUST acquire `.working/.lock` (O_CREAT | O_EXCL). Shared library directories have directory-level locks. Global lock ordering (priority 1-6) prevents deadlocks.

> **See `commands/references/concurrency.md`** for full lock protocol, stale-lock recovery, shared directory write protection table, `.changelog.lock`, and lock ordering convention.

### .status.json Safety

**Atomic write**: All sub-commands that modify `.status.json` MUST write atomically — write to `.status.json.tmp` first, then `rename` to `.status.json`. POSIX `rename` is atomic, preventing concurrent readers from seeing partially written JSON.

**Corruption recovery**: If `.status.json` fails to parse (malformed JSON):

1. **Git recovery**: `git show HEAD:<project>/<notebook>/.working/.status.json` — restore from latest committed version
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

### 生命周期命令（按阶段顺序）

| 命令 | 角色 | 说明 |
|------|------|------|
| `init` | 初始化 | 创建任务模块、分支、目标模板 |
| `target` | 目标定义 | 定义/评审任务目标与需求 (`.target.md`) |
| `research` ★ | **情报收集** | 全阶段情报官，独立可调（见下方专节） |
| `plan` | 规划 | 生成实施计划 |
| `verify` | 验证 | 执行测试，产出结果文件 |
| `check` | 评估 | 六视角审计，渲染裁决 |
| `exec` | 执行 | 逐步实施计划 |
| `merge` | 合并 | 任务分支合并到主干 |
| `report` | 报告 | 生成完成报告，提炼经验 |

### 自动化命令

| 命令 | 说明 |
|------|------|
| `auto` | 单会话自主执行完整生命周期 |

### 管理命令

| 命令 | 说明 |
|------|------|
| `highlight` | 经验蒸馏引擎（综合蒸馏、对话经验捕获） |
| `cancel` | 取消任务 |
| `list` | 查询任务状态与依赖 |
| `annotate` | 处理 Plan 面板批注 |
| `summarize` | 重建 .summary.md 上下文摘要 |
| `library` | 知识库管理（search / list / status / maintain） |

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
├── SKILL.md                # Core logic: steps, state transitions, signals, git
└── references/             # On-demand reference material (loaded when needed)
    └── *.md                # Domain guidelines, annotation processing, audit frameworks, etc.
```

Per-type seed methodology files are centralized in `skills/init/references/seed-types/` (one file per type, with `.summary.md` index). Each per-type file contains Phase Intelligence for all 4 lifecycle phases (plan/verify/check/exec), structured to mirror `.type-profile.md`.

**Main SKILL.md** contains the workflow: prerequisites, execution steps, state transitions, git conventions, `.auto-signal` definitions, and notes. It should be self-sufficient for understanding the sub-command's behavior.

**references/** contains large reference tables and domain-specific details that are only needed in specific situations. The main SKILL.md references these files with `See references/<file>.md` directives — the agent reads them on demand when the context requires it.

18 sub-commands: `init`, `target`, `highlight`, `plan`, `research`, `read`, `security`, `check`, `verify`, `exec`, `merge`, `report`, `auto`, `cancel`, `list`, `annotate`, `summarize`, `library`. Each skill's SKILL.md frontmatter contains the authoritative description, arguments, model tier, and delegation flag. Read `skills/<name>/SKILL.md` for full details.
