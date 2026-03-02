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

# 1. Entry Point Routing (Simulated)
STATUS=$(python3 "$STATE_PY" get "$INDEX_JSON" status)
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
cat > "$SIGNAL_FILE" <<EOF
{
  "step": "auto",
  "result": "CONTINUE",
  "next": "$NEXT_STEP",
  "iteration": $ITERATION,
  "compaction_count": $COMPACTION,
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "Auto loop initialized. Next step: $NEXT_STEP."
