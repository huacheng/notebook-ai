#!/usr/bin/env bash
# L2: Functional test for exec sub-command
# Verifies step-by-step progress tracking.

source "$(dirname "$0")/lib.sh"

EXEC_SH="$TASK_AI_ROOT/skills/exec/scripts/exec.sh"
STATE_PY="$TASK_AI_ROOT/core/state.py"
TEST_NB="exec-tdd-$(date +%s)"
export NB_WORKSPACES_ROOT="/tmp/exec-functional-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT

# Setup
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working"
STATUS_JSON="$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working/.status.json"
echo '{"completed_steps":0, "type":"software"}' > "$STATUS_JSON"

# Act: Run Step 1
"$EXEC_SH" "$TEST_NB" > /dev/null

# 1. Assert: Progress is 1
CUR_PROG=$(python3 "$STATE_PY" get "$STATUS_JSON" completed_steps)
if [[ "$CUR_PROG" == "1" ]]; then
    emit_pass "exec: incremented progress to 1"
else
    emit_fail "exec: failed to increment progress (prog: $CUR_PROG)"
fi

# 2. Assert: Exec note created
DATE=$(date +%Y-%m-%d)
if [[ -f "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working/.notes/$DATE-step-1-exec.md" ]]; then
    emit_pass "exec: created step note"
else
    emit_fail "exec: failed to create note"
fi

# Act: Run Step 2
"$EXEC_SH" "$TEST_NB" > /dev/null

# 3. Assert: Progress is 2
CUR_PROG=$(python3 "$STATE_PY" get "$STATUS_JSON" completed_steps)
if [[ "$CUR_PROG" == "2" ]]; then
    emit_pass "exec: incremented progress to 2"
else
    emit_fail "exec: failed to increment progress"
fi

# --- Test: exec SKILL.md uses "dependency-blocked" checkpoint (consistent with merge) ---
EXEC_SKILL="$TASK_AI_ROOT/skills/exec/SKILL.md"
# Check the .auto-signal table for blocking dependency row
if grep -A1 'Blocking dependency' "$EXEC_SKILL" | grep -q 'dependency-blocked'; then
  emit_pass "exec: dependency-blocked checkpoint matches merge convention"
else
  emit_fail "exec: blocking dependency signal uses empty checkpoint — should use 'dependency-blocked' like merge"
fi

# --- Test: exec SKILL.md references verification-first-protocol.md ---
EXEC_SKILL="$TASK_AI_ROOT/skills/exec/SKILL.md"
if grep -q "verification-first-protocol.md" "$EXEC_SKILL"; then
  emit_pass "exec: references verification-first-protocol.md"
else
  emit_fail "exec: uses VFP concepts (VH/HS/CGG) but missing cross-reference to verification-first-protocol.md"
fi

# --- Test: exec SKILL.md injection category count says "ten" not "nine" ---
EXEC_SKILL="$TASK_AI_ROOT/skills/exec/SKILL.md"
if grep -qi 'nine.*categor' "$EXEC_SKILL"; then
  emit_fail "exec: says 'nine categories' but injection-rules.md defines ten"
else
  emit_pass "exec: injection category count is correct"
fi

# Cleanup
rm -rf "$NB_WORKSPACES_ROOT"

summary
