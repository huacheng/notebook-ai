#!/usr/bin/env bash
# Test: check SKILL.md has context scope definition
# Red/Green TDD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CHECK_SKILL="$PROJECT_ROOT/skills/check/SKILL.md"

echo "=== Test: check scope=context definition ==="

# Test 1: SKILL.md has scope definitions section
echo -n "Test 1: Has Scope Definitions section... "
if grep -qE "^## Scope Definitions" "$CHECK_SKILL"; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

# Test 2: Has context scope (§S1)
echo -n "Test 2: Has scope=context (§S1)... "
if grep -qE "scope=context|§S1.*context" "$CHECK_SKILL"; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

# Test 3: Context scope is independent (not inline)
echo -n "Test 3: Context is independent execution... "
if grep -qE "context.*independent|Caller.*None.*independent" "$CHECK_SKILL"; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

# Test 4: Has gated execution for context
echo -n "Test 4: Context uses gated execution... "
if grep -qE "Gate.*1.*D2|Gated Execution" "$CHECK_SKILL"; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

# Test 5: Has dimension adaptation table
echo -n "Test 5: Has dimension adaptation by review type... "
if grep -qE "plan.*fix.*design.*code|Dimension Adaptation" "$CHECK_SKILL"; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

# Test 6: Conversational output (no files)
echo -n "Test 6: Context scope is conversational (no files)... "
if grep -qE "Does NOT Write Files|no.*\.analysis|conversational" "$CHECK_SKILL"; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

# Test 7: Has lifecycle scope (§S2)
echo -n "Test 7: Has scope=lifecycle (§S2)... "
if grep -qE "scope=lifecycle|§S2.*lifecycle" "$CHECK_SKILL"; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

# Test 8: Has skill scope (§S3)
echo -n "Test 8: Has scope=skill (§S3)... "
if grep -qE "scope=skill|§S3.*skill" "$CHECK_SKILL"; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

echo "=== All context scope tests passed ==="
