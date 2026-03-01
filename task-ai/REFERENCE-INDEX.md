# task-ai Reference Index

## Entry Point

- `commands/task-ai.md` — Lifecycle hub, shared context, state machine

## Shared References (`commands/references/`)

| File | Description |
|------|-------------|
| `annotation-format.md` | Annotation JSONL format (Insert/Delete/Replace/Comment) |
| `changelog-consumption-protocol.md` | 4-step library context loading protocol |
| `concurrency.md` | Lock protocol, shared dir protection, lock ordering |
| `depends-on-format.md` | Dependency format spec and enforcement rules |
| `directory-convention.md` | Full directory tree structure and path resolution |
| `git-details.md` | Branch/commit conventions, worktree, rollback, `.gitignore` |
| `library-repo-protocol.md` | Independent git repository protocol for knowledge library |
| `library-write-protocol.md` | 6-step library write protocol, changelog format |
| `model-routing.md` | Tier definitions (heavy/medium/light), routing table |
| `state-matrix.md` | State x command matrix with all combinations |
| `summary-formats.md` | `.summary.md` table formats for experiences/references |
| `type-field.md` | Type format, auto-discovery, validation, directory-safe transform |
| `test-strategy-by-type.md` | Type → test strategy mapping (Strategy Matrix, Classification Rules, Regression Test Protocol, VFP Applicability, Phase Responsibilities) |
| `progressive-target.md` | Progressive target definition — multi-stage objective refinement |
| `verification-first-protocol.md` | VFP v1.0 — verification hypothesis lifecycle, CGG, HIL, compliance scoring |

## Skills (18)

| Skill | Description |
|-------|-------------|
| `init` | Initialize notebook working directory, git branch, optional worktree |
| `target` | **Demand Anchor** — defines objectives and requirements in .target.md |
| `read` | Knowledge Synthesizer — ingests local documents, deduplicates against library |
| `security` | Runtime Guardian — audits plans and intercepts high-risk shell commands |
| `highlight` | Experience Distillation Engine — unified protocol for experience/thinking library writes |
| `research` | Target objective deepening & lifecycle intelligence collection |
| `plan` | Generate implementation plans from `.target.md` |
| `verify` | Run domain-adapted tests, produce result files |
| `check` | Plan feasibility check at post-plan, mid-exec, post-exec checkpoints |
| `exec` | Execute implementation plan step by step |
| `merge` | Merge task branch to main with conflict resolution |
| `report` | Generate completion report, distill experience |
| `auto` | Autonomous execution loop (single-session orchestration) |
| `cancel` | Cancel task module, stop auto, optional cleanup |
| `list` | Query task status and dependency relationships (read-only) |
| `annotate` | Process Plan panel annotations (Insert/Delete/Replace/Comment) |
| `summarize` | Regenerate `.summary.md` for context recovery |
| `library` | Knowledge library management (search/list/status/maintain) |

## Skill References

### init

| File | Description |
|------|-------------|
| `references/seed-types/.summary.md` | Index of 14 seed type files (19 types) |
| `references/seed-types/ai-skill.md` | Phase Intelligence for ai-skill type |
| `references/seed-types/chip-design.md` | Phase Intelligence for chip-design type |
| `references/seed-types/data-pipeline.md` | Phase Intelligence for data-pipeline type |
| `references/seed-types/documentation.md` | Phase Intelligence for documentation type |
| `references/seed-types/dsp.md` | Phase Intelligence for dsp type |
| `references/seed-types/image-processing.md` | Phase Intelligence for image-processing type |
| `references/seed-types/infrastructure.md` | Phase Intelligence for infrastructure type |
| `references/seed-types/literary.md` | Phase Intelligence for literary type |
| `references/seed-types/mechatronics.md` | Phase Intelligence for mechatronics type |
| `references/seed-types/ml.md` | Phase Intelligence for ml type |
| `references/seed-types/science.md` | Phase Intelligence for science type |
| `references/seed-types/screenwriting.md` | Phase Intelligence for screenwriting type |
| `references/seed-types/software.md` | Phase Intelligence for software type |
| `references/seed-types/video-production.md` | Phase Intelligence for video-production type |

### plan

| File | Description |
|------|-------------|
| `references/self-audit-checklist.md` | Plan self-audit checklist for six-dimension review |
| `references/type-profiling.md` | Dynamic type profiling system, hybrid types, shared profiles |

### check

| File | Description |
|------|-------------|
| `references/six-dimension-audit.md` | Six-dimension audit framework (D1-D6) with domain adaptation |

### annotate

| File | Description |
|------|-------------|
| `references/annotation-processing.md` | Annotation triage rules, cross-impact, conflict detection |

### auto

| File | Description |
|------|-------------|
| `references/backend-api.md` | Backend API contract for auto orchestration |
| `references/context-quota.md` | Token budget management for long-running sessions |
| `references/plugin-delegation.md` | Plugin capability slots and delegation protocol |
| `references/stall-detection.md` | Execution stall detection heuristics |

### library

| File | Description |
|------|-------------|
| `references/blocked-sources.md` | Three-tier source classification (reject/high-risk/caution) |
| `references/injection-rules.md` | Ten-category injection protection rules |
| `references/quality-rubric.md` | H/M/L thinking quality self-assessment rubric |
| `references/write-protocol.md` | Per-directory lock table, hold duration, stale-lock recovery |
