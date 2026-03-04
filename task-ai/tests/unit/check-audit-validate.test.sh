#!/usr/bin/env bash
# Test: check.sh supports --checkpoint audit-validate
# Red/Green TDD - E4 test

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CHECK_SH="$PROJECT_ROOT/skills/check/scripts/check.sh"

echo "=== Test: check.sh --checkpoint audit-validate ==="

# Test 1: audit-validate checkpoint handling exists
echo -n "Test 1: audit-validate checkpoint in check.sh... "
if grep -qE 'CHECKPOINT.*==.*"audit-validate"|"audit-validate".*CHECKPOINT' "$CHECK_SH"; then
    echo "PASS"
else
    echo "FAIL: audit-validate checkpoint not found in check.sh"
    exit 1
fi

# Test 2: Processes .evolving-rules directory
echo -n "Test 2: References .evolving-rules directory... "
if grep -qE '\.evolving-rules|EVOLVING_RULES|evolving.rules' "$CHECK_SH"; then
    echo "PASS"
else
    echo "FAIL: No reference to evolving-rules directory"
    exit 1
fi

# Test 3: Has precision calculation or threshold check
echo -n "Test 3: Precision threshold logic exists... "
if grep -qE 'PRECISION|precision|0\.80|0.8' "$CHECK_SH"; then
    echo "PASS"
else
    echo "FAIL: No precision threshold logic found"
    exit 1
fi

# Test 4: Moves files between candidates/active/review
echo -n "Test 4: File movement logic (mv to active/review)... "
if grep -qE 'mv.*active|mv.*review|ACTIVATED|REVIEW' "$CHECK_SH"; then
    echo "PASS"
else
    echo "FAIL: No file movement logic found"
    exit 1
fi

echo "=== All E4 tests passed ==="
