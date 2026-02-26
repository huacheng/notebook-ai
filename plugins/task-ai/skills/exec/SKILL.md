---
name: exec
description: "Execute the implementation plan for a reviewed task module. Triggered after check PASS (from review status) or on NEEDS_FIX continuation (from executing status with fix guidance)."
model_tier: heavy
auto_delegatable: false
arguments:
  - name: notebook
    description: "Notebook name (e.g., auth-refactor)"
    required: false
  - name: step
    description: "Execute a specific step number (optional, executes all if omitted)"
    required: false
---

# /task-ai:exec — Execute Implementation Plan

Execute the implementation plan for a task module that has passed evaluation.

## Usage

```
/task-ai:exec <notebook_name> [--step N]
```

## Prerequisites

- Task module must have status `review` (post-plan check passed) or `executing` (NEEDS_FIX continuation)
- `.target.md` and at least one plan file must exist
- `.analysis/` should contain a PASS evaluation file (warning if empty/missing)
- **Dependency gate**: All `depends_on` modules must meet their required status — simple string entries require `complete`, extended `{ module, min_status }` entries require at-or-past `min_status` (see depends_on Format in `commands/task-ai.md`). If any dependency is not met, exec REJECTS with error listing blocking dependencies and their current statuses

## Execution Strategy

### Step Discovery

1. **Read** the plan file `.plan.md` in the task module
2. **Read** `.target.md` for requirements context
3. **Read** `.type-profile.md` if exists — "Implementation Patterns" and "Key tools" sections are the **primary** source for tool selection and implementation approach (see `plan/references/type-profiling.md` for type system details). If execution reveals the profile's patterns are inaccurate, update the relevant sections with findings
4. **Read** `.summary.md` if exists (condensed context from prior plan/check/exec runs — primary context source)
5. **Read** `.test/` latest criteria file for per-step verification criteria and acceptance standards
6. **Read** `.analysis/` latest file only for evaluation notes and approved approach
7. **Read** `.bugfix/` latest file only if exists for most recent issue and fix guidance
8. **Read** `.notes/` latest file only if exists for most recent research findings
9. **Load library context** via Changelog Consumption Protocol (`commands/references/changelog-consumption-protocol.md`)
10. **Scan** `$NB_WORKSPACES_LIBRARY/.memory/.references/.summary.md` if exists — find relevant external reference files by keyword matching. Read matched `.memory/.references/<topic>.md` files for domain-specific implementation guidance
11. **Gap check**: if `.type-profile.md` lacks implementation guidance OR `.references/` lacks knowledge for the current step's technologies/APIs, trigger `research --scope gap --caller exec` to collect missing references before proceeding
12. **Extract** implementation steps from `.plan.md` (ordered by heading structure)
13. **Build** execution order respecting any noted dependencies

**Context management (exec)**: When `.summary.md` exists, read it as the primary context source for implementation instead of reading all files from `.analysis/`, `.bugfix/`, `.notes/`. Only read the latest file from each directory for the most recent assessment/issue/note. See also `plan/SKILL.md` for the equivalent plan-phase context rule.

### Per-Step Execution

Read the `type` field from `.index.json` to determine the task domain. Execution strategy MUST adapt to the task type — different domains use fundamentally different tools, verification methods, and workflows.

For each implementation step:

1. **Read** relevant files (source code, configs, scripts, documentation)
2. **VH confirmation** (VFP-applicable types with VH stubs): If (`type` contains `software` OR `.type-profile.md` contains `## Verification Cycle`) AND `.test/<date>-vh-stubs.test.*` exists (with vh-baseline.md confirming initial failure state), run **only** the tests corresponding to the current step (identified by the `[Red: ...]` annotations in `.plan.md`) before implementing:
   - **Expected: all Red (failing)** → proceed to implementation
   - **Unexpected: any Green (passing)** → log warning in `.notes/`: "Step N: test X was Green before implementation — test may be trivially satisfied or implementation leaked from a prior step". Continue implementation but flag for review
3. **Implement** the change using **domain-appropriate methods** as described in the plan (see `init/references/seed-types/<type>.md` for per-type seed methodology, or `.type-profile.md` for task-specific guidance)
   - **Security Audit (Pre-hook)**: Before issuing any shell command that modifies state (file deletion, system config, package installation, network requests), MUST invoke `/task-ai:security <notebook> verify-cmd "<command>"`. If verdict is `REJECT`, execution is halted immediately, signal `(mid-exec)`, state becomes `NEEDS_FIX`, and trigger lineage tracing to invalidate the source reference.
   - **Optional delegation — capability check**: Before implementing, follow `auto/references/plugin-delegation.md` to check if the current step matches a capability slot: `type` containing `frontend`/`web`/`ui` → `frontend-design` slot; `type` containing `bugfix` or NEEDS_FIX resumption → `debugging` slot; `type` containing `software` with `.test/` criteria → `tdd` slot; otherwise → `domain-*` semantic scan. If matched, invoke via Task subagent — guidance is incorporated into the implementation approach. No match or failure → use existing inline methods
4. **HS confirmation** (VFP-applicable types with VH stubs): After implementing, run the same step-specific tests:
   - **All Green (passing)** → record successful VH→HS transition, proceed
   - **Still Red (failing)** → mark step as `NEEDS_FIX`, record failure details (which tests still fail and why). If minor, attempt a targeted fix and re-run. If unresolvable, signal `(mid-exec)` for check evaluation
5. **Cumulative Green Gate (CGG)** (VFP-applicable types, after HS confirmation): Run all previously-passed VH stubs (step-1..N-1) to confirm no regressions. Append results to `.test/<date>-cumulative-green.jsonl`. For human VH types, store approval snapshots in `.test/hil-snapshots/`. On regression → fix (≤1 attempt) → re-run; still failing → signal `(mid-exec)`. Skip if step=1 or no VH stubs exist
6. **Refactor window** (VFP-applicable types, after HS confirmation): With tests passing, check for obvious refactoring opportunities in the code just written (duplication, naming, dead code). If refactored, run the **full** test suite (not just step tests) to confirm no regressions. Skip if the step was straightforward with no refactoring opportunities
7. **Verify** the step succeeded against `.test/` criteria using **domain-appropriate verification** (see per-type seed file or `.type-profile.md` for domain verification methods)
8. **Record** what was done (files changed, commands run, tools invoked, approach taken)
9. **Create** `.notes/<YYYY-MM-DD>-<summary>-exec.md` when implementation deviates from plan, an unexpected workaround is needed, or a non-obvious API behavior is discovered. Skip for straightforward steps that follow the plan exactly. For software types, include a **VFP Cycle Summary** section per step: `Red (N failing) → Green (N passing) → Refactor (yes/no)`
10. **Update** `.notes/.summary.md` — overwrite with condensed summary of ALL notes files in `.notes/`

### Issue Handling

| Situation | Action |
|-----------|--------|
| Step succeeds | Record in progress log, continue |
| Minor deviation needed | Adjust and document, continue |
| Significant issue | Stop execution, signal `(mid-exec)`. Interactive: suggest `check --checkpoint mid-exec`. Auto: daemon routes to mid-exec evaluation |
| Blocking dependency | Set status to `blocked`, report which dependency |

## Execution Steps

1. **Read** `.index.json` — validate status is `review` or `executing`
2. **Validate dependencies**: read `depends_on` from `.index.json`, check each dependency module's `.index.json` status against its required level (simple string → `complete`, extended object → at-or-past `min_status`). If any dependency is not met, REJECT with error listing blocking dependencies
3. **Update** `.index.json` status to `executing`, clear `phase` to `""`, update timestamp
4. **Discover** all implementation steps from `.plan.md`
5. **Detect completed steps**: read `completed_steps` field from `.index.json` to determine progress; skip steps ≤ `completed_steps`
6. **If NEEDS_FIX resumption**: determine fix source by reading **both** `.bugfix/` and `.analysis/` latest files, using the most recent file (by filename date) as the primary fix guidance. `.bugfix/` entries indicate mid-exec issues; `.analysis/` entries indicate post-exec issues. Address fix items before continuing remaining steps
7. **If** `--step N` specified, execute only that step; otherwise execute remaining incomplete steps in order
8. **For each step** (follow Per-Step Execution flow above):
   8.1. Read required files
   8.2. **VH confirmation** — run step-specific VH stubs (software types only, see Per-Step step 2)
   8.3. Implement the change
   8.4. **HS confirmation** — run step-specific tests, confirm VH→HS transition (software types only, see Per-Step step 4)
   8.5. **Cumulative Green Gate** — run all prior VH stubs, append to `cumulative-green.jsonl`, store `hil-snapshots/` if applicable (software types only, see Per-Step step 5)
   8.6. **Refactor window** — check for refactoring opportunities, run full suite to confirm no regressions (software types only, see Per-Step step 6)
   8.7. Verify against `.test/` criteria (diagnostics / build check). For domain-specific testing, can optionally invoke `verify --checkpoint step-N`
   8.8. Record result (include VFP cycle summary for software types)
   8.9. Update `.index.json` `completed_steps` to current step number
9. **After all steps** (or on failure):
   - Update `.index.json` timestamp
   - Write task-level `.summary.md` with condensed context: current progress, steps completed, key decisions, issues encountered, remaining work (integrate from directory summaries)
   - If all steps complete: write `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<notebook>-impl.md` with implementation decisions, tool patterns, and workarounds discovered — `quality_status: provisional`. Follow six-step Library Write Protocol (see `skills/library/SKILL.md`): acquire `.memory/.experiences/.lock` → O_APPEND with `---` separator (create file if not exists) → append `experience` changelog line → update `.memory/.experiences/<type>/.index.md` row → release lock
   - If all steps complete: signal `{ "step": "exec", "result": "(done)", "next": "verify", "checkpoint": "post-exec", "timestamp": "..." }`
   - If significant issue: signal `{ "step": "exec", "result": "(mid-exec)", "next": "verify", "checkpoint": "mid-exec", "timestamp": "..." }`
   - If `--step N` single step complete (manual invocation only — auto mode does not use `--step`): signal `{ "step": "exec", "result": "(step-N)", "next": "verify", "checkpoint": "mid-exec", "timestamp": "..." }`
   - If blocking dependency: signal `{ "step": "exec", "result": "(blocked)", "next": "(stop)", "checkpoint": "dependency-blocked", "timestamp": "..." }`
10. **Report** execution summary with per-step results

## State Transitions

| Current Status | After Exec | Condition |
|----------------|-----------|-----------|
| `review` | `executing` | Execution starts |
| `executing` | `executing` | NEEDS_FIX continuation (fix issues, stay executing) |
| `executing` | `blocked` | Blocking dependency encountered |

## Progress Tracking

Execution progress is tracked via `.index.json` fields:
- `completed_steps`: integer, incremented after each step completes successfully. Reset to `0` when plan changes (by `plan` sub-command on re-plan). **Validation**: must be integer >= 0. If value is invalid (negative, non-integer), reset to 0 with warning
- `updated`: timestamp of last execution activity

For long-running executions, intermediate progress can be observed by:
- Reading `completed_steps` in `.index.json`
- Reading `.summary.md` for condensed context
- Checking git diff for code changes made so far

## Git

- On start: `task-ai(<notebook>):exec execution started`
- Project files (feature): `task-ai(<notebook>):feat <description>`
- Project files (bugfix): `task-ai(<notebook>):fix <description>`
- Per step progress: `task-ai(<notebook>):exec step N/M done`
- On blocked: `task-ai(<notebook>):exec blocked`
- Project file changes use `feat`/`fix` type, state file changes use `exec` type

## .auto-signal

| Result | Signal |
|--------|--------|
| All steps done | `{ "step": "exec", "result": "(done)", "next": "verify", "checkpoint": "post-exec", "timestamp": "..." }` |
| Significant issue | `{ "step": "exec", "result": "(mid-exec)", "next": "verify", "checkpoint": "mid-exec", "timestamp": "..." }` |
| Single step (--step N) | `{ "step": "exec", "result": "(step-N)", "next": "verify", "checkpoint": "mid-exec", "timestamp": "..." }` |
| Blocking dependency | `{ "step": "exec", "result": "(blocked)", "next": "(stop)", "checkpoint": "dependency-blocked", "timestamp": "..." }` |

## Notes

- Each step should be atomic — if a step fails, previous steps remain applied
- The executor should follow project coding conventions (check CLAUDE.md if present)
- When status is `executing` (NEEDS_FIX), exec reads both `.bugfix/` and `.analysis/` latest files, using the most recent by filename date as fix guidance (`.bugfix/` = mid-exec source, `.analysis/` = post-exec source)
- When `--step N` is used, the executor verifies prerequisites for that step are met, then signals `(step-N)` on completion for mid-exec checkpoint
- After successful execution of all steps, the user should run `/task-ai:check --checkpoint post-exec`
- Per-step verification against `.test/` criteria is done during execution; full test suite / acceptance testing is part of the post-exec evaluation by `check`
- **VFP protocol reference**: The Verification-First Protocol (VH confirmation, HS confirmation, Cumulative Green Gate, Refactor window) is defined in `commands/references/verification-first-protocol.md`. Refer to that document for full VFP applicability rules, VH stub design patterns, and CGG thresholds
- **Evidence-based decisions**: When uncertain about APIs, library usage, or compatibility, use shell commands to verify (curl official docs, check installed versions, read node_modules source, etc.) before implementing
- **Experience invalidation**: If implementation reveals that a previously loaded experience file (`<notebook>-impl.md`, `-verify.md`, or `-eval.md`) provided guidance that contradicts actual runtime behavior (e.g., documented API signature doesn't match, performance claim is wrong), set `quality_status: invalidated` on that file — acquire `.memory/.experiences/.lock` → update frontmatter → write atomically (`.tmp → rename`) → append `experience` changelog line with tag `quality_status:invalidated` → release lock
- **Concurrency**: Exec acquires `.working/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/task-ai.md`)
- **Reference collection**: Primary reference collection is handled by the `research` sub-command before planning. During execution, if you discover valuable implementation details via web searches, you may still save findings to `$NB_WORKSPACES_LIBRARY/.memory/.references/` — follow the full six-step Library Write Protocol (see `skills/library/SKILL.md`): acquire `.memory/.references/.lock` → sanitize content (ten categories, `references/injection-rules.md`) → apply source classification (`references/blocked-sources.md`) → write atomically → append `reference` changelog line → update `.memory/.references/.index.md` → release lock
- **verify integration**: Per-step verification can optionally invoke `verify --checkpoint step-N` for domain-specific testing. For lightweight checks (build + lint), inline verification is sufficient
- **Auto-mode safety boundaries**: When exec runs within `auto` mode (unattended), the following operations are PROHIBITED unless the plan explicitly calls for them: modifying `.env` or credential files, running destructive commands (`rm -rf`, `git push --force`, `DROP TABLE`), installing system-level packages (`apt install`, `brew install`), sending external requests (email, webhook, API calls to production). Violation → stop execution and signal `(mid-exec)` for human review
