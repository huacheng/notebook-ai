#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Red: signal-writer.sh does not exist yet → source fails → test fails
source "$SCRIPT_DIR/skills/auto/scripts/signal-writer.sh"

# Setup: create base signal file
cat > "$TEST_DIR/.auto-signal" <<'EOF'
{
  "step": "check",
  "result": "PASS",
  "next": "exec",
  "iteration": 1,
  "phase": "planning",
  "phase_progress": 0.5,
  "check_score": null,
  "retry_count": 0,
  "delegation_failures": [],
  "timestamp": "2026-01-01T00:00:00Z"
}
EOF

# Test write_check_score
write_check_score "$TEST_DIR/.auto-signal" 0.85 0.90 0.80 0.85 0.88 0.82 0.85
OVERALL=$(python3 -c "import json; print(json.load(open('$TEST_DIR/.auto-signal'))['check_score']['overall'])")
if [[ "$OVERALL" != "0.85" ]]; then
  echo "FAIL: write_check_score overall=$OVERALL, expected 0.85"
  exit 1
fi
echo "PASS: write_check_score"

# Test write_phase
write_phase "$TEST_DIR/.auto-signal" "execution" 0.45
PHASE=$(python3 -c "import json; print(json.load(open('$TEST_DIR/.auto-signal'))['phase'])")
if [[ "$PHASE" != "execution" ]]; then
  echo "FAIL: write_phase phase=$PHASE, expected execution"
  exit 1
fi
echo "PASS: write_phase"

# Test increment_retry
increment_retry "$TEST_DIR/.auto-signal"
RETRY=$(python3 -c "import json; print(json.load(open('$TEST_DIR/.auto-signal'))['retry_count'])")
if [[ "$RETRY" != "1" ]]; then
  echo "FAIL: increment_retry retry_count=$RETRY, expected 1"
  exit 1
fi
increment_retry "$TEST_DIR/.auto-signal"
RETRY=$(python3 -c "import json; print(json.load(open('$TEST_DIR/.auto-signal'))['retry_count'])")
if [[ "$RETRY" != "2" ]]; then
  echo "FAIL: increment_retry retry_count=$RETRY, expected 2"
  exit 1
fi
echo "PASS: increment_retry"

# Test append_delegation_failure
append_delegation_failure "$TEST_DIR/.auto-signal" "verify@iter3"
FAILURES=$(python3 -c "import json; print(json.load(open('$TEST_DIR/.auto-signal'))['delegation_failures'])")
if [[ "$FAILURES" != "['verify@iter3']" ]]; then
  echo "FAIL: append_delegation_failure failures=$FAILURES"
  exit 1
fi
# Append same — should not duplicate
append_delegation_failure "$TEST_DIR/.auto-signal" "verify@iter3"
COUNT=$(python3 -c "import json; print(len(json.load(open('$TEST_DIR/.auto-signal'))['delegation_failures']))")
if [[ "$COUNT" != "1" ]]; then
  echo "FAIL: append_delegation_failure duplicated, count=$COUNT"
  exit 1
fi
echo "PASS: append_delegation_failure (no duplicates)"

# Test write_check_score on missing file → should return 1
if write_check_score "/nonexistent/.auto-signal" 0.5 0.5 0.5 0.5 0.5 0.5 0.5 2>/dev/null; then
  echo "FAIL: write_check_score should fail on missing file"
  exit 1
fi
echo "PASS: write_check_score rejects missing file"

echo ""
echo "ALL TESTS PASSED"
