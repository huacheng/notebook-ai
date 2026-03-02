# Plugin Delegation Protocol

External plugin delegation for task-ai lifecycle skills. Enables runtime discovery and invocation of system-installed plugins (PDF parsers, code review tools, frontend design tools, TDD frameworks, etc.) through **capability slots**, **semantic matching**, and **Task subagent isolation**.

## Design Principles

- **No hardcoded plugin names** — runtime semantic matching adapts to plugin install/uninstall/update
- **Task subagent isolation** — external plugins execute in isolated context; main session receives only a summary (<=500 chars)
- **Graceful degradation** — no matching plugin or invocation failure falls back to existing inline logic
- **Minimal intrusion** — each SKILL.md adds 2-4 delegation lines referencing this shared protocol

## Capability Slot Table

| Slot | Semantic Description | Lifecycle Cut-in | Trigger Condition |
|------|---------------------|------------------|-------------------|
| `doc-parse` | Parse non-text documents (.pdf/.docx/.xlsx/.pptx) to markdown | research step 12 | Research source is a binary document file |
| `brainstorm` | Explore design space, generate alternatives, challenge assumptions | plan step 14 | First plan generation (no `.plan.md` yet) |
| `code-review` | Static analysis, style audit, security scan, best-practice review | check step 9 | post-exec checkpoint |
| `frontend-design` | UI/UX patterns, component architecture, accessibility guidance | exec Per-Step step 2 | `type` contains `frontend`, `web`, or `ui` |
| `debugging` | Root cause analysis, trace interpretation, fix strategy | exec Per-Step step 2 | `type` contains `bugfix` or NEEDS_FIX resumption |
| `tdd` | Test generation, coverage analysis, test-driven implementation | verify step 9 | `type` contains `software` and `.test/` criteria exist |
| `domain-*` | Open-ended domain expertise (wildcard — any specialized capability) | exec Per-Step step 2 | No seed slot matches; semantic scan against all available plugins |

## Three-Level Discovery Algorithm

When a lifecycle skill reaches a delegation point, discover matching plugins in this order:

### Level 1: Seed Slot Check

Match the current context against the 6 named slots above (`doc-parse` through `tdd`). Use the Trigger Condition column — if the condition is met, attempt to find a plugin matching the slot's Semantic Description.

**How to find plugins**: Use the system's available skill/tool list (the agent's installed plugins, MCP tools, slash commands). Match by semantic similarity between the slot description and the plugin's declared description/name.

### Level 2: Registry Lookup

Read `$NB_WORKSPACES_LIBRARY/.plugin-registry.md` if it exists. Check if a previously discovered capability slot matches the current context. Registry entries include the last-matched plugin name — try that plugin first for faster resolution.

**Stale entry detection**: Before invoking a registry-recommended plugin, verify it exists in the current available skill/tool list. If the plugin is no longer available (uninstalled/renamed), mark the entry as `(stale)` in the `Last Matched Plugin` column. After 3 cumulative stale detections for the same entry (across any tasks), remove the row from the registry. This prevents accumulation of entries for uninstalled plugins while tolerating transient unavailability.

### Level 3: Domain-* Semantic Scan

If no seed slot matched AND no registry entry matched, perform a broad semantic scan:
1. Describe the current step's needs in 1-2 sentences
2. Scan all available plugins/tools for semantic relevance
3. If a match is found with confidence >= medium:
   - Invoke via Task subagent (see invocation template below)
   - **Register** the new capability as a named slot in `$NB_WORKSPACES_LIBRARY/.plugin-registry.md`
   - New slot name: `domain-<kebab-case-description>` (e.g., `domain-audio-mastering`)

### Discovery Result

| Outcome | Action |
|---------|--------|
| Match found | Invoke via Task subagent |
| No match | Skip delegation, continue with inline logic. **Cache the negative result**: write a `(none)` entry to `.plugin-registry.md` for the attempted slot + type combination (e.g., `tdd` + `software` → `(none)`). Subsequent discovery attempts for the same slot + type skip Level 3 scan entirely |
| Multiple matches | Select using **health-weighted scoring** (see Plugin Selection below) |

### Plugin Selection (Health-Weighted)

When multiple plugins match, select based on combined relevance and health score:

```
combinedScore = 0.7 × relevanceScore + 0.3 × healthScore
```

**Health Score Components**:
- **60%** Success rate (invocations that returned usable results)
- **30%** Average confidence (high=1.0, medium=0.6, low=0.3)
- **10%** Trend bonus (improving: +0.05, declining: -0.05, stable: 0)

**Sample Penalty**: Plugins with < 5 invocations have scores shrunk toward 0.5 (neutral).

**Implementation Reference**: `packages/server/src/task-ai/plugin-health.ts`

**Negative cache expiry**: `(none)` entries are valid for the current task only. On `init` of a new task, the registry is NOT cleared (capabilities are persistent), but `(none)` entries are ignored when the available skill/tool list has changed (checked at Level 2 by comparing the current available plugin count against the count stored in the `(none)` entry).

## Runtime Capability Registry

File: `$NB_WORKSPACES_LIBRARY/.plugin-registry.md`

Created on first successful delegation. Updated on each new capability discovery. Shared across all task modules.

```markdown
# Plugin Capability Registry

| Slot | Semantic Description | Applicable Phases | Type Pattern | Last Matched Plugin | Updated |
|------|---------------------|-------------------|--------------|--------------------:|---------|
| doc-parse | Parse binary documents to markdown | research | * | document-skills:pdf | 2024-01-15 |
| frontend-design | UI/UX component guidance | exec | frontend|web|ui | frontend-design:frontend-design | 2024-01-20 |
| domain-audio-mastering | Audio loudness and EQ optimization | exec | dsp | example-audio-master | 2024-01-22 |
```

**Write protection**: Acquire `$NB_WORKSPACES_LIBRARY/.memory/.references/.lock` before writing. Reuses the existing references lock to avoid proliferating lock files — the registry is a lightweight companion to `.memory/.references/`.

**Re-entrancy rule**: If the calling skill already holds `$NB_WORKSPACES_LIBRARY/.memory/.references/.lock` (e.g., `research` during steps 11-14), the registry update MUST be batched — accumulate pending registry writes in memory and flush them before releasing the existing lock. Do NOT attempt a second lock acquisition (same-process re-entrant acquire would self-REJECT). Skills that do NOT hold the references lock (e.g., `exec`, `check`, `verify`) acquire the lock normally for registry writes.

## Task Subagent Invocation Template

All plugin delegations execute through the Task tool with a subagent, isolating external plugin output from the main session context.

### Dynamic Context Budget

Input and output limits vary by slot and model tier:

| Slot | Input Limit | Output Limit | Allow Overflow |
|------|-------------|--------------|----------------|
| `doc-parse` | 1000 | 2000 | yes |
| `brainstorm` | 3000 | 800 | yes |
| `code-review` | 8000 | 1000 | yes |
| `frontend-design` | 2000 | 600 | no |
| `debugging` | 4000 | 800 | yes |
| `tdd` | 3000 | 600 | no |
| `domain-*` | 2000 | 500 | no |

**Tier Multipliers**: heavy (1.5×), medium (1.0×), light (0.7×)

**Smart Truncation**: When input exceeds limit, preserve 40% head + tail with `[N chars omitted]` marker. For git diffs, prioritize `+`/`-` lines over context.

**Implementation Reference**: `packages/server/src/task-ai/context-budget.ts`

### Input Contract

```
Task subagent prompt:

You have access to the [{plugin_name}] skill/tool.

**Task context**:
- Module: {module_name}
- Type: {task_type}
- Current phase: {phase} (plan/check/exec/verify/research)
- Step: {step_description}

**Capability request** ({slot_name}):
{1-3 sentence description of what is needed}

**Input data**:
{Relevant excerpt: file path, git diff summary, code snippet, or document path — keep under 2000 chars}

**Instructions**:
1. Invoke the [{plugin_name}] skill/tool with the input data
2. Analyze the result
3. Return a structured summary (see output format below)

**Output format** (strict, <=500 chars total):
## Findings
- [Key finding 1]
- [Key finding 2]

## Action Items
- [Concrete actionable item 1]
- [Concrete actionable item 2]

## Confidence
[high/medium/low] — [1-sentence rationale]
```

### Output Contract

The subagent returns a structured summary with three sections:

| Section | Content | Limit |
|---------|---------|-------|
| **Findings** | Key observations from the plugin output | 2-4 bullet points |
| **Action Items** | Concrete, actionable recommendations | 1-3 bullet points |
| **Confidence** | `high` / `medium` / `low` with 1-sentence rationale | 1 line |

Total output: <=500 characters. The calling skill incorporates this as supplementary input.

### Output Processing (Sanitization)

Before incorporating subagent output into the main session, apply sanitization to prevent injection attacks:

```typescript
import { sanitizePluginOutput } from 'packages/server/src/task-ai/plugin-sanitizer';

const result = sanitizePluginOutput(rawSubagentOutput);

if (result.risk_level === 'high') {
  // Log to .notes/<date>-delegate-<slot>-sanitized.md
  // Force Confidence: low regardless of subagent's claimed confidence
}
```

**Sanitization Categories** (10 active threat patterns):

| # | Category | Detection | Risk |
|---|----------|-----------|------|
| 1 | Direct instruction injection | `<!-- -->`, `<system>`, "ignore previous" | high |
| 3 | Unicode hidden attacks | Zero-width chars, bidirectional control | medium |
| 4 | ANSI terminal sequences | `\x1b[...` escape codes | medium |
| 5 | Resource exhaustion | Output > 600 chars | low |
| 6 | System format impersonation | `{"step":`, `.auto-signal`, `task-ai(` | high |
| 7 | Encoding obfuscation | `base64 -d`, hex sequences | high |
| 8 | Two-stage loading | `curl \|`, `wget \|`, `eval(` | high |
| 10 | Command injection | `--require=`, `--eval=`, `LD_PRELOAD` | high |

**Risk Level Handling**:

| Risk Level | Action |
|------------|--------|
| `high` | Log sanitization event, force Confidence: low, proceed with sanitized output |
| `medium` | Log warning, proceed normally with sanitized output |
| `low`/`none` | Proceed normally |

**Implementation Reference**: `packages/server/src/task-ai/plugin-sanitizer.ts`

## Retry Strategy

Plugin invocations use error-aware retry logic:

| Error Category | Max Retries | Backoff |
|----------------|-------------|---------|
| Network (`ECONNREFUSED`, `ETIMEDOUT`) | 2 | 1000ms × attempt |
| Timeout | 2 | 2000ms × attempt |
| Empty result | 1 | 500ms |
| Format error (JSON parse) | 0 | — |
| Plugin error | 0 | — |
| Unknown | 0 | — |

**Slot Timeouts**:

| Slot | Timeout |
|------|---------|
| `doc-parse` | 60s |
| `code-review`, `debugging` | 45s |
| `brainstorm`, `tdd` | 35s |
| Others | 30s |

**Implementation Reference**: `packages/server/src/task-ai/plugin-retry.ts`

## Degradation Rules

| Scenario | Behavior |
|----------|----------|
| No matching plugin found | Skip delegation entirely — continue with inline logic |
| Plugin invocation fails after retries | Log failure to `.notes/<date>-delegate-<slot>-failed.md`, update health record, continue with inline logic |
| Low confidence result | Use as supplementary input only — do not override inline decisions |
| Medium confidence result | Integrate into decision-making alongside inline analysis |
| High confidence result | Treat as primary guidance for the delegated capability |

**Never block on delegation failure.** The lifecycle must always be able to complete without any external plugins.

## Doc-Parse Routing

When `research` step 12 encounters a non-text document, route by file extension:

| Extension | Target Slot | Semantic Match Keywords |
|-----------|-------------|------------------------|
| `.pdf` | `doc-parse` | PDF, parse, extract, read |
| `.docx` | `doc-parse` | Word, document, docx, extract |
| `.xlsx` | `doc-parse` | Excel, spreadsheet, xlsx, extract |
| `.pptx` | `doc-parse` | PowerPoint, presentation, pptx, extract |

**Routing logic**:
1. Detect file extension from the research source path
2. If extension matches table above, attempt Level 1 discovery for `doc-parse` slot
3. If matched plugin found, invoke via Task subagent with the file path as input
4. Plugin converts document to markdown; research proceeds with the markdown output
5. If no matching plugin: skip and note `"Binary file <name> skipped — no parser plugin available"` in the reference file

## Result Persistence

Delegation results (both successes and failures) are persisted for traceability:

| Outcome | File | Content |
|---------|------|---------|
| Success | `.working/.notes/<YYYY-MM-DD>-delegate-<slot>.md` | Slot, plugin, findings, action items, confidence |
| Failure | `.working/.notes/<YYYY-MM-DD>-delegate-<slot>-failed.md` | Slot, plugin (if identified), error description |

After writing, update `.notes/.summary.md` per standard protocol.

## Integration Summary

Each lifecycle skill adds a small delegation check at its designated cut-in point:

| Skill | Cut-in Step | Slot(s) | Condition |
|-------|-------------|---------|-----------|
| research | step 12 | `doc-parse` | Source file is .pdf/.docx/.xlsx/.pptx |
| plan | step 14 | `brainstorm` | First plan (no `.plan.md`) |
| exec | Per-Step step 2 | `frontend-design`, `debugging`, `tdd`, `domain-*` | Type/context match (see trigger conditions per slot) |
| check | step 9 | `code-review` | post-exec checkpoint |
| verify | step 9 | `tdd` | `type` contains `software` and `.test/` criteria exist (also checked by exec) |

## Delegation Metrics

All delegation events are recorded for observability and health tracking:

**Event File**: `$NB_WORKSPACES_LIBRARY/.delegation-events.jsonl`

**Event Structure**:
```json
{
  "id": "evt-001",
  "timestamp": "2024-01-15T10:00:00Z",
  "notebook": "my-task",
  "slot": "code-review",
  "plugin": "superpowers:code-review",
  "confidence": "high",
  "actionItems": ["Fix bug", "Add test"],
  "latencyMs": 1500
}
```

**Outcome Structure** (recorded after action items are processed):
```json
{
  "delegationId": "evt-001",
  "adoptedItems": 2,
  "totalItems": 2,
  "contributedToReplan": false
}
```

**Aggregated Metrics** (via `library status`):
- `totalCalls` — invocation count per slot/plugin
- `adoptedRate` — percentage of action items adopted
- `replanContributions` — count of delegations that led to REPLAN
- `avgLatencyMs` — average invocation latency

**Implementation Reference**: `packages/server/src/task-ai/delegation-metrics.ts`

## User Preferences

Users can customize delegation behavior via `~/.claude/settings.json`:

```json
{
  "task-ai": {
    "plugin-delegation": {
      "slotBindings": { "code-review": "superpowers:code-review" },
      "disabledPlugins": ["untrusted:plugin"],
      "disabledSlots": ["domain-*"],
      "confidenceThreshold": "medium",
      "trustLevelMinimum": "verified"
    }
  }
}
```

| Setting | Effect |
|---------|--------|
| `slotBindings` | Force specific plugin for a slot (bypass discovery) |
| `disabledPlugins` | Never use these plugins |
| `disabledSlots` | Skip delegation for these slots entirely |
| `confidenceThreshold` | Ignore results below this level |
| `trustLevelMinimum` | Only use plugins meeting trust criteria |

**Implementation Reference**: `packages/server/src/task-ai/plugin-preferences.ts`
