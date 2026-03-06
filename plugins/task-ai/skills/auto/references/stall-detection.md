# Stall Detection & Recovery

The agent may stall mid-execution (e.g., context window overflow prompt, waiting for user input, or internal hang). The daemon MUST actively detect and recover from stalls.

## Heartbeat Polling

The daemon runs a periodic heartbeat (every 60 seconds) while an auto loop is active. Detection is based on the **stream-json output** from the agent process:

1. Track the timestamp of the last received stream-json message (any type: `assistant`, `tool_use`, `tool_result`, `result`, etc.)
2. Compute `idle_seconds = now - last_message_timestamp`
3. Track consecutive heartbeat polls where `idle_seconds >= 60` as `stall_count`

## Stall Determination

| `stall_count` | Stream Status | Verdict |
|---------------|--------------|---------|
| < 3 | — | Normal (the agent may be thinking/working) |
| >= 3 | No stream-json output for >= 3 polls (>= 3 minutes) | Stall suspected → run pattern match |

A stall is only suspected after **3 consecutive idle heartbeats** (>= 3 minutes at 60s interval). This avoids false positives from long-running steps.

## Pattern Matching Recovery

When stall is suspected, check the **last stream-json messages** for known stall patterns:

| Pattern | Detection | Recovery Action |
|---------|-----------|-----------------|
| Continuation prompt | Last `assistant` message ends with or contains `Continue?`, `press enter`, `Press Enter to continue`, `to continue` (case-insensitive). Note: bare `continue` alone is too common — require it to appear as a question or prompt suffix to avoid false positives | Send `{"type":"human","message":"continue"}` via stream-json stdin |
| Yes/No prompt | Last `assistant` message contains `(y/n)`, `(Y/N)`, `[y/N]`, `[Y/n]` | Send `{"type":"human","message":"y"}` via stream-json stdin |
| Proceed prompt | Last `assistant` message contains `Do you want to proceed`, `Shall I continue` | Send `{"type":"human","message":"yes"}` via stream-json stdin |
| Process exited | `ClaudeProcess` emits `close` event or stream ends | Agent session ended unexpectedly → restart auto session (see Server Recovery in `backend-api.md`) |
| **Quota exhausted** | Last `assistant` or `system` message contains `rate limit`, `quota exceeded`, `usage limit`, `token limit`, `try again later` (case-insensitive) | **NOT a stall** — reset `stall_count` to 0, enter quota-wait mode (see `context-quota.md`) |
| No recognizable pattern | — | Log warning, continue polling (stall_count remains elevated from idle detection — no explicit increment needed here) |

## Content-Level Detection

Time-based idle detection misses scenarios where Claude produces output but makes no progress (reasoning loops, repeated responses). These require content-level analysis:

### Output Deduplication

Track hashes of recent `assistant` stream-json messages:

1. Maintain a rolling window of the last 5 `assistant` message content hashes
2. If 3 consecutive hashes are identical → suspected reasoning loop
3. Recovery: send `{"type":"human","message":"You appear to be in a loop. Stop current approach. Re-read .auto-signal and .status.json to determine your next step, then proceed."}` via stream-json stdin
4. If dedup recovery fails three times consecutively → write `.auto-stop` with reason `"reasoning_loop"`

### Single-Step Timeout

Monitor `.auto-signal` file timestamp independently of stream activity:

1. Record `last_signal_update = mtime(.auto-signal)` on each `fs.watch` event
2. If `now - last_signal_update > 10 minutes` AND stream is still active → step is taking too long
3. Recovery: send `{"type":"human","message":"Current step has exceeded 10 minutes without signal update. Write .auto-signal with current progress and either complete or skip to next step."}` via stream-json stdin
4. If no signal update within 3 minutes after prompt → increment stall recovery count (same limits as idle recovery)

### Combined Detection Priority

| Priority | Detection | Condition | Action |
|----------|-----------|-----------|--------|
| 1 | Quota exhaustion | Message contains rate limit keywords | Enter quota-wait (NOT a stall) |
| 2 | Process exit | Stream ended | Restart session |
| 3 | Output dedup | 3 identical consecutive hashes | Send loop-break prompt |
| 4 | Single-step timeout | Signal unchanged > 10min | Send timeout prompt |
| 5 | Idle detection | No output > 3min | Pattern match recovery |
| 6 | No pattern match | Idle but unrecognizable | Log + continue polling |

## Recovery Limits

| Limit | Value | Action on Exceed |
|-------|-------|-----------------|
| Max recoveries per step | 3 | Write `.auto-stop` with reason `"stall_limit"` |
| Max total recoveries | 10 | Write `.auto-stop` with reason `"stall_limit"` |

Recovery counts are tracked in SQLite (see `backend-api.md` §SQLite State). `recovery_count_step` (per-step stall recoveries) resets on each new `.auto-signal` receipt; `recovery_count_total` persists across the entire auto session and does NOT reset. Note: these are stall-recovery counters, distinct from `.auto-signal`'s `retry_count` (which tracks check-triggered retries at a given checkpoint).
