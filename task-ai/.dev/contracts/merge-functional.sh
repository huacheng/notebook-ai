#!/usr/bin/env bash
# L2: Functional test for merge sub-command
# Verifies successful merge, status update, and cleanup.

source "$(dirname "$0")/lib.sh"

MERGE_SH="$TASK_AI_ROOT/skills/merge/scripts/merge.sh"
TEST_NB="merge-tdd-$(date +%s)"
export NB_WORKSPACES_ROOT="/tmp/merge-functional-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT

# Setup: Create a real git branch to merge
rm -rf "$NB_WORKSPACES_ROOT" && mkdir -p "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working"
INDEX_JSON="$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working/.index.json"

# Create branch
BRANCH="task/$TEST_NB"
git branch "$BRANCH" > /dev/null 2>&1

# 使用 cat 生成合法的 JSON
cat > "$INDEX_JSON" <<EOF
{
  "status": "executing",
  "branch": "$BRANCH",
  "worktree": ""
}
EOF

# Act
"$MERGE_SH" "$TEST_NB" > /dev/null

# 1. Assert: Status is complete
STATE_PY="$TASK_AI_ROOT/core/state.py"
STATUS=$(python3 "$STATE_PY" get "$INDEX_JSON" status)
if [[ "$STATUS" == "complete" ]]; then
    emit_pass "merge: updated status to complete"
else
    emit_fail "merge: failed status update (status: $STATUS)"
fi

# 2. Assert: Branch metadata cleared
BRANCH_META=$(python3 "$STATE_PY" get "$INDEX_JSON" branch)
if [[ -z "$BRANCH_META" ]]; then
    emit_pass "merge: cleared branch metadata"
else
    emit_fail "merge: failed to clear metadata"
fi

# 3. Assert: Branch deleted
if ! git branch --list "$BRANCH" | grep -q "$TEST_NB"; then
    emit_pass "merge: successfully deleted task branch"
else
    emit_fail "merge: failed to delete branch"
fi

# --- Test: merge SKILL.md resolves signal path before worktree removal ---
MERGE_SKILL="$TASK_AI_ROOT/skills/merge/SKILL.md"
STEPS=$(extract_steps "$MERGE_SKILL")

# Find the line numbers for signal path resolution and worktree removal
RESOLVE_LINE=$(echo "$STEPS" | grep -n "Resolve main worktree path\|resolve.*signal.*path\|cache.*main.*path" | head -1 | cut -d: -f1)
REMOVE_LINE=$(echo "$STEPS" | grep -n "worktree remove\|worktree.*removal" | head -1 | cut -d: -f1)

if [[ -n "$RESOLVE_LINE" && -n "$REMOVE_LINE" ]]; then
  if [[ "$RESOLVE_LINE" -lt "$REMOVE_LINE" ]]; then
    emit_pass "merge: signal path resolved before worktree removal"
  else
    emit_fail "merge: signal path resolved AFTER worktree removal — path may be invalid"
  fi
else
  # If resolve is embedded in the signal step (step 9) which comes after step 8 (removal),
  # that's the bug — resolution should be a separate earlier step
  SIGNAL_STEP=$(echo "$STEPS" | grep -n "auto-signal" | head -1 | cut -d: -f1)
  WORKTREE_STEP=$(echo "$STEPS" | grep -n "worktree remove" | head -1 | cut -d: -f1)
  if [[ -n "$SIGNAL_STEP" && -n "$WORKTREE_STEP" && "$SIGNAL_STEP" -gt "$WORKTREE_STEP" ]]; then
    emit_fail "merge: signal write (with path resolution) comes after worktree removal step"
  else
    emit_pass "merge: signal write order is safe"
  fi
fi

# Cleanup
git branch -D "$BRANCH" > /dev/null 2>&1
rm -rf "$NB_WORKSPACES_ROOT"

summary
