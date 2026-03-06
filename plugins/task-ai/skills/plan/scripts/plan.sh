#!/usr/bin/env bash
# /task-ai:plan implementation
# Usage: plan.sh [notebook] [--generate]
#        plan.sh --refine "refinement description text"
#        plan.sh --finalize

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

# Parse arguments
NOTEBOOK=""
REFINE_MODE=0
FINALIZE_MODE=0
REFINE_CONTENT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --refine)
            REFINE_MODE=1
            # D2: Guard against missing or flag-like arguments
            if [[ -n "${2:-}" ]] && [[ "${2:-}" != --* ]]; then
                REFINE_CONTENT="$2"
                shift 2
            else
                REFINE_CONTENT=""
                shift
            fi
            ;;
        --finalize)
            FINALIZE_MODE=1
            shift
            ;;
        --generate)
            shift
            ;;
        *)
            NOTEBOOK="$1"
            shift
            ;;
    esac
done

resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

STATUS_JSON="$WORK_DIR/.status.json"
SESSION_CONTEXT="$WORK_DIR/.session-context"
PLAN_FILE="$WORK_DIR/.plan.md"

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

STATE_PY="$SCRIPT_DIR/../../../core/state.py"

# D3: Check state.py existence before calling
if [[ ! -f "$STATE_PY" ]]; then
    echo "[ERROR] state.py not found: $STATE_PY" >&2
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 1: Finalize (exit plan-refinement phase)
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$FINALIZE_MODE" -eq 1 ]]; then
    if [[ -f "$SESSION_CONTEXT" ]] && grep -q "phase: plan-refinement" "$SESSION_CONTEXT"; then
        rm -f "$SESSION_CONTEXT"
        echo "[plan] Plan finalized. Exited plan-refinement phase."
        echo "[plan] Run /exec to start execution."
    else
        echo "[plan] Not in plan-refinement phase."
    fi
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 2: Refine (modify existing plan)
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$REFINE_MODE" -eq 1 ]]; then
    # D1: Reject refinement on terminal statuses
    REFINE_STATUS=$(python3 "$STATE_PY" get "$STATUS_JSON" status 2>/dev/null) || REFINE_STATUS=""
    case "$REFINE_STATUS" in
        complete|cancelled|stage-done)
            echo "[ERROR] Cannot refine — task status is $REFINE_STATUS." >&2
            exit 1
            ;;
    esac

    # D2: Validate refinement content is not empty
    if [[ -z "$REFINE_CONTENT" ]]; then
        echo "[ERROR] Refinement content cannot be empty." >&2
        exit 1
    fi

    if [[ ! -f "$PLAN_FILE" ]]; then
        echo "[ERROR] Cannot refine - no plan exists. Use /plan first." >&2
        exit 1
    fi

    # D3: Warn if not in plan-refinement phase (non-blocking)
    if [[ ! -f "$SESSION_CONTEXT" ]] || ! grep -q "phase: plan-refinement" "$SESSION_CONTEXT"; then
        echo "[WARN] Not in plan-refinement phase. Proceeding anyway."
    fi

    DATE=$(date "+%Y-%m-%d %H:%M")

    # D2: Strip control characters (except newline) from user input, use printf to avoid echo -n/-e issues
    REFINE_CONTENT_SAFE=$(printf '%s' "$REFINE_CONTENT" | tr -d '\000-\010\013\014\016-\037')
    REFINEMENT_LINE=$(printf '- [%s] %s' "$DATE" "$REFINE_CONTENT_SAFE")

    # Append refinement to Refinements section
    if grep -q "^## Refinements" "$PLAN_FILE"; then
        printf '%s\n' "$REFINEMENT_LINE" >> "$PLAN_FILE"
    else
        printf '\n## Refinements\n\n%s\n' "$REFINEMENT_LINE" >> "$PLAN_FILE"
    fi

    # D3: git with error handling (non-fatal — refinement already written to file)
    if ! git add "$PLAN_FILE" 2>/dev/null; then
        echo "[WARN] git add failed" >&2
    fi
    if ! git commit -m "task-ai($NOTEBOOK):plan refine" 2>/dev/null; then
        echo "[WARN] git commit failed (may be no changes)" >&2
    fi

    echo "[plan] Refinement added: $REFINE_CONTENT_SAFE"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 3: Generate plan
# ─────────────────────────────────────────────────────────────────────────────

# 0. Guard: reject terminal statuses (SKILL.md State Transitions)
CURRENT_STATUS_GUARD=$(python3 "$STATE_PY" get "$STATUS_JSON" status 2>/dev/null) || CURRENT_STATUS_GUARD=""
case "$CURRENT_STATUS_GUARD" in
    complete)
        echo "[ERROR] Completed tasks cannot be re-planned." >&2
        exit 1
        ;;
    cancelled)
        echo "[ERROR] Cancelled tasks cannot be re-planned." >&2
        exit 1
        ;;
    stage-done)
        echo "[ERROR] Stage completed — use /target to advance to next stage first." >&2
        exit 1
        ;;
esac

# 1. Invoke Research for Type Discovery
# D3: python3 calls with error handling
TYPE=$(python3 "$STATE_PY" get "$STATUS_JSON" type 2>/dev/null) || TYPE=""
if [[ -z "$TYPE" ]]; then
    TYPE="software" # Default fallback type when not set in .status.json
fi

# D2: Validate type format BEFORE persisting (SKILL.md step 4)
# Each pipe-separated segment must match [a-zA-Z0-9_:-]+; no leading/trailing/consecutive pipes
if [[ -n "$TYPE" ]] && ! [[ "$TYPE" =~ ^[a-zA-Z0-9_:-]+(\|[a-zA-Z0-9_:-]+)*$ ]]; then
    echo "[ERROR] Invalid type format: $TYPE (each segment must match [a-zA-Z0-9_:-]+, pipe-separated)" >&2
    exit 1
fi

# D1: Persist type only after validation passes
if ! python3 "$STATE_PY" get "$STATUS_JSON" type >/dev/null 2>&1; then
    if ! python3 "$STATE_PY" set "$STATUS_JSON" type "$TYPE" 2>/dev/null; then
        echo "[WARN] Failed to set type in .status.json" >&2
    fi
fi

echo "Planning for task type: $TYPE"

# 2. Generate .plan.md (Scaffold)
# Archive existing plan only when re-planning (SKILL.md step 14)
if [[ -f "$PLAN_FILE" ]] && [[ "$CURRENT_STATUS_GUARD" == "review" || "$CURRENT_STATUS_GUARD" == "executing" || "$CURRENT_STATUS_GUARD" == "re-planning" ]]; then
    SUPERSEDED="$WORK_DIR/.plan-superseded.md"
    if [[ -f "$SUPERSEDED" ]]; then
        # Append numeric suffix if superseded file exists
        i=2
        while [[ -f "$WORK_DIR/.plan-superseded-$i.md" ]]; do
            ((i++))
            # D3: Safety cap to prevent infinite loop on filesystem anomalies
            if [[ $i -gt 100 ]]; then
                echo "[ERROR] Too many superseded plans (>100) — aborting" >&2
                exit 1
            fi
        done
        SUPERSEDED="$WORK_DIR/.plan-superseded-$i.md"
    fi
    # D3: mv with error handling - abort if fails to prevent data loss
    if ! mv "$PLAN_FILE" "$SUPERSEDED"; then
        echo "[ERROR] Failed to archive .plan.md - aborting" >&2
        exit 1
    fi
    echo "[INFO] Existing .plan.md archived to $SUPERSEDED"
    # D6: Add superseded file to git so it's tracked
    git add "$SUPERSEDED" 2>/dev/null || true
fi
cat > "$PLAN_FILE" <<EOF
# Implementation Plan: $NOTEBOOK

## Step 1: Initialize Project
- Setup basic structure
[VH: test-init]

## Step 2: Implement Core Logic
- Write main functions
[VH: test-core]
EOF

# 3. Generate VH Stubs (for software types)
if [[ "$TYPE" == *"software"* ]]; then
    TEST_DIR="$WORK_DIR/.test"
    mkdir -p "$TEST_DIR"
    DATE=$(date +%Y-%m-%d)
    STUB_FILE="$TEST_DIR/$DATE-vh-stubs.test.js"

    cat > "$STUB_FILE" <<EOF
// VH: auto-generated stubs for $NOTEBOOK
test('test-init', () => {
  // VH: not implemented
  throw new Error('VH: not implemented');
});

test('test-core', () => {
  // VH: not implemented
  throw new Error('VH: not implemented');
});
EOF

    # Create VH Baseline
    cat > "$TEST_DIR/$DATE-vh-baseline.md" <<EOF
# VH Baseline: $NOTEBOOK
- Total stubs: 2
- Status: All failing (Red)
EOF
    echo "Generated VH stubs and baseline."
fi

# 4. Update Status — choose planning vs re-planning based on current state
# D4: Reuse CURRENT_STATUS_GUARD from step 0 instead of re-reading .status.json
case "$CURRENT_STATUS_GUARD" in
    review|executing|re-planning)
        NEW_STATUS="re-planning"
        NEW_PHASE="needs-check"
        ;;
    *)
        NEW_STATUS="planning"
        NEW_PHASE=""
        ;;
esac
# D3: python3 call with error handling; reset completed_steps per SKILL.md step 23
if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status "$NEW_STATUS" --phase "$NEW_PHASE" --completed-steps 0 2>/dev/null; then
    echo "[WARN] Failed to transition status to $NEW_STATUS" >&2
fi

# 5. Transition phases: target-refinement → plan-refinement
if [[ -f "$SESSION_CONTEXT" ]] && grep -q "phase: target-refinement" "$SESSION_CONTEXT"; then
    echo "[plan] Exited target-refinement phase."
fi

# Enter plan-refinement phase
# D3: Error handling for session context write
if ! printf 'phase: plan-refinement\nentered_at: %s\nentered_by: /task-ai:plan\n' "$(date -Iseconds)" > "$SESSION_CONTEXT" 2>/dev/null; then
    echo "[WARN] Failed to write session context" >&2
fi

# D1: Commit generated plan + test artifacts + session context
# D3: git with error handling; only add files that exist
GIT_ADD_FILES=("$PLAN_FILE" "$STATUS_JSON")
if [[ -f "$SESSION_CONTEXT" ]]; then
    GIT_ADD_FILES+=("$SESSION_CONTEXT")
fi
if ! git add "${GIT_ADD_FILES[@]}" 2>/dev/null; then
    echo "[WARN] git add failed" >&2
fi
# Also add test directory if it exists (VH stubs, criteria)
if [[ -d "$WORK_DIR/.test" ]]; then
    git add "$WORK_DIR/.test" 2>/dev/null || true
fi
if ! git commit -m "task-ai($NOTEBOOK):plan generate implementation plan" 2>/dev/null; then
    echo "[WARN] git commit failed (may be no changes)" >&2
fi

# 6. Write .auto-signal (SKILL.md step 27)
AUTO_SIGNAL="$WORK_DIR/.auto-signal"
printf '{ "step": "plan", "result": "(generated)", "next": "verify", "checkpoint": "post-plan", "timestamp": "%s" }\n' "$(date -Iseconds)" > "$AUTO_SIGNAL" 2>/dev/null || true

echo "[plan] Plan generated. Entered plan-refinement phase."
echo "[plan] Continue discussing to refine. Use /exec when ready."
