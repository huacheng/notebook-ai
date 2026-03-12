---
name: verify
description: "Run domain-adapted tests and verification procedures, producing result files. Triggered after plan generation (post-plan), during execution (per-step), or after execution completes (post-exec) to provide evidence for check's verdict."
model_tier: medium
auto_delegatable: true
triggers:
  keywords:
    zh: [测试, 验证, 跑测试, 测一下, 验收, 通过了吗]
    en: [test, verify, run tests, validate, check tests, passing]
  phrases:
    zh: [跑一下测试, 验证一下, 测试通过了吗, 看看测试结果, 全量测试, 快速验证]
    en: [run the tests, verify it works, are tests passing, run verification, quick check, full test suite]
  disambiguate: >
    Core intent: run tests and produce result files — does NOT render verdicts.
    User says "run tests" or "does it pass?" → verify.
    User says "is the plan OK?" or "can we merge?" → check (renders verdict).
arguments:
  - name: checkpoint
    description: "Verification scope: quick, full, or step-N (N >= 1)"
    required: false
    default: full
  - name: generate-skill-tests
    description: "Generate a structured test template for a skill file (requires --target)"
    required: false
    type: flag
  - name: target
    description: "Path to a SKILL.md file (used with --generate-skill-tests)"
    required: false
---

# /task-ai:verify — Test Execution & Verification

Run domain-adapted tests and verification procedures for a task module, producing structured result files. Does not render a verdict — that is the responsibility of `check`.

> **Path Rule**: All system files (`.status.json`, `.target.md`, `.plan.md`, etc.) are in `$TASKAI_WORK_DIR/` (= `$NB_WORK_DIR/.working/`), NOT in `$NB_WORK_DIR/` directly. See `commands/task-ai.md` §System File Path Rule.

## Usage

```
/task-ai:verify [--checkpoint quick|full|step-N]
/task-ai:verify --generate-skill-tests --target <skill.md>
```

**Notebook auto-detection:** The notebook is automatically resolved from CWD (`.status.json`) or the current git branch (`task/<notebook>`). No manual notebook parameter needed.

### Skill Test Generation Mode

When `--generate-skill-tests` is passed with `--target <path-to-SKILL.md>`, verify generates a structured test template for the specified skill file under `.test/skill-<name>.test.md`. This mode exits immediately after generation and does not run normal verification flow.

## Checkpoints

| Checkpoint | Scenario | Scope |
|------------|----------|-------|
| `quick` | Lightweight check during execution | build + lint + type check |
| `full` | Comprehensive post-execution verification | All `.test/` criteria + acceptance tests + regression tests |
| `step-N` | Per-step verification during exec (N >= 1) | Only criteria related to step N |

## Execution Steps

1. **Read** `.status.json` — get `type`, `status`. Validate status is not terminal (`cancelled` is the only terminal state)
2. **Read** `.type-profile.md` if exists — "Verification Standards" section is the **primary** source for testing approach, quality metrics, and acceptance criteria for this task (see `plan/references/type-profiling.md` for type system details)
3. **Read** `.test/` latest criteria file — determine what to verify. For software types, also locate `vh-stubs.test.*` and `vh-baseline.md` for VFP verification
4. **Read** `.target.md` — extract acceptance criteria
5. **Read** `.summary.md` if exists — condensed context for understanding verification scope
6. **Load library context** via Changelog Consumption Protocol (`commands/references/changelog-consumption-protocol.md`)
7. **Library search**: invoke `/task-ai:library search "<keywords>"` with verification-relevant keywords (testing frameworks, tools, domain standards). Library search handles index reading, scoring, and ranked results — read high-scoring matches for domain verification guidance
8. **Gap check**: if `.type-profile.md` lacks verification standards OR `.references/` lacks testing/verification knowledge for the task `type`, trigger `research --scope gap --caller verify` to collect missing references before proceeding
9. **Determine** verification strategy: use `.type-profile.md` "Verification Standards" first, supplement with per-type seed file `init/references/seed-types/<type>.md` (verify section), combine with `.references/` domain knowledge. If verification reveals that `.type-profile.md` standards are inadequate, update its "Verification Standards" section with findings. For hybrid types (`A|B`), read seed files and experience for all segments
   > **See `commands/references/test-strategy-by-type.md`** §VFP Applicability for per-type VH mode defaults and compliance thresholds.
10. **Execute** verification procedures per checkpoint scope:
    - **VFP delegation** (`full` or `step-N` checkpoint, `type` contains `software`): Follow `auto/references/plugin-delegation.md` to attempt matching the `tdd` capability slot. For `software` types, tdd delegation is **default-enabled** (not optional) at `full` and `step-N` checkpoints. If matched, invoke via Task subagent — delegate test generation/execution, merge results into standard verification output. No match or failure → continue standard verification flow
    - `quick`: build, lint, type check — fast feedback loop
    - `full`: all `.test/` criteria, acceptance tests from `.target.md`, regression tests
    - `step-N`: only criteria associated with step N from `.test/` criteria file
11. **Write** `.test/<YYYY-MM-DD>-<checkpoint>-results.md` with structured test outcomes (pass/fail per criterion, raw output, metrics). For `software` types, append a **VFP Metrics** section:
    ```markdown
    ## VFP Metrics
    - VH stubs total: N (from `.test/<date>-vh-baseline.md`)
    - Green (passing): M
    - Still Red (failing): N - M
    - VH→HS cycle count: K (steps that completed a full VH→HS transition)
    - Coverage: X% (if coverage tooling is available, otherwise "N/A")
    - VFP compliance: (K / total_steps)% of steps followed VH→HS discipline
    ```
12. If checkpoint != quick: execute highlight protocol scope=verify — see `highlight/SKILL.md` §3.2. Extract verification experience (type-adaptive, not limited to software) from current context, write to library. Inline call failure should not block verify's main flow — highlight is enhancement, not gating. Skip if `--checkpoint quick` (insufficient evidence for experience)
    - Also execute highlight protocol scope=thinking-raw — see `highlight/SKILL.md` §3.3. Optional, encouraged (high-value). Capture verification strategy selection and result analysis reasoning. Inline call failure should not block verify's main flow (same fault isolation)
13. **Update** `.test/.summary.md` — overwrite with condensed summary of ALL criteria & results files in `.test/`
14. **Git commit**: `task-ai(<notebook>):verify <checkpoint> verification`
15. **Report** results summary to user. Then output next step prompt: "Verification complete. Next: `/task-ai:check --checkpoint <checkpoint>` to evaluate the results and render a verdict." (substitute the actual checkpoint value)

## Result Values

| Result | Meaning |
|--------|---------|
| `(pass)` | All verification criteria met |
| `(fail)` | One or more critical criteria failed |
| `(partial)` | Some criteria passed, some failed (non-critical failures) |

## State Transitions

| Current Status | After Verify | Condition |
|----------------|--------------|-----------|
| Any | (unchanged) | Pure utility sub-command |

## Git

```
task-ai(<notebook>):verify <checkpoint> verification
```

Examples:
```
task-ai(auth-refactor):verify quick verification
task-ai(auth-refactor):verify full verification
task-ai(auth-refactor):verify step-3 verification
```

## Notes

- **Utility, not gatekeeper**: `verify` runs tests and produces results; `check` reads those results and renders verdicts. This separation allows tests to be re-run independently without triggering state transitions
- **check integration**: `check` can optionally invoke `verify` internally, or read pre-existing `verify` results from `.test/`. When recent `verify` results exist (same day, matching checkpoint), `check` incorporates them instead of re-running tests
- **exec integration**: Per-step verification in `exec` can optionally invoke `verify --checkpoint step-N` for domain-specific testing. For lightweight checks (build + lint), inline verification is sufficient
- **Domain adaptation**: Verification strategy should match the task `type` — running unit tests for a documentation task produces false confidence, while prose review for a software task misses regressions. Use `.type-profile.md` first, then per-type seed file `init/references/seed-types/<type>.md` for domain-specific testing procedures, tools, and thresholds. Supplement with web search for current best practices
- **Concurrency**: Verify acquires `.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/task-ai.md`)
