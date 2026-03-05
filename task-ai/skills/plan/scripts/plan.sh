#!/usr/bin/env bash
# /task-ai:plan implementation
# Usage: plan.sh [notebook] [--generate]
#        plan.sh --refine "step:N description" | "add:step description" | "remove:step N"
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
            REFINE_CONTENT="${2:-}"
            shift 2 || shift
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

INDEX_JSON="$WORK_DIR/.index.json"
SESSION_CONTEXT="$WORK_DIR/.session-context"
PLAN_FILE="$WORK_DIR/.plan.md"

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"

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

    # Append refinement to Refinements section
    if grep -q "^## Refinements" "$PLAN_FILE"; then
        echo "- [$DATE] $REFINE_CONTENT" >> "$PLAN_FILE"
    else
        echo "" >> "$PLAN_FILE"
        echo "## Refinements" >> "$PLAN_FILE"
        echo "" >> "$PLAN_FILE"
        echo "- [$DATE] $REFINE_CONTENT" >> "$PLAN_FILE"
    fi

    git add "$PLAN_FILE"
    git commit -m "task-ai($NOTEBOOK):plan refine"

    echo "[plan] Refinement added: $REFINE_CONTENT"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 3: Generate plan
# ─────────────────────────────────────────────────────────────────────────────

# 1. Invoke Research for Type Discovery (Simulated)
# In real execution, this would call research.sh. For plumbing:
TYPE=$(python3 "$STATE_PY" get "$INDEX_JSON" type)
if [[ -z "$TYPE" ]]; then
    TYPE="software" # Default for plan testing
    python3 "$STATE_PY" set "$INDEX_JSON" type "$TYPE"
fi

echo "Planning for task type: $TYPE"

# 2. Generate .plan.md (Scaffold)
# Archive existing plan with superseded naming convention
if [[ -f "$WORK_DIR/.plan.md" ]]; then
    SUPERSEDED="$WORK_DIR/.plan-superseded.md"
    if [[ -f "$SUPERSEDED" ]]; then
        # Append numeric suffix if superseded file exists
        i=2
        while [[ -f "$WORK_DIR/.plan-superseded-$i.md" ]]; do ((i++)); done
        SUPERSEDED="$WORK_DIR/.plan-superseded-$i.md"
    fi
    mv "$WORK_DIR/.plan.md" "$SUPERSEDED"
    echo "[WARN] Existing .plan.md archived to $SUPERSEDED"
fi
cat > "$WORK_DIR/.plan.md" <<EOF
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

# 4. Update Index Status
python3 "$STATE_PY" transition "$INDEX_JSON" --status planning

# 5. Transition phases: target-refinement → plan-refinement
if [[ -f "$SESSION_CONTEXT" ]] && grep -q "phase: target-refinement" "$SESSION_CONTEXT"; then
    echo "[plan] Exited target-refinement phase."
fi

# Enter plan-refinement phase
cat > "$SESSION_CONTEXT" << EOF
phase: plan-refinement
entered_at: $(date -Iseconds)
entered_by: /task-ai:plan
EOF

echo "[plan] Plan generated. Entered plan-refinement phase."
echo "[plan] Continue discussing to refine. Use /exec when ready."
