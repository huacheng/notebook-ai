#!/usr/bin/env bash
# L2: Functional test for merge sub-command
# Verifies successful merge, status update, and that branch/worktree are NOT cleaned up.

source "$(dirname "$0")/lib.sh"

MERGE_SH="$TASK_AI_ROOT/skills/merge/scripts/merge.sh"
TEST_NB="merge-tdd-$(date +%s)"
export NB_WORKSPACES_ROOT="/tmp/merge-functional-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT

# Setup: Create a real git branch to merge
rm -rf "$NB_WORKSPACES_ROOT" && mkdir -p "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working"
STATUS_JSON="$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working/.status.json"

# Create branch
BRANCH="task/$TEST_NB"
git branch "$BRANCH" > /dev/null 2>&1

cat > "$STATUS_JSON" <<EOF
{
  "status": "executing",
  "branch": "$BRANCH",
  "worktree": ""
}
EOF

# Act
"$MERGE_SH" "$TEST_NB" > /dev/null

STATE_PY="$TASK_AI_ROOT/core/state.py"

# ============================================================
# Type 1: Merge works correctly (positive tests)
# ============================================================

# 1.1 Status should be complete
STATUS=$(python3 "$STATE_PY" get "$STATUS_JSON" status)
if [[ "$STATUS" == "complete" ]]; then
    emit_pass "merge: updated status to complete"
else
    emit_fail "merge: failed status update (status: $STATUS)"
fi

# ============================================================
# Type 2: Branch/worktree NOT deleted (negative tests)
# ============================================================

# 2.1 Branch metadata should be RETAINED (not cleared)
BRANCH_META=$(python3 "$STATE_PY" get "$STATUS_JSON" branch)
if [[ "$BRANCH_META" == "$BRANCH" ]]; then
    emit_pass "merge: retained branch metadata"
else
    emit_fail "merge: branch metadata was cleared (got: '$BRANCH_META', expected: '$BRANCH')"
fi

# 2.2 Task branch should still exist (not deleted)
if git branch --list "$BRANCH" | grep -q "$TEST_NB"; then
    emit_pass "merge: task branch still exists after merge"
else
    emit_fail "merge: task branch was deleted (should be retained)"
fi

# --- Spec verification: SKILL.md should NOT mention worktree removal or branch deletion ---
MERGE_SKILL="$TASK_AI_ROOT/skills/merge/SKILL.md"

# 2.3 Phase 4 should not contain worktree removal steps
if grep -q "worktree remove" "$MERGE_SKILL"; then
    emit_fail "merge: SKILL.md still contains 'worktree remove' instructions"
else
    emit_pass "merge: SKILL.md does not contain worktree removal"
fi

# 2.4 Phase 4 should not contain branch deletion steps
if grep -q "git branch -d" "$MERGE_SKILL"; then
    emit_fail "merge: SKILL.md still contains 'git branch -d' instructions"
else
    emit_pass "merge: SKILL.md does not contain branch deletion"
fi

# Cleanup test branch (test infra cleanup, not merge's job)
git branch -D "$BRANCH" > /dev/null 2>&1
rm -rf "$NB_WORKSPACES_ROOT"

summary
