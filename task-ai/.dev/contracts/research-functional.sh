#!/usr/bin/env bash
# L2: Functional test for research sub-command
# Verifies T0 Stage Detection (O1 -> O2 -> O3)

source "$(dirname "$0")/lib.sh"

RESEARCH_SH="$TASK_AI_ROOT/skills/research/scripts/research.sh"
TEST_NB="research-test-$(date +%s)"
export NB_WORKSPACES_ROOT="/tmp/task-ai-research-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT

# Setup: Create a dummy notebook
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT/project/$TEST_NB/.working"
TARGET_MD="$NB_WORKSPACES_ROOT/project/$TEST_NB/.working/.target.md"
echo -e "# Task Target

## Objective
Dummy objective." > "$TARGET_MD"

# --- Test 1: Start O1 ---
OUTPUT=$("$RESEARCH_SH" "$TEST_NB" --caller target --phase objective 2>&1)
if echo "$OUTPUT" | grep -q "Detected stage: O1"; then
    emit_pass "research: correctly started O1"
else
    emit_fail "research: failed to start O1"
fi

# --- Test 2: Detect PENDING ---
# O1 is written with [PROPOSED], so next run should be PENDING
OUTPUT=$("$RESEARCH_SH" "$TEST_NB" --caller target --phase objective 2>&1)
if echo "$OUTPUT" | grep -q "Pending \[PROPOSED\] items"; then
    emit_pass "research: correctly detected PENDING state"
else
    emit_fail "research: failed to detect PENDING state"
fi

# --- Test 3: Advance to O2 ---
# Remove [PROPOSED] to simulate user confirmation
sed -i 's/\[PROPOSED\]//g' "$TARGET_MD"
OUTPUT=$("$RESEARCH_SH" "$TEST_NB" --caller target --phase objective 2>&1)
if echo "$OUTPUT" | grep -q "Detected stage: O2"; then
    emit_pass "research: correctly advanced to O2"
else
    emit_fail "research: failed to advance to O2"
fi

# Cleanup
rm -rf "$NB_WORKSPACES_ROOT"

summary
