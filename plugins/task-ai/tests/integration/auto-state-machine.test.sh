#!/usr/bin/env bash
# Integration test: Auto loop state machine — entry routing + signal output for all statuses
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUTO_SH="$SCRIPT_DIR/skills/auto/scripts/auto.sh"
STATE_PY="$SCRIPT_DIR/core/state.py"

PASS=0
FAIL=0

assert_signal() {
    local label="$1" signal_file="$2" field="$3" expected="$4"
    local actual
    actual=$(python3 -c "import json; d=json.load(open('$signal_file')); print(d.get('$field', 'MISSING'))")
    if [[ "$actual" == "$expected" ]]; then
        PASS=$((PASS + 1))
    else
        echo "FAIL [$label]: $field expected='$expected' got='$actual'"
        FAIL=$((FAIL + 1))
    fi
}

assert_no_signal() {
    local label="$1" signal_file="$2"
    if [[ ! -f "$signal_file" ]]; then
        PASS=$((PASS + 1))
    else
        echo "FAIL [$label]: .auto-signal should NOT exist for terminal state"
        FAIL=$((FAIL + 1))
    fi
}

assert_exit_message() {
    local label="$1" output="$2" expected="$3"
    if echo "$output" | grep -q "$expected"; then
        PASS=$((PASS + 1))
    else
        echo "FAIL [$label]: expected output containing '$expected'"
        FAIL=$((FAIL + 1))
    fi
}

# Helper: set up a notebook with given status and run auto.sh
run_auto_with_status() {
    local status="$1"
    local phase="${2:-}"
    local extra_target="${3:-}"

    local test_dir
    test_dir=$(mktemp -d)

    mkdir -p "$test_dir/test-nb/.working"
    local wd="$test_dir/test-nb/.working"

    # Write .status.json via state.py-compatible JSON
    python3 - "$wd/.status.json" "$status" "$phase" <<'PYEOF'
import json, sys, os
status_file, status, phase = sys.argv[1], sys.argv[2], sys.argv[3]
data = {"name": "test-nb", "status": status, "type": "software", "phase": phase}
with open(status_file, 'w') as f:
    json.dump(data, f, indent=2)
PYEOF

    # Write .target.md (configurable content)
    if [[ -n "$extra_target" ]]; then
        echo "$extra_target" > "$wd/.target.md"
    else
        cat > "$wd/.target.md" <<'EOF'
# Test Target
## Research Insights
- Background info
## Requirements
- Implement feature X
EOF
    fi

    # Run auto.sh from the .working directory
    local output
    output=$(cd "$wd" && NB_WORKSPACES_ROOT="$test_dir" bash "$AUTO_SH" 2>&1) || true

    # Return test_dir and output via global vars
    _TEST_DIR="$test_dir"
    _OUTPUT="$output"
    _SIGNAL="$wd/.auto-signal"
}

cleanup() {
    [[ -n "${_TEST_DIR:-}" ]] && rm -rf "$_TEST_DIR"
}

# ─────────────────────────────────────────────────────────────
# Test 1: status=draft with complete target → plan
# ─────────────────────────────────────────────────────────────
run_auto_with_status "draft"
assert_signal "draft→plan" "$_SIGNAL" "step" "plan"
assert_signal "draft→plan" "$_SIGNAL" "next" "check"
assert_signal "draft→plan" "$_SIGNAL" "phase" "target"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 2: status=draft without Research Insights → research
# ─────────────────────────────────────────────────────────────
run_auto_with_status "draft" "" "# Target
## Requirements
- Feature X"
assert_signal "draft→research" "$_SIGNAL" "step" "research"
assert_signal "draft→research" "$_SIGNAL" "next" "(stop)"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 3: status=draft with [PROPOSED] → pause (no signal)
# ─────────────────────────────────────────────────────────────
run_auto_with_status "draft" "" "# Target
## Requirements
- [PROPOSED] Feature Y"
assert_no_signal "draft+PROPOSED" "$_SIGNAL"
assert_exit_message "draft+PROPOSED" "$_OUTPUT" "PROPOSED"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 4: status=planning → verify
# ─────────────────────────────────────────────────────────────
run_auto_with_status "planning"
assert_signal "planning→verify" "$_SIGNAL" "step" "verify"
assert_signal "planning→verify" "$_SIGNAL" "next" "check"
assert_signal "planning→verify" "$_SIGNAL" "phase" "planning"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 5: status=re-planning, phase=needs-check → verify
# ─────────────────────────────────────────────────────────────
run_auto_with_status "re-planning" "needs-check"
assert_signal "replan+needs-check→verify" "$_SIGNAL" "step" "verify"
assert_signal "replan+needs-check→verify" "$_SIGNAL" "next" "check"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 6: status=re-planning, phase="" → plan
# ─────────────────────────────────────────────────────────────
run_auto_with_status "re-planning" ""
assert_signal "replan→plan" "$_SIGNAL" "step" "plan"
assert_signal "replan→plan" "$_SIGNAL" "next" "check"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 7: status=review → exec
# ─────────────────────────────────────────────────────────────
run_auto_with_status "review"
assert_signal "review→exec" "$_SIGNAL" "step" "exec"
assert_signal "review→exec" "$_SIGNAL" "next" "verify"
assert_signal "review→exec" "$_SIGNAL" "phase" "execution"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 8: status=executing → verify
# ─────────────────────────────────────────────────────────────
run_auto_with_status "executing"
assert_signal "executing→verify" "$_SIGNAL" "step" "verify"
assert_signal "executing→verify" "$_SIGNAL" "next" "check"
assert_signal "executing→verify" "$_SIGNAL" "phase" "execution"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 9: status=satisfied → report
# ─────────────────────────────────────────────────────────────
run_auto_with_status "satisfied"
assert_signal "satisfied→report" "$_SIGNAL" "step" "report"
assert_signal "satisfied→report" "$_SIGNAL" "next" "(stop)"
assert_signal "satisfied→report" "$_SIGNAL" "phase" "finalization"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 10: status=evolving → highlight
# ─────────────────────────────────────────────────────────────
run_auto_with_status "evolving"
assert_signal "evolving→highlight" "$_SIGNAL" "step" "highlight"
assert_signal "evolving→highlight" "$_SIGNAL" "next" "report"
assert_signal "evolving→highlight" "$_SIGNAL" "phase" "finalization"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 11: status=blocked → no signal, exit message
# ─────────────────────────────────────────────────────────────
run_auto_with_status "blocked"
assert_no_signal "blocked" "$_SIGNAL"
assert_exit_message "blocked" "$_OUTPUT" "BLOCKED"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 12: status=cancelled → no signal, exit message
# ─────────────────────────────────────────────────────────────
run_auto_with_status "cancelled"
assert_no_signal "cancelled" "$_SIGNAL"
assert_exit_message "cancelled" "$_OUTPUT" "CANCELLED"
cleanup

# ─────────────────────────────────────────────────────────────
# Test 13: --stop writes .auto-stop
# ─────────────────────────────────────────────────────────────
STOP_DIR=$(mktemp -d)
mkdir -p "$STOP_DIR/test-nb/.working"
python3 -c "import json; json.dump({'status':'executing','type':'software','phase':''}, open('$STOP_DIR/test-nb/.working/.status.json','w'))"
cat > "$STOP_DIR/test-nb/.working/.target.md" <<'EOF'
# Target
## Research Insights
- info
## Requirements
- X
EOF
(cd "$STOP_DIR/test-nb/.working" && NB_WORKSPACES_ROOT="$STOP_DIR" bash "$AUTO_SH" --stop 2>&1) || true
STOP_FILE="$STOP_DIR/test-nb/.working/.auto-stop"
if [[ -f "$STOP_FILE" ]]; then
    REASON=$(python3 -c "import json; print(json.load(open('$STOP_FILE'))['reason'])")
    if [[ "$REASON" == "user_stop" ]]; then
        PASS=$((PASS + 1))
    else
        echo "FAIL [stop]: reason expected 'user_stop' got '$REASON'"
        FAIL=$((FAIL + 1))
    fi
else
    echo "FAIL [stop]: .auto-stop not created"
    FAIL=$((FAIL + 1))
fi
rm -rf "$STOP_DIR"

# ─────────────────────────────────────────────────────────────
# Test 14: signal fields completeness (iteration, retry_count, etc.)
# ─────────────────────────────────────────────────────────────
run_auto_with_status "planning"
python3 - "$_SIGNAL" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    s = json.load(f)
required = ['step', 'result', 'next', 'iteration', 'compaction_count', 'phase',
            'phase_progress', 'check_score', 'retry_count', 'delegation_failures', 'timestamp']
missing = [k for k in required if k not in s]
if missing:
    print(f"MISSING fields: {missing}")
    sys.exit(1)
assert s['iteration'] == 1
assert s['compaction_count'] == 0
assert s['retry_count'] == 0
assert s['delegation_failures'] == []
assert s['check_score'] is None
assert isinstance(s['phase_progress'], float)
PYEOF
if [[ $? -eq 0 ]]; then
    PASS=$((PASS + 1))
else
    echo "FAIL [signal-fields]: missing or invalid fields"
    FAIL=$((FAIL + 1))
fi
cleanup

# ─────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  Auto State Machine: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
