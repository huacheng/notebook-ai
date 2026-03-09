# Complete State × Command Matrix

Every (state, sub-command) combination. `→X` = transitions to X. `=` = stays same. `⊘` = rejected (prerequisite fail). `—` = no status change.

| State ↓ \ Command → | target | plan | annotate | check post-plan | check mid-exec | check post-exec | exec | merge | report | cancel | highlight |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `(none)` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — | ⊘ | — |
| `draft` | →`planning` | →`planning` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` | — |
| `planning` | =`planning` | =`planning` | =`planning` | PASS→`review` / NEEDS_REVISION=`planning` / BLOCKED→`blocked` | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` | — |
| `review` | →`re-planning` | →`re-planning` | →`re-planning` | ⊘ | ⊘ | ⊘ | →`executing` | ⊘ | — | →`cancelled` | — |
| `executing` | =`executing` | →`re-planning` | →`re-planning` | ⊘ | CONT=`executing` / NEEDS_FIX=`executing` / REPLAN→`re-planning` / BLOCKED→`blocked` | ACCEPT=`executing` (→merge) / NEEDS_FIX=`executing` / REPLAN→`re-planning` / ROLLBACK→`evolving` | =`executing` (NEEDS_FIX fix) / →`blocked` (dependency) | →`evolving` / =`executing` (conflict) | — | →`cancelled` | — |
| `evolving` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | =`evolving` (deliverables copy only) | — (write) | →`cancelled` | — |
| `re-planning` | =`re-planning` | =`re-planning` | =`re-planning` | PASS→`review` / NEEDS_REVISION=`re-planning` / BLOCKED→`blocked` | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` | — |
| `satisfied` | →`evolving` (refine) / →`planning` (direct) | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | →`cancelled` | — |
| `blocked` | →`planning` | →`planning` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | →`cancelled` | — |
| `cancelled` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | ⊘ | — |

**Legend:** `→X` transition, `=X` self-loop (stays same status), `⊘` rejected, `—` no status change. Phase sub-state changes are not shown in this matrix — see each skill's State Transitions section for `phase` field details (e.g., `check` REPLAN sets `phase: needs-plan`; `plan`/`annotate` on `re-planning` sets `phase: needs-check`).

**Verification properties:**
- Every non-terminal state has ≥1 exit path (no deadlock)
- Terminal states: only `cancelled` (`satisfied` is non-terminal — re-enters via `target` → `planning`)
- `cancel` is available on all non-terminal states (rejected on `cancelled` only)
- `exec` requires `review` gate (cannot skip `check`)
- `merge` requires ACCEPT verdict gate (cannot skip `check post-exec`)
- `re-planning` must pass through `check` to reach `review`
- `highlight` has no state transitions — it operates as a distillation protocol without affecting notebook status
- NEEDS_FIX/NEEDS_REVISION self-loops are broken by auto signal routing (`next` field)
- `annotate` transitions depend on (file layer × annotation type). Matrix shows the most aggressive path (planning-layer modification). Full two-dimensional routing: see `skills/annotate/SKILL.md` §State Transitions
- **ROLLBACK** (v2): `check post-exec` emits ROLLBACK when convergence score ≤ previous stage baseline. Effect: `git reset --hard` to previous stage commit, status → `evolving`, stage.current decremented. The auto loop then re-enters `target` to redefine the stage approach. Convergence is computed as `Σ(wᵢ × cᵢ) / Σ(wᵢ)` from weighted R# scores in `.convergence-baseline.md`
- **satisfied re-entry**: `target` on `satisfied` state can either go directly to `planning` (shortcut) or first transition to `evolving` when the user refines the Overall Objective (convergence drops due to new/changed R#), then auto-generates next substage → `planning`
- **No inter-stage merge**: deliverables accumulate on the task branch across stages. Only `--satisfy` triggers merge to main
