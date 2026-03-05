#!/usr/bin/env bash
# L2: Functional test for check sub-command
# Verifies state transitions and analysis file generation.

source "$(dirname "$0")/lib.sh"

CHECK_SH="$TASK_AI_ROOT/skills/check/scripts/check.sh"
STATE_PY="$TASK_AI_ROOT/core/state.py"
TEST_NB="check-tdd-$(date +%s)"
export NB_WORKSPACES_ROOT="/tmp/check-functional-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT

# Setup
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working"
STATUS_JSON="$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working/.status.json"
echo '{"status":"planning"}' > "$STATUS_JSON"

# Act: post-plan PASS
"$CHECK_SH" "$TEST_NB" --checkpoint post-plan > /dev/null

# 1. Assert: Status changed to review
NEW_STATUS=$(python3 "$STATE_PY" get "$STATUS_JSON" status)
if [[ "$NEW_STATUS" == "review" ]]; then
    emit_pass "check: post-plan PASS transitioned to review"
else
    emit_fail "check: failed status transition (status: $NEW_STATUS)"
fi

# 2. Assert: Analysis file created
DATE=$(date +%Y-%m-%d)
if [[ -f "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.analysis/$DATE-post-plan-pass.md" ]]; then
    emit_pass "check: created analysis file"
else
    emit_fail "check: failed to create analysis file"
fi

# Cleanup
rm -rf "$NB_WORKSPACES_ROOT"

summary
