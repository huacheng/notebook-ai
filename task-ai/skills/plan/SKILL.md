---
name: plan
description: "Generate step-by-step implementation plans with verification criteria. Use when the user asks 'how should we do this', 'make a plan', 'break this down into steps', 'what's the approach', or needs a roadmap before implementation."
model_tier: heavy
auto_delegatable: false
triggers:
  keywords:
    zh: [计划, 方案, 规划, 实现步骤, 怎么做, 出方案, 拆步骤]
    en: [plan, approach, implementation steps, how to implement, design plan, break down]
  phrases:
    zh: [出个计划, 制定方案, 怎么实现, 拆成步骤, 做个规划, 重新规划, 换个方案]
    en: [generate a plan, make an implementation plan, how should we implement this, break it into steps, replan]
  disambiguate: >
    Core intent: generate or regenerate an actionable implementation plan (.plan.md).
    User asks HOW to implement something → plan.
    User asks WHAT to implement → target. User asks to INVESTIGATE options → research.
arguments:
  - name: --generate
    description: "Generate or regenerate the implementation plan (flag, no value). Default behavior when invoked — the flag exists for explicitness in auto mode commands"
    required: false
  - name: --refine
    description: "Append a refinement to existing plan (used by agent during plan-refinement phase). Requires a quoted string value, e.g., --refine \"description\""
    required: false

---

# /task-ai:plan — Plan Generation

Generate an implementation plan from `.target.md`. Annotation processing is handled by the `annotate` sub-command.

> **Path Rule**: All system files (`.status.json`, `.target.md`, `.plan.md`, etc.) are in `$TASKAI_WORK_DIR/` (= `$NB_WORK_DIR/.working/`), NOT in `$NB_WORK_DIR/` directly. See `commands/task-ai.md` §System File Path Rule.

## Usage

```bash
# Generate mode: create/regenerate plan
/task-ai:plan [--generate]

# Refine mode: append refinement (agent calls this during conversation)
/task-ai:plan --refine "Add caching layer between API and database"
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

`--generate` is the default behavior — the flag exists for explicitness when invoked from auto mode or scripts. Omitting it has the same effect.

## Plan Refinement

After plan generation, the agent monitors conversation for plan refinements:

1. **After generation**: The agent reads `.status.json` to confirm `status: planning`
2. **During conversation**: If user refines the plan, agent calls `/task-ai:plan --refine "content"`
3. **When ready**: User proceeds to `/task-ai:exec`

The agent maintains phase awareness via `.status.json` (see Phase Awareness Protocol in `commands/task-ai.md`).

## Execution Steps

1. Read `.target.md` for requirements. **Stage awareness**: read `.status.json` `stage` field (default `{ current: 1, history: [] }` if missing). If `stage.current > 1` (multi-stage mode):
   - Only read the current `[ACTIVE]` stage's Objective/Requirements/Constraints from `.target.md` — plan scope is limited to the current stage
   - Also read prior `[COMPLETE]` stages' `### Results` sections as context (already-implemented capabilities)
   - Library context loading (steps 10-12) naturally includes prior-stage experience files distilled by highlight
   - If `stage.current == 1`: read entire `.target.md` as before (backward compatible)
   - **BLOCKING CHECK**: If `.target.md` has no objective items with `[CONFIRMED]` or `[PROCESSED]` markers AND no `## Stage` sections exist, REJECT with error: "Cannot generate plan — no confirmed objectives. Run `/task-ai:target` to confirm at least one objective item first." (Plan only covers `[CONFIRMED]` items; unconfirmed items are excluded from scope)
2. **Read `.convergence-baseline.md`** from `.working/` directory for requirement coverage mapping. This file contains numbered requirements (R1, R2, ...) extracted by `target` from the convergence baseline:
   - If `.convergence-baseline.md` exists → parse the R# requirement list for use in plan step annotation (step 16)
   - If `.convergence-baseline.md` does not exist → warn ("convergence baseline not found — skipping R# coverage mapping") and continue. This is backward compatible — older targets may not have generated it
3. **Invoke research** (which handles type discovery): Delegate reference collection AND type determination to the `research` sub-command. **Invocation method**: in auto mode, Read `skills/research/SKILL.md` and execute its numbered steps inline. In manual/standalone mode, use Skill tool to invoke `/task-ai:research`. See `skills/research/SKILL.md` and `references/type-profiling.md` for details:
   - **First plan** (status `draft`/`planning`, no existing `.plan.md`):
     - Check if `.target.md` contains `## Research Insights` section (indicates `research --caller target` was already run)
     - **If `## Research Insights` present**: invoke research with `--scope gap --caller plan` — target research already provided comprehensive coverage, only fill plan-specific gaps
     - **If no `## Research Insights`**: invoke research with `--scope full --caller plan` — full collection (backward compatible, works when user skips target research)
   - **Re-plan** (status `re-planning`/`review`/`executing`): invoke research with `--scope gap --caller plan` — incremental type refinement and reference collection
4. **Read** `.type-profile.md` — research has created or updated this. Verify the type classification makes sense in context. If plan disagrees with research's classification, update `.type-profile.md` with rationale and adjust `type` in `.status.json`
5. Validate type value: each pipe-separated segment matches `[a-zA-Z0-9_:-]+`, full field matches `^[a-zA-Z0-9_:-]+(\|[a-zA-Z0-9_:-]+)*$` (no leading/trailing/consecutive pipes). Ensure `type` in `.status.json` is set
6. Read `.summary.md` if exists (condensed context from prior runs — primary context source)
7. Read `.analysis/` latest file only if exists (address check feedback from NEEDS_REVISION)
8. Read `.bugfix/` latest file only if exists (address most recent issue from mid-exec or post-exec REPLAN)
9. Read `.test/` latest criteria and results files if exists (incorporate lessons learned)
10. **Load library context** via Changelog Consumption Protocol (`commands/references/changelog-consumption-protocol.md`)
11. Read `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/.summary.md` if exists — condensed cross-task experience from completed tasks of the same domain type (apply directory-safe transform: `:` → `-` in type for directory name, e.g., `science:astro` → `science-astro`). For hybrid types (`A|B`), read summary files for **all** pipe-separated segments. If summary references specific entries relevant to current task, read those `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<module>.md` files for detail
    - **Adoption tracking**: When incorporating a lesson or pattern from an experience entry into the plan, record the source in `.plan.md` under `## Adopted Experiences` (append if section exists). Format: `- <lesson summary> ← .experiences/<type>/<source-file>.md`. This enables downstream adoption tracking by highlight and report
12. **Library search**: invoke `/task-ai:library search "<keywords>"` with domain keywords from `.target.md` and `.type-profile.md`. Library search handles index reading, keyword matching, and relevance scoring internally — read matched files (Layer 3) for domain knowledge needed during planning
13. Read project codebase for context (relevant files, CLAUDE.md conventions)
14. Read `.notes/` latest file only if exists (prior research findings and experience)
15. **If re-planning** (status is `re-planning` or `review`/`executing` transitioning to re-plan): archive existing `.plan.md` — rename to `.plan-superseded.md` (append numeric suffix if already exists, e.g., `.plan-superseded-2.md`). This prevents `exec` from reading outdated steps alongside the new plan
16. Generate implementation plan using **domain-appropriate methodology** (incorporating check feedback, bugfix history, prior notes, cross-task experience, and researched best practices)
    - **R# coverage annotation**: If `.convergence-baseline.md` was loaded in step 2, annotate each plan step with a `Covers: R#, R#` line indicating which baseline requirements that step addresses. Example:
      ```markdown
      ## Step 3: Implement JWT middleware
      Covers: R1, R5
      - Verify token signatures...
      - Rate limiting logic...
      ```
    - **R# coverage validation**: After annotating all plan steps, scan all `Covers:` lines and cross-check against the full R# list from `.convergence-baseline.md`. If any R# is not covered by any step → add warning in plan notes section: "Uncovered requirements: R3, R7 — verify these are intentionally deferred or covered implicitly". This is a soft check (warning, not blocking) — the hard check is done by `check --checkpoint post-plan`
    - **Re-plan regression check**: When re-planning due to check NEEDS_REVISION, read the latest `.analysis/` file's findings. After generating the new plan, verify each finding is addressed: for each issue flagged by check, confirm the new `.plan.md` contains the corrective content (contract test: grep for expected content). Log unaddressed findings as warnings in the step 28 report
    - **Optional delegation — brainstorm**: On first plan generation (no existing `.plan.md`), follow `auto/references/plugin-delegation.md` to attempt matching the `brainstorm` capability slot. If matched, invoke via Task subagent — exploration results serve as supplementary planning input. No match or failure → continue normally
17. Write plan to `.plan.md` in the task module
18. Write `.test/<YYYY-MM-DD>-plan-criteria.md` with **domain-appropriate** verification criteria: acceptance criteria from `.target.md` + per-step test cases using methods standard in the task domain. On re-plan, write `.test/<YYYY-MM-DD>-replan-criteria.md` incorporating lessons from previous `.test/` results files
19. **Verification baseline generation**: Generate a RED baseline appropriate to the task type, ensuring each plan step has a verifiable test before implementation begins:
    - **software types** (`type` contains `software`): Generate executable failing VH stubs:
      - Extract each plan step's verification points from the criteria file written in step 18
      - Generate `<workspace>/.test/<YYYY-MM-DD>-vh-stubs.test.*` (language/framework determined by `.type-profile.md` or project conventions)
      - Each stub contains: test description, assertion placeholder, expected failure marker `// VH: not implemented`
      - Run the VH stubs once to confirm **all fail** (VH baseline state)
      - Write `.test/<YYYY-MM-DD>-vh-baseline.md` recording: total VH stubs count, per-step stub mapping, run output confirming all failures
      - In `.plan.md`, annotate each implementation step with its corresponding VH stub references (e.g., `[VH: test-auth-login, test-auth-logout]`)
      - If any stub unexpectedly passes → log warning in baseline file ("stub X passed without implementation — test may be trivially satisfied, review assertion strength")
    - **non-software types**: Generate a contract test baseline using the domain-appropriate test approach from `commands/references/test-strategy-by-type.md` Strategy Matrix:
      - Extract key verification points from each plan step
      - Write `.test/<YYYY-MM-DD>-contract-baseline.md` with per-step verification specs: test approach (content validation, schema check, link check, etc.), RED assertion (what fails before implementation), GREEN expectation (what passes after)
      - In `.plan.md`, annotate each implementation step with its verification method (e.g., `[Contract: schema-validate, link-check]`)
      - This ensures `exec` has a concrete RED→GREEN pathway for every step, regardless of task type
20. **Update** `.test/.summary.md` — overwrite with condensed summary of ALL criteria & results files in `.test/`
21. Create `.notes/<YYYY-MM-DD>-<summary>-plan.md` with research findings and key decisions
22. **Update** `.notes/.summary.md` — overwrite with condensed summary of ALL notes files in `.notes/`
23. Write task-level `.summary.md` with condensed context: plan overview, key decisions, requirements summary, known constraints (integrate from directory summaries)
24. **MANDATORY STATUS UPDATE** — Use Edit tool to update `.status.json` (atomic write required):
    - Read current `.status.json`
    - Set `"status"`: `"planning"` (from `draft`/`planning`/`blocked`) or `"re-planning"` (from `review`/`executing`/`re-planning`)
    - Set `"phase"`: `"needs-check"` if new status is `re-planning`, otherwise `""`
    - Set `"completed_steps"`: `0` (new plan invalidates prior progress)
    - Set `"type"` field if not already set
    - Update `"updated"` timestamp to current ISO-8601
    - Write back with Edit tool
    - **VERIFY**: After write, read `.status.json` again to confirm `status` field changed. If still `draft`, the update FAILED — retry or abort
    - **Update `.target.md`**: for each objective item with `[CONFIRMED]` that is covered by the plan, change marker to `[PROCESSED]`
25. Execute highlight protocol scope=thinking-raw — see `skills/highlight/SKILL.md` §3.3. Optional, encouraged (high-value). Capture design and trade-off reasoning. Inline call failure should not block plan's main flow — highlight is enhancement, not gating
26. **L1 Six-Dimension Self-Audit** — scan `.plan.md` against `.target.md` and `.convergence-baseline.md` using the unified six-dimension checklist (`references/self-audit-checklist.md`). For each dimension (D1 Correctness → D6 Maintainability), check 2-4 items and fix issues in-place:
    - Read `.plan.md`, `.target.md`, `.convergence-baseline.md` (if exists), `.type-profile.md` (if exists)
    - D1 Correctness: requirements coverage, acceptance criteria mapping, input/output consistency
    - D2 Security: security-sensitive step identification, input validation coverage
    - D3 Reliability: dependency explicitness, failure fallback, inter-step coupling
    - D4 Performance: redundant steps, step granularity
    - D5 Architecture: module boundaries, incremental delivery, separation of concerns
    - D6 Maintainability: step executability, terminology consistency, test traceability
    - **Weight adjustment**: read `.type-profile.md` to shift emphasis (e.g., `software` → Security↑ Reliability↑, `infrastructure` → Security↑↑ Reliability↑↑). Full weight table in `references/self-audit-checklist.md` section 2
    - If issues found → fix in `.plan.md` with regression verification:
      - For each non-exempt fix (per `commands/references/test-strategy-by-type.md` exemptions), verify the fix using a contract test: grep/regex confirming the corrected content is present and the defective content is absent. This is the "Spec text" test approach from the Strategy Matrix
      - Exempt fixes (pure typo ≤3 chars, comment-only) may skip individual verification
      - No `.analysis/` files — that is check's responsibility
    - If no issues → skip, proceed to step 27
    - **Non-fatal**: if self-audit fails (exception/timeout), skip and proceed to step 27. Log "Self-audit: skipped (error)" for step 28 report
27. **Git commit**: `task-ai(<notebook>):plan generate implementation plan`
28. Report plan summary to user. Include self-audit summary: "Self-audit: N issues found and corrected" or "Self-audit: clean" or "Self-audit: skipped (error)". Include R# coverage summary if convergence baseline was loaded: "R# coverage: N/M requirements mapped (uncovered: R3, R7)" or "R# coverage: all M requirements mapped". Then output next step prompt verbatim: "Plan generated. Next: `/task-ai:check --checkpoint post-plan` to review the plan (runs verify automatically)."

**Context management (plan)**: When `.summary.md` exists, read it as the primary context source for plan generation instead of reading all files from `.analysis/`, `.bugfix/`, `.notes/`. Only read the latest file from each directory for the most recent assessment/issue/note. See also `skills/exec/SKILL.md` for the equivalent exec-phase context rule.

## State Transitions

| Current Status | After Plan | Condition |
|----------------|-----------|-----------|
| `draft` | `planning` | First plan generation |
| `planning` | `planning` | Plan revision |
| `review` | `re-planning` | Revisions after assessment |
| `executing` | `re-planning` | Mid-execution re-plan |
| `re-planning` | `re-planning` | Further revisions |
| `blocked` | `planning` | Unblocking changes |
| `satisfied` | REJECT | Use /target to re-enter first |
| `evolving` | REJECT | Use /target to define next stage first |
| `cancelled` | REJECT | Cancelled tasks cannot be re-planned |

## Git

```
task-ai(<notebook>):plan generate implementation plan
```

## Task-Type-Aware Planning

Plan methodology adapts to the task domain — a software task needs test-first steps while a documentation task needs outline-first structure. Different domains require different step granularity and verification approaches.

> **See `skills/init/references/seed-types/<type>.md`** for per-type seed methodology (plan structure, key considerations). Shared profiles in `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/` take precedence when available.

## Notes

- All plan research should consider the full context of the task module (read `.target.md` and `.plan.md`)
- When researching implementation plans, use the project codebase as context (read relevant project files)
- **Evidence-based decisions**: Primary domain research is handled by the `research` sub-command (step 3). For plan-specific decisions, use shell commands to verify claims (curl docs/APIs, npm info, etc.) rather than relying solely on internal knowledge
- **Concurrency**: Plan acquires `.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/task-ai.md`). Reference writing is handled by the `research` sub-command (which manages its own `.memory/.references/.lock`)
- **Task-type-aware test design**: `.test/` criteria must use domain-appropriate verification methods (e.g., unit tests for code, SSIM/PSNR for image processing, SNR for audio/DSP, schema validation for data pipelines). Research established best practices for the task domain before writing test criteria. See `commands/references/test-strategy-by-type.md` for the full domain test strategy reference
- **Convergence baseline R# mapping**: Plan steps should annotate `Covers: R#` to map to convergence baseline requirements when `.convergence-baseline.md` is present. This enables check to verify requirement coverage at post-plan and track convergence at post-exec. The mapping is advisory (soft warning for gaps) — the hard coverage check is performed by `check --checkpoint post-plan`
- **Regression test in plan**: Plan's primary role is to DESIGN tests (step 18-19), not execute the full RED→GREEN cycle (that is exec's job per `commands/references/test-strategy-by-type.md` Phase Responsibilities). However, plan's L1 self-audit (step 26) and re-plan regression check (step 16) both apply fixes to `.plan.md` — these must include contract-test verification per the Regression Test Protocol. Step 19 generates the RED baseline that exec will use for RED→GREEN
