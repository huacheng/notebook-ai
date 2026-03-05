#!/usr/bin/env bash
# /task-ai:auto implementation
# Usage: auto.sh <notebook> [--start|--stop|--status]

set -euo pipefail
# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"
source "$SCRIPT_DIR/signal-writer.sh"

# Derive conversational phase from .index.json status
derive_phase() {
    local status="$1"
    case "$status" in
        draft) echo "target" ;;
        planning|re-planning) echo "planning" ;;
        review|executing) echo "execution" ;;
        blocked) echo "execution" ;;
        complete|stage-done) echo "finalization" ;;
        *) echo "unknown" ;;
    esac
}

NOTEBOOK="${1:-}"
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

ACTION="start"  # Default action
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --start)  ACTION="start"; shift ;;
    --stop)   ACTION="stop"; shift ;;
    --status) ACTION="status"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
INDEX_JSON="$WORK_DIR/.index.json"
SIGNAL_FILE="$WORK_DIR/.auto-signal"
STOP_FILE="$WORK_DIR/.auto-stop"
STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"

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
    status)
        if [[ -f "$SIGNAL_FILE" ]]; then
            echo "[AUTO] Signal file exists:"
            cat "$SIGNAL_FILE"
        else
            echo "[AUTO] No active auto loop signal"
        fi
        exit 0
        ;;
    start)
        # Continue with normal auto loop
        ;;
esac

# 2. Entry Point Routing (per SKILL.md §Entry Point)
# D3: python3 call with error handling
STATUS=$(python3 "$STATE_PY" get "$INDEX_JSON" status 2>/dev/null || echo "unknown")
PHASE=$(derive_phase "$STATUS")
echo "Auto-mode: Starting loop from status: $STATUS (phase: $PHASE)"

# 3. Determine next step based on status (D1-1: handle all statuses per SKILL.md)
ITERATION=1
COMPACTION=0

case "$STATUS" in
  draft)
    # Phase 1: Check target status before routing
    TARGET_MD="$WORK_DIR/.target.md"
    if [[ -f "$TARGET_MD" ]]; then
        if grep -q '\[PROPOSED\]' "$TARGET_MD"; then
            echo "[PAUSE] Pending [PROPOSED] items in .target.md — review and confirm before continuing"
            exit 0
        elif ! grep -q '## Research Insights' "$TARGET_MD"; then
            STEP="research"
            RESULT="(o1-collected)"
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
    RE_PHASE=$(python3 "$STATE_PY" get "$INDEX_JSON" phase 2>/dev/null || echo "")
    case "$RE_PHASE" in
      needs-check)
        STEP="verify"
        RESULT="(pass)"
        NEXT_STEP="check"
        ;;
      *)
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
  complete)
    # Phase 4: Generate report, then stop
    STEP="report"
    RESULT="(generated)"
    NEXT_STEP="(stop)"
    ;;
  stage-done)
    # Phase 4: Distill experience, then report
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
python3 - "$SIGNAL_FILE" "$STEP" "$RESULT" "$NEXT_STEP" "$ITERATION" "$COMPACTION" "$PHASE" <<'PYEOF'
import json, sys, os
from datetime import datetime, timezone
signal_file = sys.argv[1]
signal = {
    "step": sys.argv[2],
    "result": sys.argv[3],
    "next": sys.argv[4],
    "iteration": int(sys.argv[5]),
    "compaction_count": int(sys.argv[6]),
    "phase": sys.argv[7],
    "phase_progress": 0.0,
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
