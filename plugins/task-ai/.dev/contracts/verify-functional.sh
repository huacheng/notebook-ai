#!/usr/bin/env bash
# L2: Functional test for verify sub-command
# Verifies result file output for different checkpoints.

source "$(dirname "$0")/lib.sh"

VERIFY_SH="$TASK_AI_ROOT/skills/verify/scripts/verify.sh"
TEST_NB="verify-tdd-$(date +%s)"
export NB_WORKSPACES_ROOT="/tmp/verify-functional-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT

# Setup
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working"

# Act: Quick
"$VERIFY_SH" "$TEST_NB" --checkpoint quick > /dev/null
DATE=$(date +%Y-%m-%d)

# 1. Assert: Quick results created
if [[ -f "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.test/$DATE-quick-results.md" ]]; then
    emit_pass "verify: created quick results file"
else
    emit_fail "verify: failed to create quick results"
fi

# Act: Full
"$VERIFY_SH" "$TEST_NB" --checkpoint full > /dev/null

# 2. Assert: Full results created
if [[ -f "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.test/$DATE-full-results.md" ]]; then
    emit_pass "verify: created full results file"
else
    emit_fail "verify: failed to create full results"
fi

# 3. Assert: Summary updated
if grep -q "Last Checkpoint: full" "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.test/.summary.md"; then
    emit_pass "verify: updated .test/.summary.md"
else
    emit_fail "verify: failed to update summary"
fi

# Cleanup
rm -rf "$NB_WORKSPACES_ROOT"

summary
