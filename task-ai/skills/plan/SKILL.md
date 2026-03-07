---
name: plan
description: "Generate implementation plans for a task module. Triggered after init when .target.md requirements are defined, or on re-plan when check/exec identify issues requiring plan revision."
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

## Usage

```bash
# Generate mode: create/regenerate plan
/task-ai:plan [--generate]

# Refine mode: append refinement (agent calls this during conversation)
/task-ai:plan --refine "Add caching layer between API and database"
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.working/.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

`--generate` is the default behavior — the flag exists for explicitness when invoked from auto mode or scripts. Omitting it has the same effect.

## Plan Refinement

After plan generation, the agent monitors conversation for plan refinements:

1. **After generation**: The agent reads `.status.json` to confirm `status: planning`
2. **During conversation**: If user refines the plan, agent calls `/task-ai:plan --refine "content"`
3. **When ready**: User proceeds to `/task-ai:exec`

The agent maintains phase awareness via `.status.json` (see Phase Awareness Protocol in `commands/task-ai.md`). No `.session-context` file is used.

## Execution Steps

1. Read `.target.md` for requirements. **Stage awareness**: read `.status.json` `stage` field (default `{ current: 1, history: [] }` if missing). If `stage.current > 1` (multi-stage mode):
   - Only read the current `[ACTIVE]` stage's Objective/Requirements/Constraints from `.target.md` — plan scope is limited to the current stage
   - Also read prior `[COMPLETE]` stages' `### Results` sections as context (already-implemented capabilities)
   - Library context loading (steps 9-11) naturally includes prior-stage experience files distilled by highlight
   - If `stage.current == 1`: read entire `.target.md` as before (backward compatible)
2. **Invoke research** (which handles type discovery): Delegate reference collection AND type determination to the `research` sub-command. **Invocation method**: in auto mode, Read `skills/research/SKILL.md` and execute its numbered steps inline (skipping its `.auto-signal` write — auto loop handles it). In manual/standalone mode, use Skill tool to invoke `/task-ai:research`. See `skills/research/SKILL.md` and `references/type-profiling.md` for details:
   - **First plan** (status `draft`/`planning`, no existing `.plan.md`):
     - Check if `.target.md` contains `## Research Insights` section (indicates `research --caller target` was already run)
     - **If `## Research Insights` present**: invoke research with `--scope gap --caller plan` — target research already provided comprehensive coverage, only fill plan-specific gaps
     - **If no `## Research Insights`**: invoke research with `--scope full --caller plan` — full collection (backward compatible, works when user skips target research)
   - **Re-plan** (status `re-planning`/`review`/`executing`): invoke research with `--scope gap --caller plan` — incremental type refinement and reference collection
3. **Read** `.type-profile.md` — research has created or updated this. Verify the type classification makes sense in context. If plan disagrees with research's classification, update `.type-profile.md` with rationale and adjust `type` in `.status.json`
4. Validate type value: each pipe-separated segment matches `[a-zA-Z0-9_:-]+`, full field matches `^[a-zA-Z0-9_:-]+(\|[a-zA-Z0-9_:-]+)*$` (no leading/trailing/consecutive pipes). Ensure `type` in `.status.json` is set
5. Read `.summary.md` if exists (condensed context from prior runs — primary context source)
6. Read `.analysis/` latest file only if exists (address check feedback from NEEDS_REVISION)
7. Read `.bugfix/` latest file only if exists (address most recent issue from mid-exec or post-exec REPLAN)
8. Read `.test/` latest criteria and results files if exists (incorporate lessons learned)
9. **Load library context** via Changelog Consumption Protocol (`commands/references/changelog-consumption-protocol.md`)
10. Read `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/.summary.md` if exists — condensed cross-task experience from completed tasks of the same domain type (apply directory-safe transform: `:` → `-` in type for directory name, e.g., `science:astro` → `science-astro`). For hybrid types (`A|B`), read summary files for **all** pipe-separated segments. If summary references specific entries relevant to current task, read those `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<module>.md` files for detail
    - **Adoption tracking**: When incorporating a lesson or pattern from an experience entry into the plan, record the source in `.plan.md` under `## Adopted Experiences` (append if section exists). Format: `- <lesson summary> ← .experiences/<type>/<source-file>.md`. This enables downstream adoption tracking by highlight and report
11. **Read** `$NB_WORKSPACES_LIBRARY/.memory/.references/.summary.md` if exists — find relevant external reference files by keyword matching against task requirements. Read matched `.memory/.references/<topic>.md` files for domain knowledge
12. Read project codebase for context (relevant files, CLAUDE.md conventions)
13. Read `.notes/` latest file only if exists (prior research findings and experience)
14. **If re-planning** (status is `re-planning` or `review`/`executing` transitioning to re-plan): archive existing `.plan.md` — rename to `.plan-superseded.md` (append numeric suffix if already exists, e.g., `.plan-superseded-2.md`). This prevents `exec` from reading outdated steps alongside the new plan
15. Generate implementation plan using **domain-appropriate methodology** (incorporating check feedback, bugfix history, prior notes, cross-task experience, and researched best practices)
    - **Re-plan regression check**: When re-planning due to check NEEDS_REVISION, read the latest `.analysis/` file's findings. After generating the new plan, verify each finding is addressed: for each issue flagged by check, confirm the new `.plan.md` contains the corrective content (contract test: grep for expected content). Log unaddressed findings as warnings in the step 28 report
    - **Optional delegation — brainstorm**: On first plan generation (no existing `.plan.md`), follow `auto/references/plugin-delegation.md` to attempt matching the `brainstorm` capability slot. If matched, invoke via Task subagent — exploration results serve as supplementary planning input. No match or failure → continue normally
16. Write plan to `.plan.md` in the task module
17. Write `.test/<YYYY-MM-DD>-plan-criteria.md` with **domain-appropriate** verification criteria: acceptance criteria from `.target.md` + per-step test cases using methods standard in the task domain. On re-plan, write `.test/<YYYY-MM-DD>-replan-criteria.md` incorporating lessons from previous `.test/` results files
18. **Verification baseline generation**: Generate a RED baseline appropriate to the task type, ensuring each plan step has a verifiable test before implementation begins:
    - **software types** (`type` contains `software`): Generate executable failing VH stubs:
      - Extract each plan step's verification points from the criteria file written in step 17
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
19. **Update** `.test/.summary.md` — overwrite with condensed summary of ALL criteria & results files in `.test/`
20. Create `.notes/<YYYY-MM-DD>-<summary>-plan.md` with research findings and key decisions
21. **Update** `.notes/.summary.md` — overwrite with condensed summary of ALL notes files in `.notes/`
22. Write task-level `.summary.md` with condensed context: plan overview, key decisions, requirements summary, known constraints (integrate from directory summaries)
23. Update `.status.json`: set `type` field (if not already set or if task nature changed), status → `planning` (from `draft`/`planning`/`blocked`) or `re-planning` (from `review`/`executing`/`re-planning`), update timestamp. If the **new** status is `re-planning`, set `phase: needs-check`. For all other **new** statuses, clear `phase` to `""`. Reset `completed_steps` to `0` (new/revised plan invalidates prior progress)
24. Execute highlight protocol scope=thinking-raw — see `skills/highlight/SKILL.md` §3.3. Optional, encouraged (high-value). Capture design and trade-off reasoning. Inline call failure MUST NOT block plan's main flow
25. **L1 Six-Dimension Self-Audit** — scan `.plan.md` against `.target.md` using the unified six-dimension checklist (`references/self-audit-checklist.md`). For each dimension (D1 Correctness → D6 Maintainability), check 2-4 items and fix issues in-place:
    - Read `.plan.md`, `.target.md`, `.type-profile.md` (if exists)
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
    - If no issues → skip, proceed to step 26
    - **Non-fatal**: if self-audit fails (exception/timeout), skip and proceed to step 26. Log "Self-audit: skipped (error)" for step 28 report
26. **Git commit**: `task-ai(<notebook>):plan generate implementation plan`
27. **Write** `.auto-signal`: `{ "step": "plan", "result": "(generated)", "next": "verify", "checkpoint": "post-plan", "timestamp": "..." }`
28. Report plan summary to user. Include self-audit summary: "Self-audit: N issues found and corrected" or "Self-audit: clean" or "Self-audit: skipped (error)". Then output next step prompt verbatim: "Plan generated. Next: `/task-ai:check --checkpoint post-plan` to review the plan (runs verify automatically)."

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

## .auto-signal

| Result | Signal |
|--------|--------|
| Generated | `{ "step": "plan", "result": "(generated)", "next": "verify", "checkpoint": "post-plan", "timestamp": "..." }` |

## Task-Type-Aware Planning

Plan methodology MUST adapt to the task domain. Different domains require different design approaches, tool choices, and milestones.

> **See `skills/init/references/seed-types/<type>.md`** for per-type seed methodology (plan structure, key considerations). Shared profiles in `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/` take precedence when available.

## Notes

- All plan research should consider the full context of the task module (read `.target.md` and `.plan.md`)
- When researching implementation plans, use the project codebase as context (read relevant project files)
- **Evidence-based decisions**: Primary domain research is handled by the `research` sub-command (step 2). For plan-specific decisions, use shell commands to verify claims (curl docs/APIs, npm info, etc.) rather than relying solely on internal knowledge
- **Concurrency**: Plan acquires `.working/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/task-ai.md`). Reference writing is handled by the `research` sub-command (which manages its own `.memory/.references/.lock`)
- **Task-type-aware test design**: `.test/` criteria must use domain-appropriate verification methods (e.g., unit tests for code, SSIM/PSNR for image processing, SNR for audio/DSP, schema validation for data pipelines). Research established best practices for the task domain before writing test criteria. See `commands/references/test-strategy-by-type.md` for the full domain test strategy reference
- **Regression test in plan**: Plan's primary role is to DESIGN tests (step 17-18), not execute the full RED→GREEN cycle (that is exec's job per `commands/references/test-strategy-by-type.md` Phase Responsibilities). However, plan's L1 self-audit (step 25) and re-plan regression check (step 15) both apply fixes to `.plan.md` — these must include contract-test verification per the Regression Test Protocol. Step 18 generates the RED baseline that exec will use for RED→GREEN
