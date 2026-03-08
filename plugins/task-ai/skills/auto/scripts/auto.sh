#!/usr/bin/env bash
# /task-ai:auto implementation
# Usage: auto.sh [--stop]
# Notebook is auto-detected from CWD or git branch context.

set -euo pipefail
# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"
source "$SCRIPT_DIR/signal-writer.sh"

# Derive conversational phase from .status.json status
derive_phase() {
    local status="$1"
    case "$status" in
        draft) echo "target" ;;
        planning|re-planning) echo "planning" ;;
        review|executing) echo "execution" ;;
        blocked) echo "execution" ;;
        evolving|satisfied) echo "finalization" ;;
        cancelled) echo "terminal" ;;  # Not in signal validation whitelist; auto exits before writing signal
        *) echo "unknown" ;;
    esac
}

ACTION="start"  # Default action
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stop)   ACTION="stop"; shift ;;
    *) echo "[ERROR] Unknown option: $1" >&2; exit 1 ;;
  esac
done

resolve_workdir ""
STATUS_JSON="$WORK_DIR/.status.json"
SIGNAL_FILE="$WORK_DIR/.auto-signal"
STOP_FILE="$WORK_DIR/.auto-stop"
# D6: Use SCRIPT_DIR for consistent path construction
STATE_PY="$SCRIPT_DIR/../../../core/state.py"
STATE_PY="$(cd "$(dirname "$STATE_PY")" && pwd)/$(basename "$STATE_PY")"

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

# D3: Check state.py existence before calling
if [[ ! -f "$STATE_PY" ]]; then
    echo "[ERROR] state.py not found: $STATE_PY" >&2
    exit 1
fi

# 1. Handle ACTION parameter (D1: per SKILL.md)
case "$ACTION" in
    stop)
        # D3-2: Write .auto-stop for graceful termination
        # D2: Use python for safe JSON writing (no shell interpolation in Python)
        echo "[AUTO] Stopping auto loop..."
        python3 - "$STOP_FILE" <<'PYEOF'
import json, sys, os
from datetime import datetime, timezone
tmp = sys.argv[1] + '.tmp'
with open(tmp, 'w') as f:
    json.dump({'reason': 'user_stop', 'timestamp': datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}, f, indent=2)
os.rename(tmp, sys.argv[1])
PYEOF
        # D3: Do NOT delete .auto-signal here — let the running loop detect .auto-stop and clean up
        echo "Auto loop stop requested."
        exit 0
        ;;
    start)
        # Continue with normal auto loop
        ;;
esac

# 2. Entry Point Routing (per SKILL.md §Entry Point)
# D3: python3 call with error handling
STATUS=$(python3 "$STATE_PY" get "$STATUS_JSON" status 2>/dev/null || echo "unknown")
PHASE=$(derive_phase "$STATUS")
echo "Auto-mode: Starting loop from status: $STATUS (phase: $PHASE)"

# 3. Determine next step based on status (D1-1: handle all statuses per SKILL.md)
# D3: Recover iteration/compaction from existing signal if resuming
# D4: Single python3 call to parse both fields (avoid reading file twice)
ITERATION=1
COMPACTION=0
if [[ -f "$SIGNAL_FILE" ]]; then
    SIGNAL_RECOVERY=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    print(d.get('iteration', 1), d.get('compaction_count', 0))
except Exception:
    print('1 0')
" "$SIGNAL_FILE" 2>/dev/null || echo "1 0")
    ITERATION=$(echo "$SIGNAL_RECOVERY" | awk '{print $1}')
    COMPACTION=$(echo "$SIGNAL_RECOVERY" | awk '{print $2}')
    # D3: Validate recovered values are integers, fall back to defaults
    [[ "$ITERATION" =~ ^[0-9]+$ ]] || ITERATION=1
    [[ "$COMPACTION" =~ ^[0-9]+$ ]] || COMPACTION=0
    # D3: Increment compaction count on recovery (per SKILL.md: "On compaction recovery, incremented by 1")
    COMPACTION=$((COMPACTION + 1))
    # D3: Enforce compaction frequency limit (>= 3 within same auto session → stop)
    if [[ "$COMPACTION" -ge 3 ]]; then
        echo "[ERROR] Compaction frequency limit reached ($COMPACTION compactions). Context may be too large for this task." >&2
        echo '{"stop_reason":"compaction_frequency_limit","compaction_count":'"$COMPACTION"'}' > "$WORK_DIR/.auto-stop"
        exit 1
    fi
fi

case "$STATUS" in
  draft)
    # Phase 1: Check target status before routing
    TARGET_MD="$WORK_DIR/.target.md"
    if [[ -f "$TARGET_MD" ]]; then
        # D1: Validate substantive content before any routing (per SKILL.md §Entry Point)
        if [[ ! -s "$TARGET_MD" ]] || ! grep -qE '^##' "$TARGET_MD"; then
            echo "[ERROR] .target.md is empty or has no sections — fill target before running auto"
            exit 1
        fi
        if grep -q '\[PROPOSED\]' "$TARGET_MD"; then
            echo "[PAUSE] Pending [PROPOSED] items in .target.md — review and confirm before continuing"
            exit 0
        elif ! grep -q '## Research Insights' "$TARGET_MD" || \
             [ "$(sed -n '/## Research Insights/,/^## /{ /^## /d; /^[[:space:]]*$/d; p; }' "$TARGET_MD" | wc -l)" -eq 0 ]; then
            STEP="research"
            RESULT="(collected)"
            NEXT_STEP="(stop)"
        else
            STEP="plan"
            RESULT="(generated)"
            NEXT_STEP="check"
        fi
    else
        echo "[ERROR] .target.md not found — create target before running auto"
        exit 1
    fi
    ;;
  planning)
    # Phase 2: Verify plan
    STEP="verify"
    RESULT="(pass)"
    NEXT_STEP="check"
    ;;
  re-planning)
    # Phase 2: Check phase field to determine sub-step
    RE_PHASE=$(python3 "$STATE_PY" get "$STATUS_JSON" phase 2>/dev/null || echo "")
    case "$RE_PHASE" in
      needs-check)
        STEP="verify"
        RESULT="(pass)"
        NEXT_STEP="check"
        ;;
      needs-plan|*)
        # D1: Explicitly match needs-plan per SKILL.md §Entry Point; empty/unknown defaults to plan
        STEP="plan"
        RESULT="(generated)"
        NEXT_STEP="check"
        ;;
    esac
    ;;
  review)
    # Phase 3: Plan reviewed, execute
    STEP="exec"
    RESULT="(done)"
    NEXT_STEP="verify"
    ;;
  executing)
    # Phase 3: Verify execution results
    STEP="verify"
    RESULT="(pass)"
    NEXT_STEP="check"
    ;;
  satisfied)
    # Phase 4: Generate report, then stop
    STEP="report"
    RESULT="(generated)"
    NEXT_STEP="(stop)"
    ;;
  evolving)
    # Phase 4: Distill experience, highlight, then report, then stop
    STEP="highlight"
    RESULT="(distilled)"
    NEXT_STEP="report"
    ;;
  blocked)
    # Blocked: stop loop, report blocking reason — no signal (terminal state)
    echo "[BLOCKED] Task is blocked — awaiting user intervention"
    exit 0
    ;;
  cancelled)
    # Cancelled: stop loop — no signal (terminal state)
    echo "[CANCELLED] Task is cancelled"
    exit 0
    ;;
  *)
    echo "[WARN] Unknown status: $STATUS — cannot start auto loop"
    exit 1
    ;;
esac

# 4. Write Progress Signal (D2-2: use python for safe JSON generation)
# Read stage from .status.json if available
# D3: Get stage field. Python heredoc has try/except for malformed JSON (e.g. Python repr vs JSON)
STAGE_JSON=$(python3 "$STATE_PY" get "$STATUS_JSON" stage 2>/dev/null || echo "")
CHECKPOINT=""
# D3: Increment iteration counter and enforce hard safety limit
ITERATION=$((ITERATION + 1))
MAX_ITERATIONS=200
if [[ "$ITERATION" -ge "$MAX_ITERATIONS" ]]; then
    echo "[ERROR] Hard iteration limit reached ($MAX_ITERATIONS). Stopping auto loop to prevent runaway." >&2
    echo '{"stop_reason":"hard_iteration_limit","iteration":'"$ITERATION"'}' > "$WORK_DIR/.auto-stop"
    exit 1
fi

# Derive checkpoint from step + status context
case "$STEP" in
    verify)
        case "$STATUS" in
            executing) CHECKPOINT="post-exec" ;;
            planning|re-planning) CHECKPOINT="post-plan" ;;
            *) CHECKPOINT="post-plan" ;;
        esac
        ;;
    *) CHECKPOINT="" ;;
esac

python3 - "$SIGNAL_FILE" "$STEP" "$RESULT" "$NEXT_STEP" "$ITERATION" "$COMPACTION" "$PHASE" "$CHECKPOINT" "$STAGE_JSON" <<'PYEOF'
import json, sys, os
from datetime import datetime, timezone
signal_file = sys.argv[1]
checkpoint = sys.argv[8]
stage_raw = sys.argv[9]
# Parse stage JSON if available
stage = None
if stage_raw:
    try:
        stage = json.loads(stage_raw)
    except (json.JSONDecodeError, ValueError):
        pass
try:
    iteration = int(sys.argv[5])
    compaction = int(sys.argv[6])
except (ValueError, IndexError):
    iteration, compaction = 1, 0
signal = {
    "step": sys.argv[2],
    "result": sys.argv[3],
    "next": sys.argv[4],
    "checkpoint": checkpoint,
    "iteration": iteration,
    "compaction_count": compaction,
    "phase": sys.argv[7],
    "phase_progress": 0.0,
    "stage": stage,
    "check_score": None,
    "retry_count": 0,
    "delegation_failures": [],
    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
tmp = signal_file + '.tmp'
with open(tmp, 'w') as f:
    json.dump(signal, f, indent=2)
os.rename(tmp, signal_file)
PYEOF

echo "Auto loop initialized. Next step: $NEXT_STEP."
