# Model Routing (Extension Point)

Sub-commands have different cognitive demands. The `model_tier` and `auto_delegatable` fields in each SKILL.md frontmatter enable the auto loop to dispatch lighter sub-commands to cheaper/faster model tiers via Task subagent, while keeping heavy reasoning skills inline.

## Tier Definitions

| Tier | Model Mapping | Cognitive Profile |
|------|--------------|-------------------|
| `heavy` | opus | Architecture reasoning, code generation, deep evaluation, judgment |
| `medium` | sonnet | Structured procedures, search + collection, conflict resolution |
| `light` | haiku | Mechanical operations, read-only queries, simple status changes |

## Routing Table

| Skill | model_tier | auto_delegatable | Rationale |
|-------|-----------|------------------|-----------|
| **plan** | heavy | false | Architecture reasoning + creative design; needs codebase deep understanding |
| **exec** | heavy | false | Code generation + multi-file implementation; needs plan/check context |
| **check** | heavy | false | Six-perspective audit + judgment; needs plan/exec implicit context |
| **auto** | heavy | — (orchestration) | Loop management + decision routing; IS the main session |
| **security** | heavy | false | Six-perspective security audit + judgment; needs plan/exec context |
| **read** | medium | true | Local document ingestion; delegates to research for supplementation |
| **merge** | medium | false | Conflict resolution needs exec context; git state is session-bound |
| **annotate** | medium | false | Cross-impact assessment needs module-wide file context |
| **verify** | medium | true | Test execution + result collection; output to `.test/` is self-contained |
| **report** | medium | true | Read all files + compose report; output to `.report.md` is self-contained |
| **target** | heavy | true | Defining objectives requires deep semantic understanding of intent |
| **research** | heavy | true | Target deepening and methodology collection require strong analysis |
| **summarize** | light | true | Read + condense; output to `.summary.md` is self-contained |
| **init** | light | true | Mechanical file creation + branch setup |
| **highlight** | medium | true | Experience distillation — structured procedures, library writes |
| **list** | light | true | Pure read-only query; no file writes |
| **cancel** | light | true | Simple status update + cleanup |
| **library** | light | true | Read-only queries (search/list/status) or mechanical maintenance; output is self-contained |

## Auto Mode Delegation Protocol

When the auto loop reaches step 2c (execute current step), it reads the target skill's `model_tier` and `auto_delegatable` fields:

- **`auto_delegatable: false`**: Execute inline (current behavior — Read SKILL.md steps, execute in main session)
- **`auto_delegatable: true`**: Invoke via Task subagent with `model = tier_to_model(model_tier)`:
  1. Subagent receives: SKILL.md content + `.summary.md` + `.index.json` + relevant input files per skill's "Reads" specification
  2. Subagent executes the numbered steps from SKILL.md, writes output files to the task module
  3. Subagent returns a <=500 char structured summary (same format as plugin delegation output contract)
  4. Main session reads the subagent summary + output files (`.auto-signal`, `.summary.md`, result files) to restore context
  5. Main session continues the auto loop from the result routing

**Context transfer**: Delegated skills communicate results through files, not session memory. This is safe because `auto_delegatable: true` skills are those whose outputs are fully captured in files (`.references/`, `.test/`, `.report.md`, `.summary.md`). The main session's context is preserved for heavy skills that need it.

**Fallback**: If a delegated subagent fails or times out, the auto loop falls back to inline execution of the same skill (same model as main session). This ensures the auto loop never blocks on a delegation failure.

**Manual mode**: Model routing only applies to auto mode's internal loop. When skills are invoked manually via Skill tool, the session's model is used as-is.
