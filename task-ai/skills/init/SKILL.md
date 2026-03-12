---
name: init
description: "Initialize a new notebook working directory under NB_WORKSPACES_ROOT with system files, git branch, and optional worktree. Use when starting a new feature, bug fix, or refactoring task that needs structured lifecycle tracking."
model_tier: light
auto_delegatable: true
triggers:
  keywords:
    zh: [新任务, 新项目, 初始化, 创建任务, 开新, 建任务]
    en: [new task, new project, initialize, create task, start fresh, set up task]
  phrases:
    zh: [开一个新任务, 建个项目, 初始化一下, 新开一个, 从头开始]
    en: [start a new task, set up a new project, initialize a notebook, create a fresh workspace]
  disambiguate: >
    Core intent: create a brand new task workspace from scratch.
    User wants to START something new (no existing task context) → init.
    User already has a task and wants to define goals → target, not init.
arguments:
  - name: project_name
    description: "Name of the project directory under NB_WORKSPACES_ROOT (e.g., project-a, my-project)"
    required: true
  - name: notebook_name
    description: "Name of the notebook directory to create under the project (e.g., notebook-1, my-research)"
    required: true
  - name: title
    description: "Human-readable title for the task (defaults to notebook_name)"
    required: false
  - name: tags
    description: "Comma-separated tags (e.g., feature,backend,urgent)"
    required: false
  - name: worktree
    description: "Create isolated git worktree for parallel execution (flag, no value)"
    required: false
---

# /task-ai:init — Initialize Notebook Working Directory

Create a new notebook directory under `$NB_WORKSPACES_ROOT/<project>/` with the standard system file structure.

> **Path Rule**: All system files (`.status.json`, `.target.md`, `.plan.md`, etc.) MUST be created in `$TASKAI_WORK_DIR/` (= `$NB_WORK_DIR/.working/`), NOT in `$NB_WORK_DIR/` directly. See `commands/task-ai.md` §System File Path Rule.

## Usage

```
/task-ai:init <project_name> <notebook_name> [--title "Task Title"] [--tags feature,backend] [--worktree]
```

## Directory Structure Created

```
$NB_WORKSPACES_ROOT/
│
├── .library/                          # $NB_WORKSPACES_LIBRARY (initialized on first creation)
│   ├── .changelog                     # Append-only log (empty file, gitignored)
│   ├── .changelog-archive/            # Monthly archive directory (empty on init)
│   ├── .master-index.md               # Flat master index (empty table header, git-tracked)
│   ├── .type-registry.md              # Task type registry (seeded from seed-types)
│   └── .memory/                       # System knowledge base (sub-dirs created by init-lib.sh)
│
└── <project_name>/
    ├── .status.json                    # Project metadata
    └── <notebook_name>/
        ├── .deliverables/              # Non-system output directory (code, configs, assets)
        │                               # Created during exec; merged to <project>/.deliverables/ on main
        ├── .status.json                # Task metadata (JSON) — machine-readable
        └── .target.md                  # Task target / requirements — human-authored
```

## .status.json Format

The `.status.json` file uses JSON as the single source of truth for task state:

```json
{
  "title": "Human-readable task title",
  "type": "",
  "status": "draft",
  "phase": "",
  "completed_steps": 0,
  "created": "2026-01-01T00:00:00Z",
  "updated": "2026-01-01T00:00:00Z",
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

### Status Values

| Status | Description |
|--------|-------------|
| `draft` | Initial state, task target being defined |
| `planning` | Implementation plan being created |
| `review` | Plan complete, awaiting feasibility evaluation |
| `executing` | Implementation in progress |
| `re-planning` | Plan being revised due to issues or objective changes |
| `evolving` | Current stage complete, awaiting next stage definition (multi-stage only) |
| `satisfied` | Task finished and verified |
| `blocked` | Blocked by dependency or unresolved issue |
| `cancelled` | Task abandoned |

### depends_on Format

Dependencies reference other task modules. Two formats — simple string (requires `satisfied`) and extended object (custom minimum status):

```json
"depends_on": [
  "auth-refactor",
  { "module": "api-design", "min_status": "review" }
]
```

## System Files (dot-prefixed)

| File | Purpose | Created by |
|------|---------|-----------|
| `.status.json` | Task metadata, state machine | `init` (always) |
| `.target.md` | Task requirements / objectives | `init` (always) |
| `.analysis/` | Evaluation history (one file per assessment) | `check` (on demand) |
| `.test/` | Test criteria & results (one file per phase) | `plan`/`exec`/`check` (on demand) |
| `.bugfix/` | Issue history (one file per NEEDS_FIX issue, with regression test spec) | `check` (on demand) |
| `.notes/` | Research notes & experience log (one file per entry) | `plan`/`exec` (on demand) |
| `.summary.md` | Condensed context summary | `plan`/`check`/`exec` (on demand) |
| `[deliverables-dir]/.report.md` | Completion report (written to deliverables directory, not notebook directory) | `report` (on demand) |
| `.plan-superseded.md` | Archived plan on re-plan (renamed from `.plan.md`) | `plan` (on re-plan) |

`.plan.md` is the implementation plan, generated by `plan` and editable through the Plan annotation panel.

## Execution Steps

1. **Validate** project_name and notebook_name: both must match `[a-zA-Z0-9_-]+` (ASCII letters, digits, hyphens, underscores), no whitespace, no leading dot, no path separators
2. **Check** `$NB_WORKSPACES_ROOT/` directory exists; create if missing. Check `$NB_WORKSPACES_LIBRARY/` (= `$NB_WORKSPACES_ROOT/.library/`) exists; if missing, create the library skeleton: `.changelog` (empty file), `.changelog-archive/` (empty directory — git won't track it until `maintain --compact` writes the first archive file), `.master-index.md` (empty table header), `.type-registry.md` (initialized from seed types hardcoded in `init-lib.sh` — see `references/seed-types/.summary.md` for the type catalog and `plan/references/type-profiling.md` for registry format), `.memory/` (with sub-directories `.memory/.references/`, `.memory/.experiences/`, `.memory/.type-profiles/`, `.memory/.thinking/raw/`, `.memory/.thinking/patterns/` — created eagerly by `init-lib.sh`). `.plugin-registry.md` is created lazily by the `auto` sub-command on first successful plugin delegation. **Gitignore setup** (idempotent): ensure the following entries exist in `$NB_WORKSPACES_ROOT/.gitignore` (create file if missing; append only missing entries): `.worktrees/`, `**/.auto-stop`, `**/.lock`, `**/.lock.stale.*`, `**/.library-state.json`, `.library/.changelog`, `.library/.changelog-archive/.lock`, `.library/.memory/.thinking/raw/`, `.library/.memory/.thinking/patterns/.lock`, `.library/.inconsistency.log`, `.library/.ioc.md`
3. **Check** `$NB_WORKSPACES_ROOT/<project_name>/` exists; create if missing (with `.status.json`)
4. **Check** `<project>/.worktrees/task-<notebook_name>/` does not already exist; abort with error if it does
5. **Check branch collision**: verify `task/<notebook_name>` branch does not already exist (`git branch --list task/<notebook_name>`). If exists, abort with error suggesting the user delete the old branch or choose a different name
6. **Check working tree clean**: verify no uncommitted changes to tracked files (`git status --porcelain` then filter out `??` untracked entries). Untracked and gitignored files (e.g., `$NB_WORKSPACES_ROOT/` ephemeral files) do NOT block init. If tracked files have modifications, abort with error — branch should be created from a clean state to avoid mixing unrelated changes. User should commit or stash first
7. **Git**: create branch `task/<notebook_name>` from current HEAD
8. **If `--worktree`**: `git worktree add .worktrees/task-<notebook_name> task/<notebook_name>`
9. **If not worktree**: `git checkout task/<notebook_name>`
10. **Create** `.working/` directory under the notebook root. In worktree mode, this is `<project>/.worktrees/task-<notebook_name>/.working/` (NB_WORK_DIR is the notebook root, TASKAI_WORK_DIR is `.working/`)
11. **Create** `$TASKAI_WORK_DIR/.status.json` with JSON:
   - `title`: from `--title` argument or notebook_name
   - `type`: `""` (empty — auto-discovered by `research` during planning)
   - `status`: `draft`
   - `phase`: `""` (empty)
   - `completed_steps`: `0`
   - `created`: current ISO timestamp
   - `updated`: current ISO timestamp
   - `depends_on`: `[]`
   - `tags`: parsed from `--tags` argument or `[]`
   - `branch`: `task/<notebook_name>`
   - `worktree`: `.worktrees/task-<notebook_name>` (or empty if no worktree)
   - `stage`: `{ "current": 1, "history": [] }` (progressive target default)
12. **Create** `$TASKAI_WORK_DIR/.target.md` with default template (task type in `.status.json` is auto-discovered by `research` during planning):
    ```markdown
    # Task Target: <title>

    ## Objective
    <!-- Describe the goal of this task -->

    ## Requirements
    <!-- List specific requirements -->

    ## Constraints
    <!-- Any constraints or limitations -->
    ```
13. **Git commit**: `task-ai(<notebook_name>):init initialize notebook`
14. **Report**: path, files created, branch name, worktree path (if any). Then output next step prompt verbatim: "Notebook initialized. Next: fill in `.target.md` with your objective and requirements, then run `/task-ai:target` to confirm, or directly describe your goal in the conversation."

## Git

- Creates branch: `task/<notebook_name>` from current HEAD
- Without worktree: `git checkout task/<notebook_name>` before creating files
- Optional worktree: `.worktrees/task-<notebook_name>`
- Commit: `task-ai(<notebook_name>):init initialize notebook`

## Notes

- Project names and notebook names are ASCII only: letters, digits, hyphens, underscores (`[a-zA-Z0-9_-]+`). No whitespace, no leading dot, no path separators. Examples: `project-a`, `notebook-1`, `my-research`
- The `.target.md` is for human authoring — users fill in requirements via the Plan annotation panel. The default template (Objective / Requirements / Constraints) is domain-generic; users may freely restructure it for their domain (e.g., Synopsis / Characters for literary tasks). The `plan` skill reads `.target.md` content, not its structure
- System files (dot-prefixed) should not be manually edited except `.target.md`
- After init, the typical workflow is: `/task-ai:target` (define objective) → `/task-ai:plan` → `/task-ai:check` → `/task-ai:exec`
- With `--worktree`, the task runs in an isolated directory; multiple tasks can execute simultaneously
- **Branch collision check**: if `task/<notebook_name>` branch already exists (from a previous cancelled/completed notebook), init aborts. User should delete the old branch first (`git branch -d task/<name>`) or choose a different notebook name
- **Clean working tree**: init requires no uncommitted changes to **tracked** files — untracked/gitignored files are allowed. User should `git commit` or `git stash` tracked changes first
