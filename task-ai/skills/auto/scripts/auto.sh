#!/usr/bin/env bash
# /task-ai:auto implementation
# Usage: auto.sh <notebook> [--start|--stop|--status]

set -euo pipefail
# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"


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
        echo "[AUTO] Stopping auto loop..."
        rm -f "$SIGNAL_FILE"
        echo "Auto loop stopped."
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

# 2. Entry Point Routing (Simulated)
# D3: python3 call with error handling
STATUS=$(python3 "$STATE_PY" get "$INDEX_JSON" status 2>/dev/null || echo "unknown")
echo "Auto-mode: Starting loop from status: $STATUS"

# 2. Simulated Loop (Executing one step for plumbing)
ITERATION=1
COMPACTION=0

case "$STATUS" in
  draft)
    # H-AUTO-2: Check target status before routing
    TARGET_MD="$WORK_DIR/.target.md"
    if [[ -f "$TARGET_MD" ]]; then
        # Check for pending [PROPOSED] markers
        if grep -q '\[PROPOSED\]' "$TARGET_MD"; then
            NEXT_STEP="(stop)"
            echo "[PAUSE] Pending [PROPOSED] items in .target.md — review and confirm before continuing"
        # Check for research insights
        elif grep -q '## Research Insights' "$TARGET_MD"; then
            NEXT_STEP="plan"
        else
            NEXT_STEP="research"
        fi
    else
        NEXT_STEP="(stop)"
        echo "[ERROR] .target.md not found"
    fi
    ;;
  planning)
    NEXT_STEP="check"
    ;;
  executing)
    NEXT_STEP="verify"
    ;;
  *)
    NEXT_STEP="(stop)"
    ;;
esac

# 3. Write Progress Signal
# D3: .auto-signal write with error handling
if ! cat > "$SIGNAL_FILE" <<EOF
{
  "step": "auto",
  "result": "CONTINUE",
  "next": "$NEXT_STEP",
  "iteration": $ITERATION,
  "compaction_count": $COMPACTION,
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
then
    echo "[WARN] Failed to write .auto-signal" >&2
fi

echo "Auto loop initialized. Next step: $NEXT_STEP."
