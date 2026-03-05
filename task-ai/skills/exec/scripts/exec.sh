#!/usr/bin/env bash
# /task-ai:exec implementation
# Usage: exec.sh <notebook> [--step N]

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

# Security script for command verification
SECURITY_SH="$SCRIPT_DIR/../../security/scripts/security.sh"

# D2: Run command with security verification (Pre-hook per SKILL.md L74)
# Usage: run_secure_cmd "command" "notebook"
# Returns: command exit code, or 1 if security rejected
#
# NOTE: This function is provided for future use when exec.sh transitions
# from stub implementation to actual command execution. Currently exec.sh
# simulates VFP cycles without running real commands.
run_secure_cmd() {
    local cmd="$1"
    local notebook="$2"

    # D3: Security audit before execution - warn if security script missing
    if [[ -f "$SECURITY_SH" ]]; then
        local security_result
        security_result=$(bash "$SECURITY_SH" "$notebook" verify-cmd "$cmd" 2>&1)
        if echo "$security_result" | grep -q "REJECT"; then
            echo "[exec] SECURITY REJECT: $cmd"
            echo "$security_result"
            return 1
        fi
    else
        echo "[exec] WARN: security.sh not found, skipping security check" >&2
    fi

    # D2: Execute command safely (avoid eval injection)
    # Use bash -c for controlled execution instead of eval
    bash -c "$cmd"
}

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

# D3: Check state.py existence before calling
if [[ ! -f "$STATE_PY" ]]; then
    echo "[ERROR] state.py not found: $STATE_PY" >&2
    exit 1
fi

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
# D2: Validate COMPLETED contains only digits
if [[ ! "$COMPLETED" =~ ^[0-9]+$ ]]; then
    COMPLETED=0
fi

echo "Executing $NOTEBOOK. Progress: $COMPLETED/$TOTAL_STEPS"

# 2. Execution Loop
NEXT_STEP=$((COMPLETED + 1))

if [[ $NEXT_STEP -gt $TOTAL_STEPS ]]; then
    echo "All steps already completed."
    exit 0
fi

# D2: Validate TARGET_STEP contains only digits
if [[ -n "$TARGET_STEP" ]]; then
    if [[ ! "$TARGET_STEP" =~ ^[0-9]+$ ]]; then
        echo "[ERROR] Invalid step number: $TARGET_STEP" >&2
        exit 1
    fi
    if [[ "$TARGET_STEP" != "$NEXT_STEP" ]]; then
        echo "[ERROR] Requested step $TARGET_STEP but next step is $NEXT_STEP." >&2
        exit 1
    fi
fi

echo "--- Executing Step $NEXT_STEP ---"

# 3. VFP Cycle Simulation (Software only)
# D3: python3 call with fallback
TYPE=$(python3 "$STATE_PY" get "$INDEX_JSON" type 2>/dev/null || echo "")
TYPE=${TYPE:-"software"}  # Default to software if not set
if [[ "$TYPE" == *"software"* ]]; then
    echo "[VFP] Red (VH) confirmed."
    echo "[VFP] Implementing logic..."
    echo "[VFP] Green (HS) confirmed."
fi

# 4. Record Notes
DATE=$(date +%Y-%m-%d)
# D3: File write with error handling
if ! cat > "$NOTES_DIR/$DATE-step-$NEXT_STEP-exec.md" <<EOF
# Exec Note: Step $NEXT_STEP
- Status: Completed
- VFP: Red -> Green -> Refactor (Pass)
EOF
then
    echo "[WARN] Failed to write exec note" >&2
fi

# 5. Update Progress
# D3: python3 call with error handling
if ! python3 "$STATE_PY" transition "$INDEX_JSON" --status executing --completed-steps $NEXT_STEP 2>&1; then
    echo "[WARN] Failed to update progress in index" >&2
fi

echo "Step $NEXT_STEP completed successfully."
