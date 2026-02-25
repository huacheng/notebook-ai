#!/usr/bin/env bash
# L2: Functional test for auto sub-command
# Verifies entry-point routing and signal generation.

source "$(dirname "$0")/lib.sh"

AUTO_SH="$TASK_AI_ROOT/skills/auto/scripts/auto.sh"
JSON_GET="$TASK_AI_ROOT/.dev/contracts/json_get.py"
TEST_NB="auto-tdd-$(date +%s)"
export NB_WORKSPACES_ROOT="/tmp/auto-functional-test"

# Setup
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working"
INDEX_JSON="$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working/.index.json"

# --- Test 1: Draft Entry ---
echo '{"status":"draft"}' > "$INDEX_JSON"
"$AUTO_SH" "$TEST_NB" > /dev/null
SIGNAL_FILE="$NB_WORKSPACES_ROOT/proj/$TEST_NB/.working/.auto-signal"
NEXT=$(python3 "$JSON_GET" "$SIGNAL_FILE" next)
if [[ "$NEXT" == "plan" ]]; then
    emit_pass "auto: correctly routed draft to plan"
else
    emit_fail "auto: wrong routing for draft (next: $NEXT)"
fi

# --- Test 2: Planning Entry ---
echo '{"status":"planning"}' > "$INDEX_JSON"
"$AUTO_SH" "$TEST_NB" > /dev/null
NEXT=$(python3 "$JSON_GET" "$SIGNAL_FILE" next)
if [[ "$NEXT" == "check" ]]; then
    emit_pass "auto: correctly routed planning to check"
else
    emit_fail "auto: wrong routing for planning"
fi

# --- Test: auto SKILL.md validates depends_on ---
AUTO_SKILL="$TASK_AI_ROOT/skills/auto/SKILL.md"
AUTO_STEPS=$(extract_steps "$AUTO_SKILL")

if echo "$AUTO_STEPS" | grep -qi "depends_on\|dependency.*gate\|validate.*dependenc"; then
  emit_pass "auto: execution steps include depends_on validation"
else
  emit_fail "auto: missing depends_on validation in loop — exec/merge have it but auto does not"
fi

# Cleanup
rm -rf "$NB_WORKSPACES_ROOT"

summary
