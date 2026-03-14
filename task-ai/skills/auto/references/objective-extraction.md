# Objective Extraction Protocol

Referenced from `auto/SKILL.md` §Phase 1 Dialog and `target/SKILL.md` §Incremental R# Splitting.

## Overview

During Phase 1, auto extracts Overall Objective sub-items from user dialog and writes them to `.target.md`. Each sub-item, once written, triggers an immediate `target` call to split it into R# requirements. This document defines the extraction rules, `.target.md` format, update detection, and the incremental R# interface.

## Sub-item Extraction Rules

### What constitutes a sub-item

Each sub-item is one **atomic, independently trackable goal**. Extract by decomposing user intent:

| User says | Extracted sub-items |
|-----------|-------------------|
| "Build a JWT auth system with refresh tokens" | `- JWT token authentication for login` / `- Refresh token support for session extension` |
| "I need a dashboard" | `- Dashboard (pending detail — ask user to clarify scope)` |
| "Add login, signup, and password reset" | `- User login` / `- User signup` / `- Password reset` |
| "Make it fast and secure" | Not sub-items — these are constraints. Write to `## Constraints` |

### Extraction principles

1. **Decompose compound goals**: "A with B" → two sub-items, unless B is a minor detail of A
2. **One verb per sub-item**: Each sub-item should have one primary action (build, add, support, integrate...)
3. **Concrete over vague**: "Dashboard" is too vague → ask user what the dashboard shows. If user doesn't clarify, write it with a `(pending detail)` annotation
4. **Constraints ≠ sub-items**: Performance targets, technology choices, compatibility requirements → `## Constraints`, not `## Overall Objective`
5. **Non-functional requirements**: Security, observability, deployment → only become sub-items if they are primary deliverables, otherwise → `## Constraints`

### When to extract

| Trigger | Action |
|---------|--------|
| User describes intent (first message or new requirement) | Extract sub-items, write to `.target.md`, call `target` for R# |
| User modifies existing requirement ("change X to Y") | Update the matched sub-item, call `target` to re-split R# for that sub-item |
| User adds detail to existing sub-item ("login should also support SSO") | Update sub-item text, call `target` to update R# |
| User removes requirement ("drop the OAuth part") | Remove sub-item + its R# entries |
| User states a constraint ("must run on 2GB RAM") | Write to `## Constraints`, no R# split |

## `.target.md` Sub-item Format

Sub-items live under `## Overall Objective` as bullet points:

```markdown
## Overall Objective

- JWT token authentication for login
- Refresh token support for session extension
- Integration with existing user database
```

### Format rules

- One bullet point per sub-item (single line, no nested bullets)
- Plain text description — concrete, action-oriented
- No markers during initial discussion (markers added during confirmation flow)
- Marker lifecycle: (none) → `[CONFIRMED]` → `[PROCESSED]` (see `target/SKILL.md` §Status Markers)

### Annotations (inline, parenthesized)

| Annotation | Meaning |
|------------|---------|
| `(pending detail)` | Sub-item too vague, needs user clarification before R# split |
| `(R: N)` | This sub-item has been split into N R# requirements |

Example:
```markdown
## Overall Objective

- JWT token authentication for login (R: 3)
- Refresh token support for session extension (R: 2)
- Real-time notifications (pending detail)
```

Sub-items with `(pending detail)` are **not sent to target** for R# splitting until the user provides sufficient detail.

## Update Detection

When user modifies an existing requirement, match against current sub-items:

1. **Semantic match**: Compare user's description against existing sub-items by meaning, not exact text. "Change the auth to use OAuth" matches "JWT token authentication for login"
2. **Keyword overlap**: If semantic match is ambiguous, use keyword overlap (≥50% shared significant words = likely match)
3. **Ambiguous**: If multiple sub-items could match, ask user to clarify which one
4. **No match**: Treat as new sub-item

### Update actions

| Match result | Action |
|-------------|--------|
| Exact match (same sub-item, more detail) | Update sub-item text in-place, re-invoke `target` for R# update |
| Replace (user changes direction) | Replace sub-item text, re-invoke `target` to regenerate R# for this sub-item |
| Delete ("drop X") | Remove sub-item from `## Overall Objective`, remove associated R# entries |
| No match | Append new sub-item, invoke `target` for R# split |

## Incremental R# Splitting (auto → target interface)

### Invocation

After each sub-item is written/updated in `.target.md`, auto calls target to split it into R#:

```
/task-ai:target --refine-item "<sub-item text>"
```

Note: `--refine-item` is a new argument (distinct from `--refine` which appends general refinements). See `target/SKILL.md` for handling.

### target responsibilities on `--refine-item`

1. Read the sub-item text
2. Decompose into atomic R# requirements (same atomization rules as step 3e in `target/SKILL.md`)
3. Write R# entries to `.target.md` `## Requirements` section, grouped under a sub-heading matching the sub-item
4. Update the sub-item's `(R: N)` annotation in `## Overall Objective`
5. Do NOT generate `.convergence-baseline.md` yet — that happens at final confirmation

### R# accumulation in `.target.md`

```markdown
## Requirements

### JWT token authentication for login
| # | Requirement | Acceptance Criteria | Weight |
|---|-------------|---------------------|--------|
| R1 | Token generation on login | Returns valid JWT with user_id, exp, iat claims | 3 |
| R2 | Token expiration handling | Rejects expired tokens with 401 | 3 |
| R3 | Token signature verification | Invalid signatures rejected | 3 |

### Refresh token support
| # | Requirement | Acceptance Criteria | Weight |
|---|-------------|---------------------|--------|
| R4 | Refresh token issuance | Refresh token stored securely; longer TTL | 2 |
| R5 | Refresh token rotation | Old token invalidated on use; new pair issued | 2 |
```

R# numbering is global and sequential (R1, R2, ... across all sub-items).

### Re-split on update

When a sub-item is updated, target:
1. Removes all R# entries under that sub-item's `## Requirements` sub-heading
2. Re-generates R# from the updated sub-item text
3. Re-numbers all R# globally to maintain sequential order
4. Updates `(R: N)` annotation

### Deletion

When a sub-item is removed, auto:
1. Removes the sub-item from `## Overall Objective`
2. Invokes `target --refine-item-delete "<sub-item text>"` to remove the associated `## Requirements` sub-heading, all R# entries, and re-number remaining R# globally

## Final Confirmation → `.convergence-baseline.md`

When user confirms PROMPT_TARGET_CONFIRMED, auto invokes `target` to finalize:

1. `target` reads all accumulated R# from `.target.md` `## Requirements` section
2. `target` generates `.convergence-baseline.md` with the standard format (same logic as `target/SKILL.md` §3e)
3. `target` marks all sub-items `[CONFIRMED]`
4. `target` auto-generates Stage 1 target (add `## Stage 1: <name> [ACTIVE]`)
5. `target` sets status → planning → Phase 2

This separation ensures `.convergence-baseline.md` is only generated once from a complete, confirmed set of R# — not incrementally during discussion.
