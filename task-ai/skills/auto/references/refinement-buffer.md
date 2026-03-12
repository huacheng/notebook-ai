# Pending Refinement Buffer

Referenced from `auto/SKILL.md` §Pending Refinement Buffer.

User messages arriving during auto execution are semantically classified:

| User says | Category | auto behavior |
|-----------|----------|---------------|
| "Add OAuth support" | refinement | Write to buffer → confirm → continue |
| "What does this error mean?" | question | Answer → continue |
| "Skip step 3" | directive | Adjust → continue |
| "Continue" | continue | Continue |

## Buffer File

Path: `.working/.pending-refinements.md` (git tracked)

```markdown
- [2026-03-08 14:05] Add OAuth Google login support
- [2026-03-08 14:12] Change login failure rate limit from 5 to 10 attempts
```

Each write is committed: `git add .working/.pending-refinements.md && git commit -m "auto: buffer refinement"`.

## Two-Level Processing

**Level 1 — Inter-step quick check** (between exec steps):
```
if .pending-refinements.md exists and non-empty:
    Scan each item → annotate impact scope (which R#)
    if affects currently executing step:
        mark needs_reassess = true (trigger mid-exec check after current step)
    else:
        continue (leave to checkpoint batch processing)
```

**Level 2 — Checkpoint batch processing** (at mid-exec / post-exec check):
```
if .pending-refinements.md exists and non-empty:
    1. Call target --refine "..." for each item
    2. Update .convergence-baseline.md (add/modify R#, adjust weights)
    3. Impact assessment:
       - Pure addition (new R# doesn't affect completed steps) → append to plan tail, continue
       - Modify existing R# (weight/content change) → NEEDS_FIX or REPLAN
    4. Clear buffer
```

## Impact Assessment Levels

| Level | Judgment | Action |
|-------|----------|--------|
| None | New R# unrelated to current/completed steps | Append plan steps, continue |
| Minor | Modified optional R# detail | Mark, handle at post-exec |
| Moderate | Modified important R# | Trigger mid-exec check |
| Major | Modified critical R# or Overall Objective | REPLAN |

## Confirm/Withdraw

User can withdraw a buffered refinement before it is processed:
- "Cancel the OAuth requirement I just mentioned" → remove matching entry from buffer, confirm removal
- Already processed (buffer cleared at checkpoint) → inform user it was already applied
