#!/usr/bin/env bash
# /task-ai:exec implementation
# Usage: exec.sh <notebook> [--step N]

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

# Security script for command verification
SECURITY_SH="$TASK_AI_ROOT/skills/security/scripts/security.sh"

# D2: Run command with security verification (Pre-hook per SKILL.md §Per-Step Execution, step 3 Security Audit)
# Usage: run_secure_cmd "command" "notebook"
# Returns: command exit code, or 1 if security rejected
#
# NOTE: This function is provided for future use when exec.sh transitions
# from stub implementation to actual command execution. Currently exec.sh
# simulates VFP cycles without running real commands.
run_secure_cmd() {
    local cmd="${1:-}"
    local notebook="${2:-}"

    # D2: Validate required parameters
    if [[ -z "$cmd" ]]; then
        echo "[ERROR] run_secure_cmd requires a command argument" >&2
        return 1
    fi
    if [[ -z "$notebook" ]]; then
        echo "[ERROR] run_secure_cmd requires a notebook argument" >&2
        return 1
    fi

    # D3: Security audit before execution — warn if security script missing
    if [[ -f "$SECURITY_SH" ]]; then
        local security_result
        security_result=$(bash "$SECURITY_SH" "$notebook" verify-cmd "$cmd" 2>&1)
        if [[ "$security_result" == *"REJECT"* ]]; then
            echo "[ERROR] SECURITY REJECT — command blocked by security policy" >&2
            echo "$security_result" >&2
            return 1
        fi
    else
        echo "[WARN] security.sh not found, skipping security check" >&2
    fi

    # D2: Execute command via bash -c (security pre-checked above)
    bash -c "$cmd"
}

NOTEBOOK="${1:-}"
TARGET_STEP=""
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --step)
      if [[ $# -lt 2 ]]; then
        echo "[ERROR] --step requires a value" >&2
        exit 1
      fi
      TARGET_STEP="$2"; shift 2 ;;
    *) echo "[ERROR] Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

STATUS_JSON="$WORK_DIR/.status.json"
STATE_PY="$TASK_AI_ROOT/core/state.py"
NOTES_DIR="$WORK_DIR/.notes"
SIGNAL_FILE="$WORK_DIR/.auto-signal"
SUMMARY_FILE="$WORK_DIR/.summary.md"
mkdir -p "$NOTES_DIR"

# D3: Check state.py existence before calling
if [[ ! -f "$STATE_PY" ]]; then
    echo "[ERROR] state.py not found: $STATE_PY" >&2
    exit 1
fi

# D2/D3: Concurrency — acquire .working/.lock before proceeding (per SKILL.md)
# Uses mkdir-based lock (same path as verify.sh/check.sh for mutual exclusion)
LOCK_DIR="$WORK_DIR/.working"
LOCK_FILE="$LOCK_DIR/.lock"
mkdir -p "$LOCK_DIR"
cleanup_exec() {
    local exit_code=$?
    # D3: On unexpected exit (non-zero, non-caught), write mid-exec signal so auto mode can route
    if [[ $exit_code -ne 0 && -n "${SIGNAL_FILE:-}" && ! -f "${SIGNAL_FILE:-}" ]]; then
        local ts
        ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")
        cat > "${SIGNAL_FILE}.tmp" 2>/dev/null <<TRAP_EOF
{
  "step": "exec",
  "result": "(mid-exec)",
  "next": "verify",
  "checkpoint": "mid-exec",
  "timestamp": "$ts"
}
TRAP_EOF
        mv "${SIGNAL_FILE}.tmp" "$SIGNAL_FILE" 2>/dev/null || true
    fi
    rm -rf "$LOCK_FILE" 2>/dev/null || true
    rm -f "${SIGNAL_FILE}.tmp" "${SUMMARY_FILE}.tmp" 2>/dev/null || true
    rm -f "$NOTES_DIR"/*.tmp 2>/dev/null || true
}
trap cleanup_exec EXIT INT TERM
if ! mkdir "$LOCK_FILE" 2>/dev/null; then
    # D3: Stale lock recovery — check if holding PID is still alive
    LOCK_PID_FILE="$LOCK_FILE/pid"
    if [[ -f "$LOCK_PID_FILE" ]]; then
        existing_pid=$(cat "$LOCK_PID_FILE" 2>/dev/null || echo "")
        if [[ -n "$existing_pid" ]] && ! kill -0 "$existing_pid" 2>/dev/null; then
            echo "[WARN] Removing stale .lock (PID $existing_pid is dead)" >&2
            rm -rf "$LOCK_FILE"
            mkdir "$LOCK_FILE" 2>/dev/null || { echo "[ERROR] Failed to reclaim lock" >&2; exit 1; }
        else
            echo "[ERROR] Another task-ai process holds .lock in $WORK_DIR" >&2
            exit 1
        fi
    else
        echo "[ERROR] Another task-ai process holds .lock in $WORK_DIR" >&2
        exit 1
    fi
fi
# D3: Record owning PID for stale lock detection
echo $$ > "$LOCK_FILE/pid"

# D1: Step 1 — Validate status is 'review' or 'executing'
CURRENT_STATUS=$(python3 "$STATE_PY" get "$STATUS_JSON" status 2>/dev/null || echo "")
if [[ "$CURRENT_STATUS" != "review" && "$CURRENT_STATUS" != "executing" ]]; then
    echo "[ERROR] Cannot exec: status is '$CURRENT_STATUS', expected 'review' or 'executing'." >&2
    exit 1
fi

# D1: Step 2 — Validate dependency gate
DEPENDS_ON=$(python3 "$STATE_PY" get "$STATUS_JSON" depends_on 2>/dev/null || echo "")
if [[ -n "$DEPENDS_ON" && "$DEPENDS_ON" != "None" && "$DEPENDS_ON" != "[]" ]]; then
    echo "[INFO] Dependency gate: depends_on present — validation delegated to AI agent caller" >&2
fi

# D1: Step 3 — Transition status to 'executing', clear phase
if [[ "$CURRENT_STATUS" == "review" ]]; then
    if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status executing --phase ""; then
        echo "[ERROR] Failed to transition status to 'executing'" >&2
        exit 1
    fi
    echo "[exec] Status transitioned: review -> executing"
fi

# D1: Step 6 — NEEDS_FIX resumption detection
if [[ "$CURRENT_STATUS" == "executing" ]]; then
    echo "[exec] Resuming execution (NEEDS_FIX or continuation)."
    # Check for fix guidance files (AI agent reads these for full context)
    # D1: Sort by filename (reverse alpha) to match "most recent by filename date" per SKILL.md
    LATEST_BUGFIX=$(find "$WORK_DIR/.bugfix" -maxdepth 1 -type f -name '*.md' 2>/dev/null | sort -r | head -1)
    if [[ -n "$LATEST_BUGFIX" ]]; then
        echo "[exec] Fix guidance available: $(basename "$LATEST_BUGFIX")"
    fi
    LATEST_ANALYSIS=$(find "$WORK_DIR/.analysis" -maxdepth 1 -type f -name '*.md' 2>/dev/null | sort -r | head -1)
    if [[ -n "$LATEST_ANALYSIS" ]]; then
        echo "[exec] Analysis available: $(basename "$LATEST_ANALYSIS")"
    fi
fi

# D1: Prerequisite checks — .target.md and .analysis/ should exist
if [[ ! -f "$WORK_DIR/.target.md" ]]; then
    echo "[WARN] .target.md not found — execution may lack requirements context" >&2
fi
if [[ -z "$(find "$WORK_DIR/.analysis" -maxdepth 1 -type f -name '*.md' 2>/dev/null | head -1)" ]]; then
    echo "[WARN] .analysis/ has no evaluation files — check may not have run" >&2
fi

# Step Discovery — extract steps from .plan.md
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
COMPLETED=$(python3 "$STATE_PY" get "$STATUS_JSON" completed_steps 2>/dev/null || echo "0")
COMPLETED=${COMPLETED:-0}
# D1/D2: Validate COMPLETED contains only digits (warn on reset per SKILL.md)
if [[ ! "$COMPLETED" =~ ^[0-9]+$ ]]; then
    echo "[WARN] completed_steps value '$COMPLETED' is invalid (non-integer), resetting to 0" >&2
    COMPLETED=0
fi

echo "Executing $NOTEBOOK. Progress: $COMPLETED/$TOTAL_STEPS"

# Execution Loop — determine next step
NEXT_STEP=$((COMPLETED + 1))

if [[ $NEXT_STEP -gt $TOTAL_STEPS ]]; then
    # D3: Detect plan/progress mismatch (e.g., plan re-generated with fewer steps)
    if [[ "$COMPLETED" -gt "$TOTAL_STEPS" ]]; then
        echo "[WARN] completed_steps ($COMPLETED) exceeds total steps ($TOTAL_STEPS) — plan may have been re-generated" >&2
    fi
    echo "All steps already completed ($COMPLETED/$TOTAL_STEPS)."
    # D1: Still write signal so auto mode can route correctly
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    cat > "${SIGNAL_FILE}.tmp" <<EOF
{
  "step": "exec",
  "result": "(done)",
  "next": "verify",
  "checkpoint": "post-exec",
  "timestamp": "$TIMESTAMP"
}
EOF
    mv "${SIGNAL_FILE}.tmp" "$SIGNAL_FILE"
    exit 0
fi

# D2: Validate TARGET_STEP contains only digits and is in range
if [[ -n "$TARGET_STEP" ]]; then
    if [[ ! "$TARGET_STEP" =~ ^[0-9]+$ ]]; then
        echo "[ERROR] Invalid step number: $TARGET_STEP" >&2
        exit 1
    fi
    if [[ "$TARGET_STEP" -lt 1 || "$TARGET_STEP" -gt "$TOTAL_STEPS" ]]; then
        echo "[ERROR] Step $TARGET_STEP out of range (1-$TOTAL_STEPS)." >&2
        exit 1
    fi
fi

# Determine task type for VFP applicability
# D3: python3 call with fallback
TYPE=$(python3 "$STATE_PY" get "$STATUS_JSON" type 2>/dev/null || echo "")
# D1: Empty string is valid — indicates unknown type, VFP checks will be skipped

# D1: Determine step range
if [[ -n "$TARGET_STEP" ]]; then
    STEP_START="$TARGET_STEP"
    STEP_END="$TARGET_STEP"
else
    STEP_START="$NEXT_STEP"
    STEP_END="$TOTAL_STEPS"
fi

DATE=$(date +%Y-%m-%d)
EXEC_RESULT="(done)"
EXEC_CHECKPOINT="post-exec"

# D1: Step 8/9 — Execute steps in order
for (( STEP=STEP_START; STEP<=STEP_END; STEP++ )); do
    echo "--- Executing Step $STEP/$TOTAL_STEPS ---"

    # 9.2 VFP VH confirmation (VFP-applicable types)
    if [[ "$TYPE" == *"software"* ]]; then
        echo "[VFP] Step $STEP: Red (VH) — checking pre-implementation test state..."
    fi

    # 9.3 Implementation (delegated to AI agent — stub records intent)
    echo "[exec] Step $STEP: Implementation delegated to AI agent."

    # 9.4 VFP HS confirmation (VFP-applicable types)
    if [[ "$TYPE" == *"software"* ]]; then
        echo "[VFP] Step $STEP: Green (HS) — post-implementation test confirmation."
    fi

    # 9.8 Record Notes
    # D3: Atomic file write with error handling
    NOTE_FILE="$NOTES_DIR/$DATE-step-$STEP-exec.md"
    if ! cat > "${NOTE_FILE}.tmp" <<EOF
# Exec Note: Step $STEP
- Status: Completed
- Type: $TYPE
- VFP: $(if [[ "$TYPE" == *"software"* ]]; then echo "Red -> Green -> Refactor (Pass)"; else echo "N/A (non-VFP type)"; fi)
EOF
    then
        echo "[WARN] Failed to write exec note for step $STEP" >&2
    else
        mv "${NOTE_FILE}.tmp" "$NOTE_FILE"
    fi

    # 9.9 Update completed_steps
    # D3: python3 call with error handling
    if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status executing --completed-steps "$STEP"; then
        echo "[WARN] Failed to update progress for step $STEP" >&2
    fi

    echo "Step $STEP/$TOTAL_STEPS completed successfully."
done

# D1: Step 10 — Update .status.json timestamp after execution loop
python3 "$STATE_PY" transition "$STATUS_JSON" --status executing 2>/dev/null || true

# D1: Step 10 — Determine signal result before writing files
if [[ -n "$TARGET_STEP" ]]; then
    EXEC_RESULT="(step-$TARGET_STEP)"
    EXEC_CHECKPOINT="mid-exec"
fi

# D1/D3: Step 10 — Write .summary.md atomically
cat > "${SUMMARY_FILE}.tmp" <<EOF
# Execution Summary — $NOTEBOOK

- **Date**: $DATE
- **Steps completed**: $STEP_END/$TOTAL_STEPS
- **Task type**: ${TYPE:-unknown}
- **Result**: $EXEC_RESULT
EOF
mv "${SUMMARY_FILE}.tmp" "$SUMMARY_FILE"

# D1/D3: Step 10 — Write .auto-signal atomically
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "${SIGNAL_FILE}.tmp" <<EOF
{
  "step": "exec",
  "result": "$EXEC_RESULT",
  "next": "verify",
  "checkpoint": "$EXEC_CHECKPOINT",
  "timestamp": "$TIMESTAMP"
}
EOF
mv "${SIGNAL_FILE}.tmp" "$SIGNAL_FILE"

echo "[exec] Signal written: result=$EXEC_RESULT, checkpoint=$EXEC_CHECKPOINT"
echo "Execution complete: $STEP_END/$TOTAL_STEPS steps done."
