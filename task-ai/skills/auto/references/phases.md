# Detailed Phase Flow

Referenced from `auto/SKILL.md` §Four-Phase Flow.

## Phase 1: Overall Objective (status=draft) — Auto-extract, then confirm

1. **Auto-extract from context**: On first entry or when user provides intent, LLM immediately writes `.target.md` with structured `## Overall Objective` — itemized goals extracted from conversation context
   - Each item is a separate bullet point, e.g., `- Build JWT auth system`
   - Present the extracted objectives to user: "Based on your description, here are the objectives I've extracted: ... Please confirm, or tell me what to adjust."
2. **Incremental R# splitting**: Each time a sub-item is added or changed, immediately invoke `target` sub-command to define that sub-item's R# requirements. R# accumulates incrementally during the multi-round dialog — NOT batched at the end
3. Research (LLM decides):
   - Objective clear, domain familiar → skip research
   - Objective vague or domain unfamiliar → auto-complete research full flow (O1→O2→O3 in one pass), present results
   - User can explicitly request research
4. **Objective confirmation gate** (PROMPT_TARGET_CONFIRMED):
   - When objectives are ready (explicit "OK" / implicit re-invocation with `.target.md` content):
   - Output **PROMPT_TARGET_CONFIRMED** — list extracted sub-items with their R# counts, ask user to confirm or adjust
   - If user adjusts → update sub-items → invoke `target` for changed items → re-present PROMPT_TARGET_CONFIRMED
   - If user confirms → step 5
5. **Auto-execution begins** (Phase 2-4 all automatic from here):
   - Invoke `target` to generate `.convergence-baseline.md` from accumulated R# (same logic as `target/SKILL.md` §3e)
   - Invoke `target` to auto-generate Stage 1: mark all sub-items `[CONFIRMED]`, add `## Stage 1: <name> [ACTIVE]` to `.target.md`
   - status → planning → Phase 2 (fully automatic)

## Phase 2: Planning (status=planning) — Full auto

1. **Prior stage context loading** (Stage N where N > 1):
   - Read `stage.history` from `.status.json` — get completed stages and their convergence scores
   - Read `.deliverables/` — understand what has already been built
   - Read previous stage reports (`.analysis/*-convergence.md`) — identify which R# are met vs unmet
   - Plan MUST account for: existing code/deliverables from Stage 1..N-1, their test coverage, known issues, and remaining R# gaps
   - Avoid re-implementing what prior stages already delivered; build incrementally on top of existing work
2. Optional: research for technical references (implementation-level, not objective research)
3. Execute plan → verify(post-plan) → check(post-plan) (no code output — verify validates plan document quality)
   - Plan generation updates .target.md: each `[CONFIRMED]` item covered by plan → `[PROCESSED]`
   - score < threshold → auto-replan based on failing dimensions → re-check
4. check D1-D6 ≥ threshold → auto-advance to Phase 3 (no user gate)

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
    - auto sets status → evolving → highlight → report → next stage decision
  - convergence ≤ previous → ROLLBACK

No merge. No pre-merge check.

## Next Stage Decision (Automatic)

After each stage completes (highlight → report), auto decides next action **without waiting for user**:

1. Read latest convergence score (from `.analysis/*-convergence.md`)
2. **convergence >= 0.95**:
   - status → satisfied → generate final report (task complete)
   - No user gate — Overall Objective has been achieved
3. **convergence < 0.95**:
   - Auto-generate next sub-stage target:
     a. Collect inputs: unmet R# (ci < 1.0), coverage trends, completed deliverables, failed exclusion list, deliverable status
     b. LLM reasoning: cluster R#, select subset (prioritize critical + low coverage), cross-check exclusion list, granularity control
     c. Invoke target to write new Stage → .target.md
     d. Auto-enter Phase 2 (Planning) — continue toward Overall Objective

## Satisfied Re-entry

User initiates refine in satisfied state ("I also need X"):
1. status: satisfied → evolving
2. Update .target.md Overall Objective
3. Update .convergence-baseline.md (add/modify R#)
4. convergence drops due to new R#
5. Auto-generate next sub-stage target → planning → Phase 2
