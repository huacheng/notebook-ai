# Concurrency Protection

## Task Module Lock Protocol

Without worktree mode, only one task should be actively operated at a time. Sub-commands that modify task module files (`plan`, `exec`, `check`, `merge`, `research`, `annotate`, `cancel`) MUST check for an active lockfile (`$TASKAI_WORK_DIR/.lock`) before proceeding:

1. **Acquire**: Attempt to create `$TASKAI_WORK_DIR/.lock` with `O_CREAT | O_EXCL` (atomic create-if-not-exists). Write `{ session, pid, timestamp }` to identify the holder
2. **If lock exists**: Read lock content, check if holding process is still alive (kill -0). If dead → remove stale lock and retry. If alive → REJECT with error identifying the holding session. No retry — the caller (user or auto) decides whether to retry
3. **Release**: Delete `$TASKAI_WORK_DIR/.lock` on sub-command completion (including error paths)
4. **Worktree mode**: Lock not required — each worktree has its own copy of `$TASKAI_WORK_DIR/` files
5. **Stale lock recovery**: Use rename-based recovery instead of delete+create. When detecting a stale lock (holder dead): `rename` the stale `$TASKAI_WORK_DIR/.lock` to `$TASKAI_WORK_DIR/.lock.stale.<pid>`, then acquire normally with `O_CREAT | O_EXCL`. If the rename fails (another process already recovered), retry from step 1. Clean up ALL `.lock.stale.*` files in the same directory immediately after successful lock acquisition

## Shared Directory Write Protection

Three shared directories require locks before writing (all use the same lock protocol as module locks above):

| Directory | Lock File | Writers | Scope |
|-----------|-----------|---------|-------|
| `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/` | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/.lock` | `highlight`, `exec`, `verify`, `check` | Create type dir, write `<notebook>-{complete\|impl\|verify\|eval}.md`, update per-type `.index.md`. For hybrid types (`A\|B`), covers all segments |
| `$NB_WORKSPACES_LIBRARY/.memory/.references/` | `$NB_WORKSPACES_LIBRARY/.memory/.references/.lock` | `research`, `exec`, `check` | Write `<topic>.md`, update `.index.md` and `.summary.md`; `check` updates `failure_count` on REPLAN |
| `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/` | `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/.lock` | `research`, `highlight` | Write `<type>.md` shared profiles |

Additionally, `$NB_WORKSPACES_LIBRARY/.changelog.lock` is held briefly by any library writer during the write protocol (step 4 — single-line append). See Lock Ordering Convention below for the full lock list and acquisition order.

## VFP File Pattern Lock Coverage

The following VFP (Verification-First Protocol) file patterns reside under `$TASKAI_WORK_DIR` and are protected by the task module lock (`$TASKAI_WORK_DIR/.lock`). No additional locks are needed — the task module lock provides exclusive access:

| VFP Pattern | Location | Writers | Purpose |
|-------------|----------|---------|---------|
| `vh-stubs.*` | `$TASKAI_WORK_DIR/vh-stubs.*` | `plan` | VH stub files generated during planning |
| `vh-baseline.md` | `$TASKAI_WORK_DIR/vh-baseline.md` | `plan` | Initial VH failure state baseline |
| `cumulative-green.jsonl` | `$TASKAI_WORK_DIR/.test/<date>-cumulative-green.jsonl` | `exec` | CGG cumulative pass records (append) |
| `hil-snapshots/` | `$TASKAI_WORK_DIR/.test/hil-snapshots/` | `exec` | HIL approval snapshot artifacts |
| `vfp_cycles_completed` | In-memory (auto session) | `auto`, `exec` | VFP cycle counter tracked in-memory |

All VFP files are scoped to a single notebook's `.working/` directory. Since the task module lock already serializes all sub-command access to `.working/`, these files inherit that protection automatically.

## Lock Ordering Convention

When a sub-command acquires multiple locks within a single operation, it MUST acquire them in the following order to prevent deadlocks:

| Priority | Lock | Typical Holders |
|----------|------|-----------------|
| 1 (first) | `$TASKAI_WORK_DIR/.lock` (task module) | plan, exec, check, merge, research, annotate, cancel |
| 2 | `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/.lock` | research, highlight |
| 3 | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/.lock` | highlight, exec, verify, check |
| 4 | `$NB_WORKSPACES_LIBRARY/.memory/.references/.lock` | research, exec, check |
| 5 | `$NB_WORKSPACES_LIBRARY/.memory/.thinking/patterns/.lock` | highlight |
| 6 (last) | `$NB_WORKSPACES_LIBRARY/.changelog.lock` | Any library writer (brief hold) |

**Rules:**
- Always acquire in ascending priority order (lower number first)
- Always release in reverse order (higher number first)
- Never hold a lower-priority lock while attempting to acquire a higher-priority one
- `$NB_WORKSPACES_LIBRARY/.changelog.lock` is always the innermost lock (acquired last, released first) — its hold duration is a single-line append

**Example**: `highlight` needs `$TASKAI_WORK_DIR/.lock` (1), `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/.lock` (2), and `$NB_WORKSPACES_LIBRARY/.memory/.experiences/.lock` (3). Preferred order: acquire 1 → 2 → 3, release 3 → 2 → 1 (strictly monotonic). If highlight must process experiences before type profiles, it may acquire 1 → 3, release 3, then acquire 2 — valid because 3 is fully released before 2 is acquired. Always prefer the strictly monotonic order when the processing sequence allows it.
