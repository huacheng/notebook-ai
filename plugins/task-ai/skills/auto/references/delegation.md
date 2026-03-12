# Subagent Delegation

Referenced from `auto/SKILL.md` §Subagent Delegation.

## Dynamic Judgment (Not Static)

SKILL.md `auto_delegatable` and `model_tier` are **default hints**. Actual delegation decisions are made dynamically by the auto main session based on context.

### Judgment Factors & Signal Sources

| Factor | Signal Source | Logic | Example |
|--------|-------------|-------|---------|
| **Current phase** | `.status.json` status | Different status → different delegation strategy for same sub-command | status=draft: research NOT delegated (O1/O2/O3 need dialog); status=planning: research CAN delegate |
| **Context dependency** | (1) Unpersisted decisions in dialog (2) `.summary.md` freshness (3) `git diff --stat` from prior steps | High dependency → don't delegate | exec just refactored 5 files + dialog tradeoffs → verify inline; exec changed 1 file + no discussion → verify can delegate |
| **Task complexity** | (1) `.plan.md` step description length + file count (2) Test type (unit/integration/e2e) (3) `.target.md` complexity markers | Simple → light tier; Complex → medium/heavy | verify runs lint → haiku; verify runs e2e → sonnet |
| **Execution history** | In-memory `delegation_failures` array | Same sub-command failed as subagent before → inline from now on | `delegation_failures: ["verify@iter3"]` → verify never delegates again |

### Sub-command Default Hints & Dynamic Overrides

**heavy (→ opus)**

| Sub-command | Default delegatable | Default tier | Dynamic override |
|-------------|-------------------|-------------|-----------------|
| auto | — | heavy | Main session itself |
| target | false | heavy | Always inline (dialog interaction) |
| research | true | heavy | target phase O1/O2/O3 → inline (needs dialog); planning phase reference collection → can delegate |
| plan | false | heavy | Always inline (needs decision context) |
| check | false | heavy | Always inline (needs global context for four-file anchored review) |
| exec | false | heavy | Always inline (step-by-step needs main session context) |
| security | true | heavy | Usually can delegate; context-dependent security analysis → inline |

**medium (→ sonnet)**

| Sub-command | Default delegatable | Default tier | Dynamic override |
|-------------|-------------------|-------------|-----------------|
| verify | true | medium | exec has complex context dependency → inline; simple lint → tier down to light |
| highlight | true | medium | Usually can delegate |
| report | true | medium | Usually can delegate |
| read | true | medium | Usually can delegate |
| annotate | false | medium | Needs interactive mode for High-impact responses; lock acquisition context-dependent |

**light (→ haiku)**

| Sub-command | Default delegatable | Default tier | Dynamic override |
|-------------|-------------------|-------------|-----------------|
| init | true | light | Frontend already executes, auto not involved |
| list | true | light | Read-only query, usually can delegate |
| cancel | true | light | Usually can delegate |
| summarize | true | light | Usually can delegate |
| library | true | light | Usually can delegate |

### Model Mapping

```
model_tier → model
  heavy  → opus
  medium → sonnet
  light  → haiku
```

### Executor Plugin Delegation

Beyond subagent delegation of individual sub-commands, exec supports **executor plugin delegation** — discovering and using execution engine plugins (e.g., `superpowers:subagent-driven-development`) to replace the default per-step inline loop. See `references/plugin-delegation.md` §Executor Slot Table.

This enables adaptive execution strategies:
- Software tasks with clear test criteria → `subagent-driven-development` (fresh subagent per step + two-stage review)
- Documentation tasks → domain-specific doc builder plugin
- Any task type → if the plugin registry records a high-health executor for the type, use it

The exec sub-command handles executor discovery at step 7 (before per-step loop). Auto mode does not need special handling — exec's executor delegation is transparent to auto's routing logic.

### Fault Tolerance

- Subagent timeout → main session fallback to inline execution
  - Timeout by tier: light 2min / medium 5min / heavy 10min
- Subagent execution failure → fallback to inline
- Subagent output files missing → alert + fallback
- Subagent writes unexpected fields → main session only trusts subagent-scope fields (outputs + `result`/`next`); `phase`/`retry_count`/`check_score` maintained by main session
- Executor plugin failure mid-execution → exec falls back to native per-step loop, resuming from `completed_steps + 1`

### Context Savings

```
Full inline:    target(dialog) + plan + check + exec + verify*N + check*N + highlight + report
                → main session context grows continuously, may trigger multiple compactions

Delegation:     target(dialog) + plan + check + exec + [verify→subagent] + check + [highlight→subagent] + [report→subagent]
                → main session keeps only decision path, delegated output flows back as summaries
```
