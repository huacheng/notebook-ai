#!/usr/bin/env bash
# Test: highlight scope=promote - Experience to Skill Promotion
# Red/Green TDD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PROMOTE_SH="$PROJECT_ROOT/skills/highlight/scripts/promote.sh"

echo "=== Test: highlight scope=promote ==="

# Test 1: promote.sh exists
echo -n "Test 1: promote.sh exists... "
if [[ -f "$PROMOTE_SH" ]]; then
    echo "PASS"
else
    echo "FAIL: promote.sh not found at $PROMOTE_SH"
    exit 1
fi

# Test 2: Has proper shebang
echo -n "Test 2: promote.sh has proper shebang... "
if head -1 "$PROMOTE_SH" | grep -qE '^#!/usr/bin/env bash|^#!/bin/bash'; then
    echo "PASS"
else
    echo "FAIL: missing proper shebang"
    exit 1
fi

# Test 3: Checks quality_status trigger
echo -n "Test 3: Checks quality_status=verified... "
if grep -qE 'quality_status.*verified|verified.*quality_status' "$PROMOTE_SH"; then
    echo "PASS"
else
    echo "FAIL: no quality_status check"
    exit 1
fi

# Test 4: Checks usage_count trigger
echo -n "Test 4: Checks usage_count threshold... "
if grep -qE 'usage_count|USAGE_COUNT' "$PROMOTE_SH"; then
    echo "PASS"
else
    echo "FAIL: no usage_count check"
    exit 1
fi

# Test 5: Checks structural patterns
echo -n "Test 5: Checks for structural patterns (Patterns/Steps)... "
if grep -qE '## Patterns|## Steps|Patterns.*Steps' "$PROMOTE_SH"; then
    echo "PASS"
else
    echo "FAIL: no structural pattern check"
    exit 1
fi

# Test 6: Generates SKILL.md
echo -n "Test 6: Generates SKILL.md output... "
if grep -qE 'SKILL\.md|skill.*\.md' "$PROMOTE_SH"; then
    echo "PASS"
else
    echo "FAIL: no SKILL.md generation"
    exit 1
fi

# Test 7: Writes to .candidates directory
echo -n "Test 7: Writes to .candidates/ directory... "
if grep -qE '\.candidates|candidates/' "$PROMOTE_SH"; then
    echo "PASS"
else
    echo "FAIL: no .candidates directory reference"
    exit 1
fi

# Test 8: Generates trust-report.md
echo -n "Test 8: Generates trust-report.md... "
if grep -qE 'trust-report\.md|trust_report' "$PROMOTE_SH"; then
    echo "PASS"
else
    echo "FAIL: no trust-report.md generation"
    exit 1
fi

echo "=== All highlight scope=promote tests passed ==="
