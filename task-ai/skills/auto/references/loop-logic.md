# Detailed Loop Logic

Referenced from `auto/SKILL.md` §Detailed Loop Logic.

## Entry Point (Status-Based Routing)

| Current Status | First Step |
|----------------|-----------|
| `draft` | Phase 1 (auto-extract objectives) — LLM updates `## Overall Objective` sub-items from conversation context. Each sub-item added/changed → immediately invoke `target` for incremental R# split. Single gate: PROMPT_TARGET_CONFIRMED → user confirms → generate `.convergence-baseline.md` from accumulated R# → Stage 1 → planning (full auto from here). If `.target.md` already has content (re-invocation) → present PROMPT_TARGET_CONFIRMED directly |
| `planning` | Phase 2 (plan → check, full auto) — Execute plan → verify → check (post-plan). On PASS → auto-advance to Phase 3 |
| `re-planning` | Phase 2 (plan → check, full auto, with check feedback) — Read `phase` field: if `needs-plan` → execute plan; if `needs-check` → execute verify → check (post-plan); if empty → default to plan |
| `review` | Phase 3 entry — plan passed check, auto-advance to exec |
| `executing` | Phase 3 (exec → check) — Execute verify → check (post-exec). **Note**: even if `completed_steps` < total, auto enters via post-exec verification first — check detects incomplete work and routes back to exec via NEEDS_FIX |
| `evolving` | Phase 4 (full auto) — read convergence score. < 0.95 → auto-generate next sub-stage target → planning (continue toward Overall Objective). >= 0.95 → satisfied → final report (task complete) |
| `satisfied` | Task complete. User can refine ("I also need X") → evolving → auto-generate sub-stage → planning |
| `blocked` | Report blocking reason, wait for user intervention |
| `cancelled` | Report task cancelled (terminal state) |

## Result-Based Routing

| step | result | next | checkpoint | Rationale |
|------|--------|------|------------|-----------|
| check | PASS | exec | post-plan | Plan approved, auto-advance to execution |
| check | NEEDS_REVISION | plan | — | Plan needs revision |
| check | ACCEPT | highlight | post-exec | D1-D6 + convergence gate passed, finalize |
| check | ROLLBACK | (rollback) | post-exec | Convergence not improving, rollback |
| check | NEEDS_FIX | exec | mid-exec / post-exec | Minor issues, re-execute to fix |
| check | REPLAN | plan | — | Fundamental issues, revise plan |
| check | BLOCKED | (stop) | — | Cannot continue |
| check | CONTINUE | exec | mid-exec | Progress OK, resume execution |
| target | (stage-advanced) | plan | — | New stage target written, generate plan |
| target | (refined) | plan | — | Overall Objective refined, re-plan |
| plan | (generated) | verify | post-plan | Plan ready, verify before assessment |
| exec | (done) | verify | post-exec | All steps completed, verify before assessment |
| exec | (mid-exec) | verify | mid-exec | Significant issue, verify before checkpoint |
| exec | (step-N) | verify | mid-exec | Single step completed (manual `--step N` only) |
| exec | (blocked) | (stop) | — | Cannot continue |
| highlight | (distilled) | report | — | Distillation complete |
| highlight | (skipped-idempotent) | report | — | No new content |
| highlight | failed | report | — | Distillation failed (non-blocking) |
| research | (collected) | `<caller>` | post-research | References collected, resume calling phase |
| research | (sufficient) | `<caller>` | post-research | References sufficient |
| research | (objective-complete) | `<caller>` | post-research | O1→O2→O3 completed in one pass, present results, resume calling phase |
| verify | (pass) | check | (from trigger context) | Verification done, check renders verdict |
| verify | (fail) | check | (from trigger context) | Verification done, check renders verdict |
| verify | (partial) | check | (from trigger context) | Verification done, check renders verdict |
| annotate | (processed) | `<by-layer>` | post-annotate | Layer-based: Requirement→plan/check, Planning→check, Eval-analysis→check, Eval-test→verify, Methodology→verify, Information/Comment-only→(none) |
| report | (generated) | (next-stage) | — | Phase 4 complete → next stage decision (automatic) |

## Next Stage Decision (Internal Step)

`(next-stage)` is an internal step in the auto loop, not a sub-command. Fully automatic — no user gate:
- Read convergence score
- >= 0.95 → status → satisfied → final report → `(stop)` (Overall Objective achieved)
- < 0.95 → invoke target (stage advance) → result `(stage-advanced)` → plan → Phase 2 continues loop

## Post-ROLLBACK Regeneration

1. highlight records failure experience to `.experiences/<type>/<semantic>-failed.md`
2. From all `*-failed.md` files, filter current task exclusion list by frontmatter `sources.notebook`
3. Regenerate sub-stage target (exclusion list injected as hard constraint in prompt)
4. If all directions exhausted → stop and report to user
5. Otherwise → new sub-stage target → Phase 2

> **Safety**: git reset --hard only affects the task branch, not master. The previous stage commit is always available in stage.history (for stage 2+). Stage 1 ROLLBACK is blocked — falls back to NEEDS_FIX.

## Context Advantage

Because all steps run in one session, Claude naturally retains:
- Plan decisions and trade-offs from planning phase
- Check feedback and evaluation rationale
- Implementation details and workarounds from execution
- Error context from previous fix attempts

The `.summary.md` file is still written by each sub-command as a **compaction safety net**. During normal auto execution, live conversation context is the primary source of truth.
