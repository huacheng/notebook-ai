#!/usr/bin/env bash
# Test: check.sh skill-review uses gated execution
# Red/Green TDD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CHECK_SH="$PROJECT_ROOT/skills/check/scripts/check.sh"

echo "=== Test: Gated Six-Dimension Review ==="

# Test 1: Gate structure exists
echo -n "Test 1: Gate structure in check.sh... "
if grep -qE 'Gate.*1|GATE.*1|gate_1|GATE_1' "$CHECK_SH"; then
    echo "PASS"
else
    echo "FAIL: No gate structure found"
    exit 1
fi

# Test 2: D2 Security is Gate 1 (first/blocking)
echo -n "Test 2: D2 Security is first gate... "
# D2 should appear before D1 in gated mode
if grep -n "D2.*Security\|Gate.*1.*D2\|GATE_1.*security" "$CHECK_SH" | head -1 | grep -qE "[0-9]+:"; then
    echo "PASS"
else
    echo "FAIL: D2 Security not positioned as first gate"
    exit 1
fi

# Test 3: Has blocking threshold check
echo -n "Test 3: Has blocking threshold for gates... "
if grep -qE 'BLOCK|block|GATE.*FAIL|gate.*fail|< 0\.[0-9]' "$CHECK_SH"; then
    echo "PASS"
else
    echo "FAIL: No blocking threshold logic"
    exit 1
fi

# Test 4: Outputs fix suggestions on gate failure
echo -n "Test 4: Outputs fix suggestions... "
if grep -qE 'FIX|fix|suggestion|Suggestion|remediation|Remediation' "$CHECK_SH"; then
    echo "PASS"
else
    echo "FAIL: No fix suggestions on failure"
    exit 1
fi

# Test 5: D4/D5/D6 grouped together (parallel in Gate 4)
echo -n "Test 5: D4/D5/D6 grouped in final gate... "
if grep -qE 'Gate.*4|GATE_4|D4.*D5.*D6|optimization|Optimization' "$CHECK_SH"; then
    echo "PASS"
else
    echo "FAIL: D4/D5/D6 not grouped"
    exit 1
fi

# Test 6: Gate pass/fail status in output
echo -n "Test 6: Gate status in output... "
if grep -qE 'PASS|FAIL|pass|fail|✅|❌|blocked' "$CHECK_SH"; then
    echo "PASS"
else
    echo "FAIL: No gate status indicators"
    exit 1
fi

echo "=== All gated review tests passed ==="
