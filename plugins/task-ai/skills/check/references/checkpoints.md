# Checkpoints (scope=lifecycle)

Referenced from `check/SKILL.md` §Checkpoints.

## 1. post-plan (default)

Evaluates whether the implementation plan is ready for execution.

**Reads:** `.target.md` + `.plan.md` + `.summary.md` (if exists) + `.test/` (latest criteria file) + `.bugfix/` (latest file if exists, to verify revised plan addresses execution issues) + `.convergence-baseline.md` (if exists, for R# coverage check)

**Evaluation Criteria (unified six-dimension framework, L2 depth):**

| Dimension | Weight | Focus at L2 |
|-----------|--------|-------------|
| **D1 Correctness** | High | Requirements coverage — does the plan address all `.target.md` requirements? Functional feasibility — can the approach work with current codebase/tools? |
| **D2 Security** | Medium | Security risk identification — are risks flagged and mitigated? |
| **D3 Reliability** | High | Dependency validation — are all `depends_on` modules meeting required status? (simple → `satisfied`, extended → at-or-past `min_status`) If not → BLOCKED. Feasibility of dependencies — are external dependencies available? |
| **D4 Performance** | Low | Plan efficiency — no redundant or overly granular steps? |
| **D5 Architecture** | Medium | Structure — does the plan support incremental delivery and separation of concerns? |
| **D6 Maintainability** | High | Clarity — are steps clear and unambiguous? Verifiability — does `.test/` contain criteria files with testable acceptance criteria and per-step verification? Are test/verification methods appropriate for the task type (see Task-Type-Aware Verification below)? |

**Domain weight adjustment**: Weights above are defaults. Read `.type-profile.md` "Audit Adaptation" section to shift emphasis per task domain (e.g., `software` → Security↑ Reliability↑, `infrastructure` → Security↑↑ Reliability↑↑, `data-pipeline` → Performance↑ Reliability↑). When profile lacks adaptation guidance, use seed tables in `references/six-dimension-audit.md` Domain Adaptation section. Adjustments increase attention on specific dimensions without skipping any.

**Convergence R# Coverage Check:**

When `.convergence-baseline.md` exists, scan plan steps for `Covers: R#` annotations and cross-check against all R# items in the baseline:

1. Read `.convergence-baseline.md` → extract all `R#` items
2. Scan `.plan.md` steps for `Covers: R#, R#, ...` annotations
3. Compute coverage: which R# items are covered by at least one plan step
4. If any R# is uncovered → verdict is **NEEDS_REVISION** with the specific uncovered items listed:
   ```
   Convergence coverage gap: R3 (user auth flow), R7 (error recovery) not covered by any plan step.
   Revise plan to add steps covering these requirements.
   ```

> This check runs independently of the D1-D6 gate. A plan can pass all six dimensions but still receive NEEDS_REVISION if convergence baseline items are not covered.

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **PASS** | Create `.analysis/<date>-post-plan-pass.md` with approval summary | `planning` → `review` |
| **NEEDS_REVISION** | Create `.analysis/<date>-post-plan-needs-revision.md` with specific issues (including uncovered R# items if applicable) | Status unchanged |
| **BLOCKED** | Create `.analysis/<date>-post-plan-blocked.md` with blocking reasons | → `blocked` |

## 2. mid-exec

Evaluates progress during execution when issues are encountered.

**Reads:** `.target.md` + `.plan.md` + `.summary.md` (if exists) + `.test/` (latest criteria + results) + `.analysis/` (latest file only) + current code changes (via git diff)

**Evaluation Criteria:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Progress** | High | How much of the plan has been completed? (read `completed_steps` from `.status.json`) |
| **Deviation** | High | Has execution deviated from the plan? |
| **Issues** | High | Are encountered issues resolvable? |
| **Continue vs Replan** | Critical | Should execution continue or revert to planning? |

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **CONTINUE** | Document progress, note any adjustments | Status unchanged |
| **NEEDS_FIX** | Create `.bugfix/<date>-<summary>.md` with specific fixable issues | Status unchanged |
| **REPLAN** | Create `.bugfix/<date>-<summary>.md` with issue analysis | `executing` → `re-planning`, set `phase: needs-plan` |
| **BLOCKED** | Create `.analysis/<date>-mid-exec-blocked.md` with blocking analysis | → `blocked` |

## 3. post-exec

Evaluates whether execution results meet the task requirements.

**Reads:** `.target.md` + `.convergence-baseline.md` (if exists) + `.plan.md` + `.summary.md` (if exists) + `.test/.summary.md` (primary; drill into individual `.test/` files only if summary is missing or insufficient) + `.analysis/` (latest file only) + code changes + test results. For `software` types, also read `.test/<date>-vh-baseline.md` (VH baseline from plan), `.test/<date>-cumulative-green.jsonl` (CGG records), `.test/hil-snapshots/` (HIL approval records if applicable), and `.notes/` exec files for VFP cycle summaries

**Evaluation Criteria:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Requirements met** | Critical | Does the implementation satisfy `.target.md`? |
| **Tests pass** | High | Do all relevant tests pass? |
| **No regressions** | High | Are there any unintended side effects? |
| **Code quality** | Medium | Does the code follow project conventions? |
| **VFP Compliance** | Medium | (software types only) Did the execution follow VH→HS→Refactor discipline? See VFP Discipline Audit below |

**VFP Discipline Audit** (software types only — `type` contains `software`):

When evaluating post-exec for software types, assess TDD compliance as an additional dimension:

1. **VH baseline exists?** — Check for `.test/<date>-vh-baseline.md` and `vh-stubs.test.*` (generated by `plan` step 18). If missing → deduct compliance score, note "VH baseline not generated during planning"
2. **VH→HS transitions recorded?** — Check `.notes/` exec files for VFP Cycle Summary sections. Each implementation step should have a `Red (N) → Green (N) → Refactor (yes/no)` record
3. **Cycle completeness** — Calculate: `completed_cycles / total_steps`. Acceptable threshold: ≥ 80% of steps should have completed VH→HS cycles
4. **No skipped Red checks** — Verify no steps jumped directly to Green without confirming Red first (check for "pre-Green without VH confirmation" warnings in notes)

**VFP Compliance scoring:**
- **Full** (≥ 80% cycles complete, baseline exists, no skipped Red) → no penalty
- **Partial** (50–79% cycles complete OR baseline missing) → note in evaluation, does not block ACCEPT
- **Low** (< 50% cycles complete) → downgrade to NEEDS_FIX with guidance: "Insufficient TDD discipline — re-run failing steps with proper VH→HS verification"

Include a `## VFP Compliance` section in the `.analysis/<date>-post-exec-*.md` output file with the score and findings.

**Convergence Dual Gate** (post-exec only):

After D1-D6 scores are computed, post-exec applies a **two-gate** evaluation:

| Gate | Question | Pass | Fail |
|------|----------|------|------|
| **D1-D6** | Quality OK? (composite ≥ threshold) | Continue to convergence gate | **NEEDS_FIX** — fix until quality passes |
| **Convergence** | Direction correct? (score > previous) | **ACCEPT** — keep deliverables | **ROLLBACK** — discard, redo from previous stage endpoint |

The convergence gate only fires after D1-D6 passes. See Convergence Evaluation in main SKILL.md for scoring details.

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **ACCEPT** | Create `.analysis/<date>-post-exec-accept.md` + `.analysis/<date>-convergence.md`, write `.test/<date>-post-exec-results.md`. Convergence score is persisted in the convergence analysis file for downstream consumption by auto | Status unchanged (`executing`); auto handles: update `.target.md` (Stage [`ACTIVE`] -> [`COMPLETE`]), update `.status.json` (status -> `evolving`, push to `stage.history`), then -> highlight -> report -> evolving entry decision |
| **NEEDS_FIX** | Create `.analysis/<date>-post-exec-needs-fix.md` with evaluation + `.bugfix/<date>-<summary>.md` per fix item (with regression test spec per §Regression Test Applicability) | Status unchanged |
| **ROLLBACK** | Create `.analysis/<date>-convergence-rollback.md` with failure reason + convergence delta. Record failure experience to highlight archive. Check renders the verdict only — the caller (auto loop or user) executes the actual rollback (`git reset --hard`, trim `stage.history`, set `status → evolving`) | Status unchanged by check; caller transitions `executing` → `evolving` |
| **REPLAN** | Create `.analysis/<date>-post-exec-replan.md` with fundamental issues | `executing` → `re-planning`, set `phase: needs-plan` |
