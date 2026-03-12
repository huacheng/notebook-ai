# Convergence Evaluation — Methodology Reference

Convergence measures whether deliverables are moving toward the task's target requirements. Used by the post-exec dual gate to distinguish "quality OK but wrong direction" (ROLLBACK) from "quality OK and progressing" (ACCEPT).

## Formula

```
convergence = Σ(wᵢ × cᵢ) / Σ(wᵢ)
```

Where:
- `wᵢ` = weight of R# item (from `.convergence-baseline.md`)
- `cᵢ` = coverage score for R# item (see scale below)

## Scoring Scale

Each R# item is evaluated against its **Acceptance Criteria** (from `.convergence-baseline.md`):

| Score | Meaning | Acceptance Criteria Check |
|-------|---------|---------------------------|
| **1.00** | Fully satisfied — requirement completely implemented and verified | All acceptance criteria pass |
| **0.75** | Mostly satisfied — core functionality present, minor gaps | Most criteria pass, minor edge cases fail |
| **0.50** | Partially satisfied — some progress but significant gaps remain | Half of criteria pass |
| **0.25** | Minimally addressed — initial work started, mostly incomplete | Some structure exists, most criteria fail |
| **0.00** | Not addressed — no deliverable progress toward this requirement | No criteria pass |

**Evaluation rule**: Score each R# by checking its acceptance criteria against the deliverables. The criteria are concrete tests — "returns 401 on expired token" is either true or false for the current code.

## Anchor Mechanism

To prevent score drift across evaluations:

1. Read previous `.analysis/*-convergence.md` (latest by filename sort) as **anchor**
2. For each R# item, compare current assessment against previous score
3. If score changed by more than ±0.25 from previous, provide explicit justification in the per-R# detail table
4. If no previous convergence file exists (first stage evaluation), scores are unanchored — note this in the output. Previous convergence defaults to 0.0 so first stage always passes the direction gate (any progress > 0)

## Output Format

Write evaluation to `.analysis/<date>-convergence.md`:

```markdown
# Convergence Evaluation — <date>

**Previous convergence**: <score or "N/A (first evaluation)">
**Current convergence**: <score>
**Delta**: <+/- change>
**Verdict**: ACCEPT / ROLLBACK

## Per-R# Detail

| R# | Description | Weight | Previous | Current | Justification |
|----|-------------|--------|----------|---------|---------------|
| R1 | ... | 3 | 0.50 | 0.75 | Added error handling module |
| R2 | ... | 2 | 0.75 | 0.75 | No change |
| ... | | | | | |

## Decision Rationale

<Why convergence improved/regressed, what deliverables contributed>
```

For ROLLBACK outcomes, the file is named `.analysis/<date>-convergence-rollback.md` and includes an additional `## Failure Experience` section documenting what went wrong and lessons learned for the next attempt.
