#!/usr/bin/env bash
# L2: Functional test for plan sub-command
# Verifies VH stub generation for software tasks.

source "$(dirname "$0")/lib.sh"

PLAN_SH="$TASK_AI_ROOT/skills/plan/scripts/plan.sh"
TEST_NB="plan-tdd-$(date +%s)"
export NB_WORKSPACES_ROOT="/tmp/plan-functional-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT

# Setup
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working"
STATUS_JSON="$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working/.status.json"
echo '{"title":"Test Task", "type":"software"}' > "$STATUS_JSON"

# Act
"$PLAN_SH" "$TEST_NB" > /dev/null

# 1. Assert: .plan.md created
if [[ -f "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working/.plan.md" ]]; then
    emit_pass "plan: created .plan.md"
else
    emit_fail "plan: failed to create .plan.md"
fi

# 2. Assert: VH Stubs created
STUB_COUNT=$(find "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.test" -name "*-vh-stubs.test.js" | wc -l)
if [[ $STUB_COUNT -gt 0 ]]; then
    emit_pass "plan: correctly generated VH test stubs"
else
    emit_fail "plan: failed to generate VH stubs for software task"
fi

# 3. Assert: VH Baseline recorded
if grep -q "Total stubs: 2" "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.test/"*-vh-baseline.md; then
    emit_pass "plan: recorded correct VH baseline"
else
    emit_fail "plan: wrong VH baseline content"
fi

# Cleanup
rm -rf "$NB_WORKSPACES_ROOT"

summary
