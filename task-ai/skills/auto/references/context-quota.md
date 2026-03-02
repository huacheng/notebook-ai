# Context Window Management & Quota Exhaustion Handling

## Context Window Management

The auto loop runs in a single long-lived the agent session. As the conversation accumulates, context window usage grows. The strategy is **single active compaction + file-based recovery**:

### Compaction Strategy

1. **First compaction at ≥ 82%**: Before each iteration (loop step 3.2), check context usage. At **≥ 82%** AND `compaction_count == 0`, construct and send the **Structured Compaction Prompt** (see template in main SKILL.md)
2. **No subsequent active compaction**: After the first compaction (`compaction_count >= 1`), do NOT trigger additional active compactions regardless of usage level. This prevents compaction cascades that lose context continuity
3. **Safety net**: Each sub-command writes `.summary.md` with a **Recovery Header** (see below), providing condensed recovery context
4. **System compaction handling**: If Claude's system compaction occurs (≥95% threshold, uncontrollable), the daemon detects it and sends a recovery signal (see Daemon Compaction Detection below)

### Recovery Header for .summary.md

All sub-commands MUST prepend this header when writing `.summary.md`:

```markdown
<!-- TASK-AI RECOVERY CONTEXT -->
<!-- If you see this after context compaction, execute recovery protocol: -->
<!-- 1. Read .auto-signal for loop position -->
<!-- 2. Read .index.json for status -->
<!-- 3. Resume from `next` step -->

# Task: {notebook_name}
**Status**: {status} | **Phase**: {phase} | **Next**: {next_step}
**Branch**: {branch}

---

{original summary content}
```

This ensures the agent can self-recover after any compaction event.

### Post-compaction Recovery

After compaction (either active or system), the agent re-reads:
- `.auto-signal` — iteration + step position
- `.index.json` — status
- `.summary.md` — task context (Recovery Header provides quick orientation)

See "Compaction recovery" in Context Advantage section of main SKILL.md.

## Daemon Compaction Detection

The daemon monitors Claude's stream-json output for system compaction events and sends recovery signals.

### Detection Patterns

```typescript
const COMPACTION_INDICATORS = [
  'ran out of context',
  'conversation that ran out of context',
  'context window limit',
  'session is being continued',
];

function detectCompaction(output: string): boolean {
  const lower = output.toLowerCase();
  return COMPACTION_INDICATORS.some(indicator =>
    lower.includes(indicator.toLowerCase())
  );
}
```

### Recovery Signal

When compaction is detected, the daemon sends:

```json
{
  "type": "human",
  "message": "Context compacted by system. Execute recovery protocol:\n\n1. Read {workingDir}/.auto-signal — get iteration, step, next\n2. Read {workingDir}/.index.json — confirm status\n3. Read {workingDir}/.summary.md — restore task context\n4. Resume auto loop from `next` step\n\nDo NOT ask for confirmation. Execute recovery and continue."
}
```

### Implementation Reference

See `packages/server/src/task-ai/compaction-strategy.ts` for:
- `shouldCompact(usage, compactionCount)` — compaction decision logic
- `detectCompaction(output)` — system compaction detection
- `buildRecoverySignal(workingDir)` — recovery signal construction
- `validateRecoveryReadiness(workingDir)` — validate recovery files exist

## Quota Exhaustion Handling

When the agent's API quota (token usage / rate limit) is exhausted mid-auto-loop, this is **NOT a stall** and must be handled differently:

### Daemon Behavior

Detection is based on the **stream-json output** from `ClaudeProcess`:

1. **Detection**: Monitor stream-json messages for quota-related content (`rate limit`, `quota exceeded`, `usage limit`, etc.) in `assistant` or `system` message types
2. **Enter quota-wait mode**: Reset `stall_count` to 0, pause stall detection timers
3. **Suspend timeout**: Quota-wait time does **NOT** count toward `timeoutMinutes`. The daemon pauses the timeout clock while in quota-wait mode
4. **Continue heartbeat**: Keep polling at 60s interval, but only check for quota recovery (new stream-json messages arriving) — do not apply stall determination logic
5. **Exit quota-wait**: When heartbeat detects new stream-json output (the agent resumed), restore normal monitoring and resume timeout clock

### the agent Behavior

- the agent automatically waits and retries when quota is exhausted — no special handling needed inside the auto loop
- The auto loop resumes naturally when quota resets

### SQLite Extension

```sql
ALTER TABLE task_auto ADD COLUMN quota_wait_since TEXT DEFAULT '';
```

- Set to ISO 8601 timestamp when entering quota-wait mode, cleared when exiting
- `timeoutMinutes` enforcement subtracts total quota-wait duration from elapsed time
