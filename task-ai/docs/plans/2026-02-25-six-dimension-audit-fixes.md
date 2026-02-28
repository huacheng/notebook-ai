# Six-Dimension Audit Fixes

**Date**: 2026-02-25
**Status**: Approved

## Scope

Fix 11 issues (out of 25 identified) from the six-dimension audit of the task-ai command system. All changes follow Red/Green TDD: write failing contract tests first, then implement fixes.

## Issues & Fixes

### 1. Lettered sub-steps → numeric (C1, C2)

**Files**: auto/SKILL.md, research/SKILL.md, auto/references/backend-api.md, library/references/write-protocol.md, exec/SKILL.md, merge/SKILL.md
**Fix**: Convert all a/b/c sub-steps to N.M numeric format. Fix exec duplicate "f" label.
**Test**: `sub-step-numbering.sh` (L1) — detect lettered sub-steps in Execution Steps sections.

### 2. read delegates to research for deep mode (C3 partial)

**Files**: read/SKILL.md
**Fix**: `--depth deep` web search replaced with `research --caller read --scope gap` delegation.
**Test**: `read-functional.sh` (L2) — verify deep mode references research.

### 3. Six-perspective terminology alignment (C4)

**Files**: check/SKILL.md, MEMORY.md
**Fix**: Align check SKILL.md prose to use exact terms from six-dimension-audit.md: D1 Correctness, D2 Security, D3 Reliability, D4 Performance, D5 Architecture, D6 Maintainability. Update MEMORY.md to match.
**Test**: `terminology.sh` (L2) — extract canonical terms from audit reference, verify check SKILL uses them.

### 4. $TASK_AI_ROOT script path resolution (C5)

**Files**: research/SKILL.md
**Fix**: Replace bare `$TASK_AI_ROOT` references with self-resolving script calls. Each scripts/*.sh already resolves TASK_AI_ROOT via `$(cd "$(dirname "$0")/../.." && pwd)`. SKILL.md code blocks should show the script invocation using the skill's own relative path.
**Test**: `script-reachability.sh` (L1) — verify all script paths referenced in SKILL.md files exist.

### 5. light SKILL.md contradiction (C6)

**Files**: light/SKILL.md
**Fix**: Remove "No physical directory creation" from description. Default start creates branch + `.light-tasks.jsonl` only (no init). Move init call to `--promote` step only.
**Test**: `light-functional.sh` (L2) — verify description doesn't claim "No physical directory creation" AND init only appears under promote condition.

### 6. VFP applicability generalization (C7)

**Files**: exec/SKILL.md, check/SKILL.md
**Fix**: Change VFP trigger condition from `type contains 'software'` to `type contains 'software' OR .type-profile.md contains '## Verification Cycle'`. Per verification-first-protocol.md spec.
**Test**: `vfp-applicability.sh` (L2) — verify exec/check VFP sections include type-profile Verification Cycle check.

### 7. Delete lifecycle-hooks.md (S1)

**Files**: commands/references/lifecycle-hooks.md (delete), commands/task-ai.md, REFERENCE-INDEX.md
**Fix**: Delete the file. Remove all references from task-ai.md and REFERENCE-INDEX.md.
**Test**: `cross-refs.sh` (L1) — verify no file references lifecycle-hooks.md.

### 8. Dev/publish directory workflow (A1)

**Files**: .dev/publish.sh (new), plugins/task-ai/ (sync target)
**Fix**: Create publish.sh that runs validate.sh --level 1, then rsyncs publishable files to plugins/task-ai/. Resolve 3 file diffs (research model_tier, target model_tier, model-routing research row) — task-ai/ is source of truth.
**Test**: `publish-sync.sh` (L1) — diff publishable files between task-ai/ and plugins/task-ai/.

### 9. read vs research boundary clarification (A2, C3)

**Files**: read/SKILL.md, commands/references/model-routing.md
**Fix**: model-routing.md read description changed from "Web search + content collection" to "Local document ingestion; delegates to research for supplementation". read/SKILL.md deep mode delegates to research.
**Test**: `read-functional.sh` (L2) — verify model-routing read row doesn't contain "Web search".

### 10. annotate frontend interface placeholder (A3)

**Files**: annotate/SKILL.md
**Fix**: Add Notes entry: "Frontend integration: The .tmp-annotations.json → annotate flow is not yet integrated with the frontend. Interface contract TBD."
**Test**: `annotate-functional.sh` (L2) — verify annotate SKILL.md contains frontend integration TBD note.

## Deferred (14 items)

S2 (research security audit), S3 (PID reuse), S4 (hash threshold), R1 (index.json recovery race), R2 (master-index fallback), R3 (auto double fault), R4 (ACCEPT verdict TTL), P1 (research model routing), P2 (summary rewrite cost), P3 (changelog scan limit), A4 (maintain/auto concurrency), M1 (implicit conventions), M2 (signal case conventions), M3 (doc volume).

## TDD Execution Order

1. Write ALL test scripts → run validate.sh → confirm all Red (FAIL)
2. Fix issues one by one → run after each → confirm progressive Green
3. Final full run validate.sh --level all → confirm zero regression
