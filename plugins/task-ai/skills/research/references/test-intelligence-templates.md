# Test Intelligence Templates — Test-S1/S2a/S2b/S3

> Extracted from `research/SKILL.md` — output format templates for `--caller test` steps.

> Collection targets by task type: see `commands/references/test-strategy-by-type.md` §Strategy Matrix and §Phase Responsibilities.

**Test-S1. Read `.status.json` status to determine routing**

Use shell script to extract status:
```bash
python3 "$TASK_AI_ROOT/core/state.py" get ".status.json" status
```

**Test-S2a. If status = `planning`, `draft`, or `re-planning` -> Methodology collection**

Collect domain testing methodology for plan phase:
- Recommended test layering strategy for task type (unit/integration/e2e ratios)
- Test design patterns: boundary value analysis, equivalence partitioning, state machine testing
- Industry standard coverage requirements (line/branch/mutation)
- Domain-specific testing concerns: timing dependencies, external service mocking, data consistency

Write to `.test/<YYYY-MM-DD>-research-methodology.md`:
```markdown
# Test Methodology Research · {date}

## Testing Strategy
<!-- Recommended test layering for this domain type -->

## Test Design Patterns
<!-- Domain-applicable patterns -->

## Coverage Standards
<!-- Industry standard coverage requirements -->

## Domain-Specific Testing Concerns
<!-- Domain-unique testing challenges -->
```

**Test-S2b. If status = `executing` or `review` -> Tools collection**

Collect specific testing tools and benchmarks for verify phase:
- Specific frameworks: name, version, install command
- Assertion patterns tailored to current tech stack
- Performance benchmarks, coverage thresholds, timeout values (use scripts to verify actual installed versions)
- CI integration approach

Write to `.test/<YYYY-MM-DD>-research-tools.md`:
```markdown
# Test Tools Research · {date}

## Recommended Tools
<!-- Framework: name + version + install command -->

## Assertion Patterns
<!-- Common assertion examples for current tech stack -->

## Thresholds & Benchmarks
<!-- Performance baselines, coverage thresholds, timeout values (verified via script) -->

## CI Integration
<!-- How to run these tests in CI pipeline -->
```

**Test-S3. Write shared reference**

Write or append to `$NB_WORKSPACES_LIBRARY/.memory/.references/testing-<type>.md` (acquire `.memory/.references/.lock` first):
- Consolidated testing knowledge for this domain type
- Reusable by future tasks of the same type

**Git commit**: `task-ai(<notebook>):research collect references` (when files written)
