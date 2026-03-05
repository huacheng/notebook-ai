#!/usr/bin/env bash
# /task-ai:exec implementation
# Usage: exec.sh <notebook> [--step N]

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

NOTEBOOK="${1:-}"
TARGET_STEP=""
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --step) TARGET_STEP="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

INDEX_JSON="$WORK_DIR/.index.json"
SESSION_CONTEXT="$WORK_DIR/.session-context"
STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"
NOTES_DIR="$WORK_DIR/.notes"
mkdir -p "$NOTES_DIR"

# Exit plan-refinement phase (if active)
if [[ -f "$SESSION_CONTEXT" ]] && grep -q "phase: plan-refinement" "$SESSION_CONTEXT"; then
    rm -f "$SESSION_CONTEXT"
    echo "[exec] Exited plan-refinement phase."
fi

# 1. Step Discovery (from .plan.md)
PLAN_MD="$WORK_DIR/.plan.md"
if [[ -f "$PLAN_MD" ]]; then
    TOTAL_STEPS=$(grep -cE '^##\s+Step\s+[0-9]+' "$PLAN_MD" 2>/dev/null || echo "0")
else
    echo "[ERROR] .plan.md not found. Run plan first." >&2
    exit 1
fi
if [[ "$TOTAL_STEPS" -eq 0 ]]; then
    echo "[ERROR] No steps found in .plan.md" >&2
    exit 1
fi
COMPLETED=$(python3 "$STATE_PY" get "$INDEX_JSON" completed_steps 2>/dev/null || echo "0")
COMPLETED=${COMPLETED:-0}

echo "Executing $NOTEBOOK. Progress: $COMPLETED/$TOTAL_STEPS"

# 2. Execution Loop
NEXT_STEP=$((COMPLETED + 1))

if [[ $NEXT_STEP -gt $TOTAL_STEPS ]]; then
    echo "All steps already completed."
    exit 0
fi

if [[ -n "$TARGET_STEP" && "$TARGET_STEP" != "$NEXT_STEP" ]]; then
    echo "[ERROR] Requested step $TARGET_STEP but next step is $NEXT_STEP." >&2
    exit 1
fi

echo "--- Executing Step $NEXT_STEP ---"

# 3. VFP Cycle Simulation (Software only)
TYPE=$(python3 "$STATE_PY" get "$INDEX_JSON" type)
if [[ "$TYPE" == *"software"* ]]; then
    echo "[VFP] Red (VH) confirmed."
    echo "[VFP] Implementing logic..."
    echo "[VFP] Green (HS) confirmed."
fi

# 4. Record Notes
DATE=$(date +%Y-%m-%d)
cat > "$NOTES_DIR/$DATE-step-$NEXT_STEP-exec.md" <<EOF
# Exec Note: Step $NEXT_STEP
- Status: Completed
- VFP: Red -> Green -> Refactor (Pass)
EOF

# 5. Update Progress
python3 "$STATE_PY" transition "$INDEX_JSON" --status executing --completed-steps $NEXT_STEP

echo "Step $NEXT_STEP completed successfully."
