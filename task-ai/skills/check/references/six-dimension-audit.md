# Six-Dimension Audit Checklist

When evaluating a plan or implementation, apply all six dimensions (D1-D6) systematically. Each dimension has specific checkpoints — verify each one, flag issues by severity (HIGH / MEDIUM / LOW).

This is the L3 (deep audit) application of the unified six-dimension framework. L1 (plan self-audit) and L2 (check post-plan) use the same dimensions at shallower depth. See `plan/references/self-audit-checklist.md` for L1.

**Type adaptation**: Base checkpoints below are universal. Read `.type-profile.md` for domain-specific criteria that augment (never replace) base checkpoints. See [Domain Adaptation](#domain-adaptation) for how dimensions shift across task types.

## Table of Contents

- [D1. Correctness](#d1-correctness-正确性)
- [D2. Security](#d2-security-安全性)
- [D3. Reliability](#d3-reliability-可靠性)
- [D4. Performance](#d4-performance-性能)
- [D5. Architecture](#d5-architecture-架构)
- [D6. Maintainability](#d6-maintainability-可维护性)
- [Computation Rule](#computation-rule)
- [Domain Adaptation](#domain-adaptation)
- [Audit Workflow](#audit-workflow)
- [Regression Test Protocol](#regression-test-protocol)

## D1. Correctness (正确性)

> Core question: Did we do what we were supposed to do?

| Checkpoint | What to Verify |
|------------|---------------|
| **Ordering correctness** | Operations that must happen before/after others are correctly sequenced (e.g., status update before signal write) |
| **Superseded data isolation** | Old/replaced artifacts invisible to readers (archived with dot prefix, excluded by convention) |
| **Source identification** | When multiple sources provide similar data (e.g., `.bugfix/` vs `.analysis/` for fix guidance), the correct source is selected (most recent by date) |

## D2. Security (安全性)

> Core question: Did we defend against what should NOT happen?

| Checkpoint | What to Verify |
|------------|---------------|
| **Path traversal** | All user-provided paths resolved and confirmed under expected directory (no `..` escape) |
| **Input validation** | Names, identifiers, type fields constrained to safe character sets (regex-validated) |
| **Symlink protection** | No symlink-based escape from sandboxed directories |
| **Injection prevention** | No command injection, SQL injection, or template injection from user content |
| **Content sanitization** | External content (annotations, user input) stripped of HTML comments, ANSI escapes, control chars before writing to files |
| **Atomic operations** | Shared resources written atomically (write-to-tmp + rename) to prevent partial reads |
| **Concurrency protection** | Shared mutable state protected by locks (O_CREAT\|O_EXCL), stale lock recovery defined |
| **Secret handling** | No credentials, tokens, or secrets in logs, commit messages, or output files |
| **Privilege boundaries** | Foreground process verified before acting on terminal output (prevent subprocess output manipulation) |

## D3. Reliability (可靠性)

> Core question: Does it degrade gracefully when things go wrong?

| Checkpoint | What to Verify |
|------------|---------------|
| **Deadlock freedom** | Every non-terminal state has ≥1 exit path; no state combinations trap the system |
| **Loop termination** | All cycles (plan↔check, exec↔check) have upper bounds (max iterations, timeout) |
| **Edge cases** | Empty inputs, missing files, first-run scenarios, legacy data handled gracefully |
| **Fallback behavior** | Undefined/empty values have documented fallback (e.g., empty type → skip, unknown type → software) |
| **Idempotency** | Re-running a command in the same state produces the same result (or explicitly rejects) |

## D4. Performance (性能)

> Core question: Is it fast enough and lean enough?

| Checkpoint | What to Verify |
|------------|---------------|
| **Context window management** | Summary hierarchy exists (task-level → directory-level → individual files); readers use summaries as primary context |
| **Lazy loading** | Only latest files read from history directories for ongoing operations; full reads reserved for terminal operations (report) |
| **Growth control** | Accumulated files have compaction rules (line limits, summarization on threshold) |
| **Non-blocking operations** | Locks fail immediately (no spin-wait); file watches use kernel events (inotify), not polling |
| **I/O efficiency** | Bulk operations batched; unnecessary network/disk round trips eliminated |
| **Calculation accuracy** | Numerical estimates, capacity calculations, algorithm parameters computed via script — never mental math (see Computation Rule below) |

## D5. Architecture (架构)

> Core question: Does the structure support change and growth?

| Checkpoint | What to Verify |
|------------|---------------|
| **Modularity** | Concerns properly separated; each component has a single clear responsibility. No god-objects or catch-all modules |
| **Coupling** | Components depend on each other minimally; changes to one don't cascade unpredictably. Shared state isolated to well-defined interfaces |
| **Abstraction layers** | Clear hierarchy; no layer-skipping (e.g., UI directly accessing data layer). Each layer exposes only what the layer above needs |
| **Data flow direction** | Information flows consistently; no circular dependencies between modules. Input → processing → output direction is traceable |
| **Interface boundaries** | Contracts between components are explicit; internal implementation details not leaked across boundaries |
| **Domain structure alignment** | Architecture matches domain conventions — e.g., pipeline stages for ETL, event-driven for real-time, request-response for APIs |
| **Dependency direction** | High-level modules don't depend on low-level details; abstractions don't depend on concrete implementations |
| **Open type system** | New categories/types can be added without modifying core logic |
| **Custom thresholds** | Project-specific acceptance criteria externalized (not hardcoded) |
| **Hook / extension points** | Status transitions, lifecycle events can trigger external actions |
| **Dependency format** | Supports both simple and extended (parameterized) dependency declarations |
| **Progressive disclosure** | Core logic self-contained; reference details loaded on demand |
| **Template system** | Domain-specific templates customizable per project |

## D6. Maintainability (可维护性)

> Core question: Can the next person read and modify this?

| Checkpoint | What to Verify |
|------------|---------------|
| **Cross-file terminology** | Same concept uses identical wording across all files (e.g., dependency validation language) |
| **State machine alignment** | Every (state, command) cell in the matrix matches the skill's State Transitions section |
| **Signal routing match** | Every skill's `.auto-signal` definition matches the auto routing table |
| **Step numbering** | Execution steps are sequential with no gaps or duplicates |
| **Shared protocol references** | All files that use a shared protocol (locks, atomic writes) reference the canonical definition |
| **Field usage symmetry** | Fields written by one skill are correctly read by all consumers (phase, completed_steps, type) |
| **Naming conventions** | File naming patterns (dates, prefixes, suffixes) follow documented conventions everywhere |
| **Step executability** | Each step description is specific enough to start work immediately (no vague "handle appropriately") |
| **Test traceability** | Each step specifies how to verify its completion |

## Computation Rule

**No mental math.** When evaluation involves ANY numerical reasoning — performance estimates, size calculations, capacity limits, threshold comparisons, algorithm complexity, timing analysis — write a script and run it in shell instead of computing mentally.

Examples:
- Estimating file count growth over N iterations → write a Python one-liner
- Checking if a timeout (30 min) covers worst-case cycle count (20 iterations × 90s each) → calculate in shell
- Verifying line count thresholds (500-line compaction) → `wc -l` the actual file
- Comparing dates/timestamps for staleness detection → use `date` command arithmetic

**Why**: Mental arithmetic is error-prone, especially with units, edge cases, and compound calculations. Scripts produce verifiable, reproducible results.

## Domain Adaptation

Base checkpoints above are **universal** — apply to all task types. Each task domain adds type-specific concerns that augment (never replace) the base.

**Priority chain**: Read `.type-profile.md` "Audit Adaptation" section as the **primary** source for domain-specific checkpoints. If absent or incomplete, fall back to the seed tables below. When `.type-profile.md` conflicts with seed tables, the **profile takes precedence** (it is task-specific and research-informed; seed tables are generic defaults).

Seed tables below are ordered by scope (broadest → most specialized) and serve as **bootstrap reference** for `research` when building `.type-profile.md` Audit Adaptation. They are not exhaustive — novel types discovered by `research` get their audit checkpoints written directly to `.type-profile.md` via web research.

### Broad-scope types

| Dimension | software | science:* | documentation | data-pipeline | infrastructure | ml | ai-skill |
|-----------|----------|-----------|---------------|---------------|----------------|-----|----------|
| **D1 Correctness** | +contract tests | +statistical significance, +error propagation | +factual accuracy, +link validity | +row count reconciliation, +exactly-once semantics | +drift detection, +rollback verification | +convergence criteria, +overfitting detection | +edge case coverage, +hallucination detection |
| **D2 Security** | +injection, +auth, +OWASP | +data integrity, +IRB compliance | +link safety, +license compliance | +data provenance, +PII handling | +IAM, +network isolation, +secrets rotation | +training data poisoning, +model extraction | +prompt injection, +context leakage |
| **D3 Reliability** | +regression tests, +graceful degradation | +reproducibility, +experiment isolation | +build reliability, +broken link detection | +backfill recovery, +schema evolution tolerance | +failover, +disaster recovery | +checkpoint/resume, +data pipeline fault tolerance | +fallback responses, +context overflow handling |
| **D4 Performance** | +time/space complexity, +caching | +computation cost, +dataset scale | +build time, +search indexing | +batch vs stream, +parallelism, +backfill cost | +provisioning time, +cold start, +scaling limits | +training throughput, +inference latency, +GPU utilization | +context window efficiency, +token cost |
| **D5 Architecture** | +API design, +SOLID, +design patterns, +plugin API, +configuration surface | +reproducibility structure, +experiment isolation, +new datasets, +parameter sweeps | +information architecture, +navigation hierarchy, +localization, +multi-format output | +stage decomposition, +idempotent stages, +backpressure, +schema evolution, +new source/sink types | +IaC layering, +blast radius isolation, +multi-region, +multi-cloud | +training/inference separation, +feature pipeline, +model swappability, +hyperparameter surface | +progressive disclosure, +skill composability, +new tools, +prompt templates |
| **D6 Maintainability** | +API contract stability, +error format | +unit conventions, +citation format | +style guide compliance, +terminology glossary | +schema versioning, +naming across stages | +tagging standards, +naming conventions | +metric naming, +experiment tracking format | +skill interface conventions |

### Specialized types

| Dimension | image-processing | video-production | dsp | literary | screenwriting | mechatronics | chip-design |
|-----------|-----------------|-----------------|-----|----------|---------------|--------------|-------------|
| **D1 Correctness** | +SSIM/PSNR thresholds, +visual regression | +frame accuracy, +A/V sync tolerance | +SNR/THD thresholds, +frequency response tolerance | +plot coherence, +continuity check | +continuity, +dialogue attribution | +timing analysis, +safety margins | +functional simulation, +formal verification, +STA, +DRC/LVS |
| **D2 Security** | +EXIF stripping, +steganography awareness | +codec vulnerability, +DRM compliance | +input range validation (sample rate, bit depth) | +plagiarism check, +copyright | +rights clearance, +format protection | +safety interlocks, +fail-safe defaults | +IP protection, +side-channel awareness |
| **D3 Reliability** | +format fallback, +corrupt file handling | +timeline recovery, +render resume | +buffer overflow protection, +real-time guarantee | +backup/versioning | +format compatibility | +watchdog, +emergency stop | +design rule fallback, +timing margin |
| **D4 Performance** | +pixel throughput, +memory (resolution×depth) | +render time, +codec efficiency, +I/O bandwidth | +latency budget, +throughput (samples/sec), +memory alignment | +reading pace, +word economy | +page count, +scene timing | +interrupt latency, +control loop frequency | +timing closure (Fmax), +area/power, +routing congestion |
| **D5 Architecture** | +pipeline topology, +colorspace management, +new formats, +filter plugins | +timeline structure, +render graph, +new codecs, +effect plugins | +signal chain topology, +buffer management, +real-time constraints, +filter chain composability | +narrative arc, +chapter structure, +style variations, +audience adaptation | +act structure, +scene graph, +format adaptation (film/TV/web) | +hardware/software boundary, +real-time partitioning, +sensor/actuator swappability | +hierarchy (system/block/module), +clock domain crossing, +IP reuse, +parameterized modules |
| **D6 Maintainability** | +color profile, +resolution conventions | +frame rate, +aspect ratio, +audio sync | +sample format conventions | +voice consistency, +tense agreement | +format conventions (Fountain/FDX) | +signal naming, +unit standards | +naming conventions (RTL/netlist), +design rule consistency |

**How to use**: When `.type-profile.md` has an "Audit Adaptation" section, use it directly — it is the authoritative source. When it doesn't (legacy tasks, first run before research), find the task type column above and apply `+item` checkpoints on top of the base table. For hybrid types (`A|B`), merge checkpoints for all segments.

**Unknown types**: If the task type has no column above and `.type-profile.md` lacks "Audit Adaptation", trigger `research --scope gap --caller check` to populate the profile before proceeding.

## Audit Workflow

Steps 1-6 identify issues. **Steps 7-9 are a HARD GATE** — fixes without regression tests are incomplete and MUST NOT be committed.

1. **Read** `.type-profile.md` "Audit Adaptation" section — primary source for domain checkpoints. If absent, fall back to seed tables above
2. **Read** all relevant task files for full context
3. **Apply** each dimension's base checkpoints + domain-specific additions (from profile or seed table) systematically
4. **Flag** issues with severity and specific file:line references
5. **Cross-reference** findings across dimensions (a security issue may also be a reliability issue)
6. **Propose** fixes grouped by file to minimize edit passes

**--- HARD GATE: Regression Test Protocol (steps 7-9) ---**

7. **Design regression tests** for each proposed fix per the [Regression Test Protocol](#regression-test-protocol) below — classify by (fix category × task type), select test approach from `commands/references/test-strategy-by-type.md` Strategy Matrix, write RED tests before applying fixes. Exemptions: pure typo (≤3 chars), comment-only, historical doc annotation
8. **Apply fixes** and confirm each RED test turns GREEN — if GREEN without fix applied, the test is wrong (not testing the right property)
9. **Run full test suite** to verify no regressions across all dimensions — this step is mandatory even for exempt fixes

## Regression Test Protocol

**HARD REQUIREMENT**: Every audit fix MUST have a regression test. This is non-negotiable — an audit fix without a regression test is incomplete work.

See **`commands/references/test-strategy-by-type.md`** for the full protocol, including the Strategy Matrix, Test Classification Rules, exemptions, and integration with test infrastructure.

The audit workflow steps 7-9 apply this protocol:
- **7.** Classify each fix → select test approach → write RED test → run → confirm FAIL
- **8.** Apply fix → run RED test → confirm GREEN (if GREEN before fix, test is wrong)
- **9.** Run full suite → confirm zero regressions (mandatory even for exempt fixes)

**Violation consequence**: Fixes committed without regression tests can be silently reverted by subsequent audits. The test is the proof that the fix is correct.
