# L1 Self-Audit Checklist

Quick-scan checklist for plan self-audit (step 25). Uses the unified six-dimension framework (D1-D6). Each dimension has 2-4 surface-level checks. Scan `.plan.md` against `.target.md`, fix issues in-place.

**Depth**: L1 (surface scan, binary judgment, in-place fix). Not a substitute for L2 check (independent review) or L3 deep audit (systematic per-checkpoint verification).

## 1. Checklist by Dimension

### D1 Correctness — Does the plan cover what it should?

| Check | Method | Fix |
|-------|--------|-----|
| **Requirements coverage** | Each requirement in `.target.md` maps to ≥1 plan step | Add missing steps |
| **Acceptance criteria mapping** | Each acceptance criterion in `.target.md` has an explicit verification point in the plan | Append verification notes to relevant step |
| **Input/output consistency** | Each step's output is correctly consumed by subsequent steps | Fix data flow breaks |

### D2 Security — Does the plan identify what should NOT happen?

| Check | Method | Fix |
|-------|--------|-----|
| **Security-sensitive step identification** | Steps involving user input, external APIs, file I/O, or permissions annotate security considerations | Append security comments |
| **Input validation coverage** | Steps accepting external data describe validation/sanitization | Add validation requirements |

### D3 Reliability — Does the plan account for exception paths?

| Check | Method | Fix |
|-------|--------|-----|
| **Dependency explicitness** | Each step's external dependencies (libraries, services, files) explicitly listed | Add dependency lists |
| **Failure fallback** | Critical steps describe failure handling | Append fallback plans |
| **Inter-step coupling** | Identify whether one step's failure cascades and blocks all subsequent steps | Mark blocking points |

### D4 Performance — Is the plan sufficiently lean?

| Check | Method | Fix |
|-------|--------|-----|
| **Redundant steps** | Check for mergeable or deletable steps | Merge or delete |
| **Step granularity** | Check whether single steps are too large (split) or too small (merge) | Adjust granularity |

### D5 Architecture — Does the plan structure support change?

| Check | Method | Fix |
|-------|--------|-----|
| **Module boundaries** | Step groupings reflect reasonable module/phase divisions | Reorganize step groups |
| **Incremental delivery** | Plan supports staged delivery, not all-or-nothing | Mark stage boundaries |
| **Separation of concerns** | Each step does one thing only | Split mixed steps |

### D6 Maintainability — Can the next agent execute directly?

| Check | Method | Fix |
|-------|--------|-----|
| **Step executability** | Each step description is specific enough to start work immediately (no vague phrasing like "handle appropriately") | Clarify descriptions |
| **Terminology consistency** | Plan terminology matches `.target.md` and `.type-profile.md` | Unify terminology |
| **Test traceability** | Each step specifies how to verify its completion | Add verification methods |

## 2. Domain Weight Adjustment

Read `.type-profile.md` to shift emphasis. Default weights are equal; adjustments increase attention on specific dimensions without skipping any.

| Task Type | Weight Adjustment |
|-----------|------------------|
| `software` | Security↑ Reliability↑ |
| `data-pipeline` | Performance↑ Reliability↑ |
| `documentation` | Maintainability↑ Correctness↑ |
| `infrastructure` | Security↑↑ Reliability↑↑ |
| `ml` | Performance↑ Architecture↑ |

For types not listed, apply equal weights. For hybrid types (`A|B`), merge weight adjustments from all segments.

## 3. Execution Rules

- **Single pass**: scan all 6 dimensions once, apply fixes. No iteration (prevents infinite self-audit loops)
- **No analysis files**: self-audit does NOT write to `.analysis/` (that is check's responsibility)
- **In-place fixes only**: edit `.plan.md` directly
- **Non-fatal**: if self-audit crashes or times out, skip and continue to Git commit. Report "Self-audit: skipped (error)" in step 28
- **Report**: step 28 includes one-line summary — "Self-audit: N issues found and corrected" or "Self-audit: clean"
