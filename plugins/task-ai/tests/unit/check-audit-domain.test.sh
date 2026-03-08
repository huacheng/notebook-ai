#!/bin/bash
# Test: check.sh loads rules from audit domain
# Red/Green TDD: check.sh should use .evolving-rules/audit/active/
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK_SH="$TASK_AI_ROOT/skills/check/scripts/check.sh"

FAILED=0

echo "--- check.sh Audit Domain Tests ---"

# Test 1: check.sh references rule-loader.sh or audit domain
if grep -qE "rule-loader\.sh|evolving-rules/audit|load_rules_from_domain.*audit" "$CHECK_SH"; then
    echo "PASS: check.sh references audit domain"
else
    echo "FAIL: check.sh should reference audit domain or rule-loader.sh"
    ((FAILED++)) || true
fi

# Test 2: check.sh has load_audit_rules function or uses rule-loader
if grep -qE "load_audit_rules|load_rules_from_domain|AUDIT_RULES" "$CHECK_SH"; then
    echo "PASS: check.sh has audit rule loading mechanism"
else
    echo "FAIL: check.sh should have audit rule loading mechanism"
    ((FAILED++)) || true
fi

# Summary
echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "PASS: All check.sh audit tests passed"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
