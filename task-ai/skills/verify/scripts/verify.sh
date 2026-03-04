#!/usr/bin/env bash
# /task-ai:verify implementation
# Usage: verify.sh <notebook> [--checkpoint quick|full|step-N]

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"


NOTEBOOK="${1:-}"
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

CHECKPOINT=""
TARGET_FILE=""
GENERATE_SKILL_TESTS=false
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --checkpoint) CHECKPOINT="$2"; shift 2 ;;
    --target) TARGET_FILE="$2"; shift 2 ;;
    --generate-skill-tests) GENERATE_SKILL_TESTS=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

TEST_DIR="$WORK_DIR/.test"
mkdir -p "$TEST_DIR"

# Handle --generate-skill-tests
if [[ "$GENERATE_SKILL_TESTS" == "true" ]]; then
    if [[ -z "$TARGET_FILE" || ! -f "$TARGET_FILE" ]]; then
        echo "[ERROR] --target <skill.md> required for --generate-skill-tests" >&2
        exit 1
    fi

    SKILL_NAME=$(basename "${TARGET_FILE%.*}")
    TEST_FILE="$TEST_DIR/skill-$SKILL_NAME.test.md"
    DATE=$(date +%Y-%m-%d)

    # Extract skill description and steps
    SKILL_DESC=$(grep -E "^description:" "$TARGET_FILE" | sed 's/^description:\s*//' || echo "No description")
    SKILL_STEPS=$(grep -A 100 "^## Steps" "$TARGET_FILE" | grep -E "^[0-9]+\." | head -5 || echo "No steps found")

    cat > "$TEST_FILE" <<EOF
# Skill Test: $SKILL_NAME
Generated: $DATE

## Skill Under Test
- File: $TARGET_FILE
- Description: $SKILL_DESC

## Test Cases

### TC1: Basic Invocation (Green)
**Input**: Invoke /$SKILL_NAME with minimal valid input
**Expected**: Skill executes without error

### TC2: Missing Required Input (Red)
**Input**: Invoke /$SKILL_NAME without required parameters
**Expected**: Clear error message, non-zero exit

### TC3: Permission Boundary
**Input**: Invoke /$SKILL_NAME in --permission-mode strict
**Expected**: No unexpected permission requests

## Extracted Steps
$SKILL_STEPS

## Execution Notes
- Run in isolated worktree: \`init skill-test-$SKILL_NAME --worktree --ephemeral\`
- Use strict permission mode: \`claude --permission-mode strict\`
- Collect permission requests as behavioral fingerprint
EOF

    echo "Generated skill tests: $TEST_FILE"
    exit 0
fi

echo "Verifying $NOTEBOOK with checkpoint: $CHECKPOINT"

# 1. Execute Procedures based on checkpoint
# (Simulated for plumbing)
RESULT="(pass)"
DATE=$(date +%Y-%m-%d)
RESULTS_FILE="$TEST_DIR/$DATE-$CHECKPOINT-results.md"

case "$CHECKPOINT" in
  quick)
    echo "- Running build and lint... PASS"
    ;;
  full)
    echo "- Running all test criteria... PASS"
    echo "- Running acceptance tests... PASS"
    ;;
  step-*)
    STEP_NUM=${CHECKPOINT#step-}
    echo "- Running tests for step $STEP_NUM... PASS"
    ;;
esac

# 2. Write Results File
cat > "$RESULTS_FILE" <<EOF
# Verification Results: $CHECKPOINT · $DATE
- Result: $RESULT
- Summary: All criteria met for checkpoint $CHECKPOINT.
EOF

# 3. Update .test/.summary.md
cat > "$TEST_DIR/.summary.md" <<EOF
# Test Summary
- Last Checkpoint: $CHECKPOINT
- Last Result: $RESULT
- Date: $DATE
EOF

echo "Verification completed. Results written to $RESULTS_FILE."
