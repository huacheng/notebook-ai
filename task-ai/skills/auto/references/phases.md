# Detailed Phase Flow

Referenced from `auto/SKILL.md` §Four-Phase Flow.

## Phase 1: Overall Objective (status=draft) — Human in the loop

1. Conversational refine: guide user to define Overall Objective
   - .target.md shows `## Overall Objective` with itemized goals (no markers — all items under discussion)
   - Each item is a separate bullet point, e.g., `- Build JWT auth system`
2. Research (LLM decides):
   - Objective clear, domain familiar → skip research
   - Objective vague or domain unfamiliar → auto-complete research full flow (O1→O2→O3 in one pass), present results
   - User can explicitly request research
3. After user confirms specific items:
   - Add `[CONFIRMED]` to each confirmed item, e.g., `- Build JWT auth system [CONFIRMED]`
   - Items without markers remain in discussion (excluded from plan scope)
   - Generate .convergence-baseline.md from `[CONFIRMED]` items only
4. Auto-generate Stage 1 target:
   - .target.md: remove `[CONFIRMED]`, add `## Stage 1: <name> [ACTIVE]`
   - status → planning

## Phase 2: Planning (status=planning) — Full auto + user can intervene

- Optional: research for technical references (implementation-level, not objective research)
- Execute plan → verify(post-plan) → check(post-plan) (no code output — verify validates plan document quality)
- Plan generation updates .target.md: each `[CONFIRMED]` item covered by plan → `[PROCESSED]`
- check D1-D6 ≥ 0.70 → auto-advance to Phase 3
- score < threshold → auto-replan based on failing dimensions → re-check
- User can intervene: "step 3 unnecessary" → modify .plan.md, re-check

## Phase 3: Execution (status=executing) — Full auto + user can intervene

- All non-system output (code, configs, assets) goes to `$NB_WORK_DIR/.deliverables/` (merge only copies this directory — anything outside it won't reach main branch)
- Execute exec step by step
- Key checkpoints trigger verify → check(mid-exec): significant issues, or every N steps (N from `.type-profile.md` Auto Adaptation `mid-exec check interval`, fallback 3)
- All steps done → verify → check(post-exec)
- check score ≥ threshold → continue/advance to Phase 4
- score < threshold → auto-fix based on failing dimensions → re-verify + re-check
- Exceeds retry limit → stop, notify user
- User can intervene: "what does this error mean?" → explain + fix, continue

## Phase 4: Acceptance + Auto Advance (status=executing→evolving) — Full auto

- Step 1: check(post-exec, D1-D6, threshold=0.75)
  - ACCEPT → Step 2 (convergence gate)
  - NEEDS_FIX → exec(fix) → re-check (max 3)
  - Max exceeded → rollback → re-planning

- Step 2: Convergence gate (within check)
  - check evaluates convergence score vs previous baseline
  - convergence > previous → ACCEPT
    - auto sets status → evolving → highlight → report → evolving entry decision
  - convergence ≤ previous → ROLLBACK

No merge. No pre-merge check.

## Evolving Entry Decision

1. Read latest convergence score (from `.analysis/*-convergence.md`)
2. **convergence >= 0.95**:
   - Report: "convergence {score}, objective largely achieved. If satisfied: /task-ai:target --satisfy; If more needed: tell me what else you need"
   - Wait for user response (no auto-advance)
3. **convergence < 0.95**:
   - Auto-generate next sub-stage target:
     a. Collect inputs: unmet R# (ci < 1.0), coverage trends, completed deliverables, failed exclusion list, deliverable status
     b. LLM reasoning: cluster R#, select subset (prioritize critical + low coverage), cross-check exclusion list, granularity control
     c. Invoke target to write new Stage → .target.md
     d. Auto-enter Phase 2 (Planning)

## Satisfied Re-entry

User initiates refine in satisfied state ("I also need X"):
1. status: satisfied → evolving
2. Update .target.md Overall Objective
3. Update .convergence-baseline.md (add/modify R#)
4. convergence drops due to new R#
5. Auto-generate next sub-stage target → planning → Phase 2
