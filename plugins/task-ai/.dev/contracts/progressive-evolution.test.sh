#!/usr/bin/env bash
# Contract tests for Progressive Evolution model changes
# Tests: state.py status validation, stage schema, merge signal, target --satisfy
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_PY="$TASK_AI_ROOT/core/state.py"
INIT_SCRIPT="$TASK_AI_ROOT/skills/init/scripts/init.sh"

PASS=0
FAIL=0
pass() { echo "PASS: $1"; ((PASS++)) || true; }
fail() { echo "FAIL: $1"; ((FAIL++)) || true; }

# Setup temp workspace
TEST_ROOT=$(mktemp -d)
trap "rm -rf $TEST_ROOT" EXIT

# Create a minimal .status.json for testing
STATUS_FILE="$TEST_ROOT/.status.json"
cat > "$STATUS_FILE" << 'EOF'
{
  "status": "draft",
  "stage": { "current": 1, "history": [] }
}
EOF

echo "=== Progressive Evolution Contract Tests ==="
echo ""

# ─────────────────────────────────────────────────────────────
# Group 1: state.py — new status validation
# ─────────────────────────────────────────────────────────────
echo "--- Group 1: state.py status validation ---"

# Test 1.1: 'evolving' is a valid status
if python3 "$STATE_PY" set "$STATUS_FILE" status evolving 2>/dev/null; then
    ACTUAL=$(python3 "$STATE_PY" get "$STATUS_FILE" status 2>/dev/null)
    if [[ "$ACTUAL" == "evolving" ]]; then
        pass "1.1 'evolving' accepted as valid status"
    else
        fail "1.1 'evolving' set but read back '$ACTUAL'"
    fi
else
    fail "1.1 'evolving' rejected — should be valid"
fi

# Test 1.2: 'satisfied' is a valid status
cat > "$STATUS_FILE" << 'EOF'
{ "status": "draft", "stage": { "current": 1, "history": [] } }
EOF
if python3 "$STATE_PY" set "$STATUS_FILE" status satisfied 2>/dev/null; then
    ACTUAL=$(python3 "$STATE_PY" get "$STATUS_FILE" status 2>/dev/null)
    if [[ "$ACTUAL" == "satisfied" ]]; then
        pass "1.2 'satisfied' accepted as valid status"
    else
        fail "1.2 'satisfied' set but read back '$ACTUAL'"
    fi
else
    fail "1.2 'satisfied' rejected — should be valid"
fi

# Test 1.3: 'complete' is REJECTED (hard upgrade)
cat > "$STATUS_FILE" << 'EOF'
{ "status": "draft", "stage": { "current": 1, "history": [] } }
EOF
if python3 "$STATE_PY" set "$STATUS_FILE" status complete 2>&1 >/dev/null; then
    fail "1.3 'complete' accepted — should be REJECTED (hard upgrade)"
else
    pass "1.3 'complete' rejected as invalid status"
fi

# Test 1.4: 'stage-done' is REJECTED (hard upgrade)
cat > "$STATUS_FILE" << 'EOF'
{ "status": "draft", "stage": { "current": 1, "history": [] } }
EOF
if python3 "$STATE_PY" set "$STATUS_FILE" status stage-done 2>&1 >/dev/null; then
    fail "1.4 'stage-done' accepted — should be REJECTED (hard upgrade)"
else
    pass "1.4 'stage-done' rejected as invalid status"
fi

# ─────────────────────────────────────────────────────────────
# Group 2: state.py — stage schema (history replaces completed)
# ─────────────────────────────────────────────────────────────
echo ""
echo "--- Group 2: stage schema ---"

# Test 2.1: transition --stage-history appends to stage.history[]
cat > "$STATUS_FILE" << 'EOF'
{ "status": "evolving", "stage": { "current": 1, "history": [] } }
EOF
if python3 "$STATE_PY" transition "$STATUS_FILE" --stage-history '{"stage":1,"name":"auth","completed_at":"2026-03-07T00:00:00Z"}' 2>/dev/null; then
    HISTORY=$(python3 "$STATE_PY" get "$STATUS_FILE" stage.history 2>/dev/null)
    if [[ -n "$HISTORY" && "$HISTORY" != "[]" && "$HISTORY" != "" ]]; then
        pass "2.1 --stage-history appends to stage.history[]"
    else
        fail "2.1 --stage-history did not populate stage.history (got: '$HISTORY')"
    fi
else
    fail "2.1 --stage-history flag not recognized"
fi

# Test 2.2: old --stage-completed flag is NOT recognized
cat > "$STATUS_FILE" << 'EOF'
{ "status": "evolving", "stage": { "current": 1, "history": [] } }
EOF
if python3 "$STATE_PY" transition "$STATUS_FILE" --stage-completed "auth" 2>&1 >/dev/null; then
    fail "2.2 --stage-completed still accepted — should be removed"
else
    pass "2.2 --stage-completed rejected (removed)"
fi

# ─────────────────────────────────────────────────────────────
# Group 3: init.sh — stage schema without total
# ─────────────────────────────────────────────────────────────
echo ""
echo "--- Group 3: init.sh stage template ---"

# Test 3.1: init.sh creates status.json without stage.total
# We'll parse the init script template directly instead of running full init
if grep -q '"total"' "$INIT_SCRIPT" 2>/dev/null; then
    fail "3.1 init.sh still contains stage.total in template"
else
    pass "3.1 init.sh does not contain stage.total"
fi

# Test 3.2: init.sh uses 'history' not 'completed'
if grep -q '"completed"' "$INIT_SCRIPT" 2>/dev/null; then
    fail "3.2 init.sh still uses 'completed' field"
else
    pass "3.2 init.sh uses 'history' instead of 'completed'"
fi

# ─────────────────────────────────────────────────────────────
# Group 4: Documentation contracts (grep-based)
# ─────────────────────────────────────────────────────────────
echo ""
echo "--- Group 4: Documentation contracts ---"

# Test 4.1: state-matrix.md contains 'evolving'
if grep -q "evolving" "$TASK_AI_ROOT/commands/references/state-matrix.md" 2>/dev/null; then
    pass "4.1 state-matrix.md contains 'evolving'"
else
    fail "4.1 state-matrix.md missing 'evolving'"
fi

# Test 4.2: state-matrix.md contains 'satisfied'
if grep -q "satisfied" "$TASK_AI_ROOT/commands/references/state-matrix.md" 2>/dev/null; then
    pass "4.2 state-matrix.md contains 'satisfied'"
else
    fail "4.2 state-matrix.md missing 'satisfied'"
fi

# Test 4.3: task-ai.md contains Phase Awareness Protocol
if grep -q "Phase Awareness" "$TASK_AI_ROOT/commands/task-ai.md" 2>/dev/null; then
    pass "4.3 task-ai.md contains Phase Awareness Protocol"
else
    fail "4.3 task-ai.md missing Phase Awareness Protocol"
fi

# Test 4.4: task-ai.md stage schema uses 'history' not 'completed'
if grep -q '"history"' "$TASK_AI_ROOT/commands/task-ai.md" 2>/dev/null; then
    pass "4.4 task-ai.md stage schema uses 'history'"
else
    fail "4.4 task-ai.md stage schema missing 'history'"
fi

# Test 4.5: task-ai.md does NOT reference stage.total in schema
if grep -qE '"total":\s*1' "$TASK_AI_ROOT/commands/task-ai.md" 2>/dev/null; then
    fail "4.5 task-ai.md still references stage.total in schema"
else
    pass "4.5 task-ai.md does not reference stage.total in schema"
fi

# ─────────────────────────────────────────────────────────────
# Group 5: .session-context removal
# ─────────────────────────────────────────────────────────────
echo ""
echo "--- Group 5: .session-context removal ---"

# Test 5.1: target.sh does NOT create .session-context
if grep -q "session-context\|session_context" "$TASK_AI_ROOT/skills/target/scripts/target.sh" 2>/dev/null; then
    fail "5.1 target.sh still references session-context"
else
    pass "5.1 target.sh has no session-context references"
fi

# Test 5.2: plan.sh does NOT reference .session-context
if grep -q "session-context\|session_context" "$TASK_AI_ROOT/skills/plan/scripts/plan.sh" 2>/dev/null; then
    fail "5.2 plan.sh still references session-context"
else
    pass "5.2 plan.sh has no session-context references"
fi

# Test 5.3: exec.sh does NOT reference .session-context
if grep -q "session-context\|session_context" "$TASK_AI_ROOT/skills/exec/scripts/exec.sh" 2>/dev/null; then
    fail "5.3 exec.sh still references session-context"
else
    pass "5.3 exec.sh has no session-context references"
fi

# ─────────────────────────────────────────────────────────────
# Group 6: merge.sh contracts
# ─────────────────────────────────────────────────────────────
echo ""
echo "--- Group 6: merge.sh contracts ---"

MERGE_SCRIPT="$TASK_AI_ROOT/skills/merge/scripts/merge.sh"

# Test 6.1: merge.sh does NOT read STAGE_TOTAL
if grep -q "STAGE_TOTAL" "$MERGE_SCRIPT" 2>/dev/null; then
    fail "6.1 merge.sh still references STAGE_TOTAL"
else
    pass "6.1 merge.sh has no STAGE_TOTAL reference"
fi

# Test 6.2: merge.sh uses 'evolving' signal result
if grep -q '"evolving"' "$MERGE_SCRIPT" 2>/dev/null; then
    pass "6.2 merge.sh uses 'evolving' signal result"
else
    fail "6.2 merge.sh missing 'evolving' signal result"
fi

# Test 6.3: merge.sh does NOT use 'success' or 'stage-done' result
if grep -qE '"success"|"stage-done"' "$MERGE_SCRIPT" 2>/dev/null; then
    fail "6.3 merge.sh still uses old 'success'/'stage-done' result values"
else
    pass "6.3 merge.sh has no old result values"
fi

# ─────────────────────────────────────────────────────────────
# Group 7: target.sh --satisfy
# ─────────────────────────────────────────────────────────────
echo ""
echo "--- Group 7: target.sh --satisfy ---"

TARGET_SCRIPT="$TASK_AI_ROOT/skills/target/scripts/target.sh"

# Test 7.1: target.sh recognizes --satisfy flag
if grep -q "\-\-satisfy" "$TARGET_SCRIPT" 2>/dev/null; then
    pass "7.1 target.sh recognizes --satisfy flag"
else
    fail "7.1 target.sh missing --satisfy flag"
fi

# Test 7.2: target.sh does NOT have --finalize flag
if grep -q "\-\-finalize" "$TARGET_SCRIPT" 2>/dev/null; then
    fail "7.2 target.sh still has --finalize flag"
else
    pass "7.2 target.sh removed --finalize flag"
fi

# ─────────────────────────────────────────────────────────────
# Group 8: auto.sh contracts
# ─────────────────────────────────────────────────────────────
echo ""
echo "--- Group 8: auto.sh contracts ---"

AUTO_SCRIPT="$TASK_AI_ROOT/skills/auto/scripts/auto.sh"

# Test 8.1: auto.sh uses 'evolving' not 'stage-done'
if grep -q "evolving)" "$AUTO_SCRIPT" 2>/dev/null; then
    pass "8.1 auto.sh routes 'evolving' status"
else
    fail "8.1 auto.sh missing 'evolving' routing"
fi

# Test 8.2: auto.sh uses 'satisfied' not 'complete'
if grep -q "satisfied)" "$AUTO_SCRIPT" 2>/dev/null; then
    pass "8.2 auto.sh routes 'satisfied' status"
else
    fail "8.2 auto.sh missing 'satisfied' routing"
fi

# Test 8.3: auto.sh does NOT use old status names in case routing
if grep -qE "complete\)|stage-done\)" "$AUTO_SCRIPT" 2>/dev/null; then
    fail "8.3 auto.sh still uses old status names in routing"
else
    pass "8.3 auto.sh has no old status names in routing"
fi

# ─────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
