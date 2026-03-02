#!/usr/bin/env bash
# /task-ai:plan implementation
# Usage: plan.sh <notebook> [--generate]

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

NOTEBOOK="${1:-}"
GENERATE=1
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

INDEX_JSON="$WORK_DIR/.index.json"

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"

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

echo "Plan generated successfully."
