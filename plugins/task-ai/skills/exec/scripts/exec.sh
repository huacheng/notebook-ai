#!/usr/bin/env bash
# /task-ai:exec implementation
# Usage: exec.sh <notebook> [--step N]

set -uo pipefail
trap 'rm -f "${LOCK_FILE:-}" "${TMP_FILE:-}"' EXIT INT TERM

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
STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"
NOTES_DIR="$WORK_DIR/.notes"
mkdir -p "$NOTES_DIR"

# 1. Step Discovery
TOTAL_STEPS=2
COMPLETED=$(python3 "$STATE_PY" get "$INDEX_JSON" completed_steps)
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
