# Complete State × Command Matrix

Every (state, sub-command) combination. `→X` = transitions to X. `=` = stays same. `⊘` = rejected (prerequisite fail). `—` = no status change.

| State ↓ \ Command → | target | plan | annotate | check post-plan | check mid-exec | check post-exec | exec | merge | report | cancel | light |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `(none)` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — | ⊘ | — |
| `draft` | →`planning` | →`planning` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` | — |
| `planning` | =`planning` | =`planning` | =`planning` | PASS→`review` / NEEDS_REVISION=`planning` / BLOCKED→`blocked` | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` | — |
| `review` | →`re-planning` | →`re-planning` | →`re-planning` | ⊘ | ⊘ | ⊘ | →`executing` | ⊘ | — | →`cancelled` | — |
| `executing` | =`executing` | →`re-planning` | →`re-planning` | ⊘ | CONT=`executing` / NEEDS_FIX=`executing` / REPLAN→`re-planning` / BLOCKED→`blocked` | ACCEPT=`executing` (signal→merge) / NEEDS_FIX=`executing` / REPLAN→`re-planning` | =`executing` (NEEDS_FIX fix) / →`blocked` (dependency) | →`complete` / =`executing` (conflict) | — | →`cancelled` | — |
| `re-planning` | =`re-planning` | =`re-planning` | =`re-planning` | PASS→`review` / NEEDS_REVISION=`re-planning` / BLOCKED→`blocked` | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` | — |
| `complete` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | ⊘ | — |
| `blocked` | →`planning` | →`planning` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | →`cancelled` | — |
| `cancelled` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | ⊘ | — |

**Legend:** `→X` transition, `=X` self-loop (stays same status), `⊘` rejected, `—` no status change. Phase sub-state changes are not shown in this matrix — see each skill's State Transitions section for `phase` field details (e.g., `check` REPLAN sets `phase: needs-plan`; `plan`/`annotate` on `re-planning` sets `phase: needs-check`).

**Verification properties:**
- Every non-terminal state has ≥1 exit path (no deadlock)
- Terminal states: only `complete` and `cancelled`
- `cancel` is available on all non-terminal states (rejected on `complete` and `cancelled`)
- `exec` requires `review` gate (cannot skip `check`)
- `merge` requires ACCEPT verdict gate (cannot skip `check post-exec`)
- `re-planning` must pass through `check` to reach `review`
- `light` has no state transitions — it operates inline on the current branch
- NEEDS_FIX/NEEDS_REVISION self-loops are broken by auto signal routing (`next` field)
