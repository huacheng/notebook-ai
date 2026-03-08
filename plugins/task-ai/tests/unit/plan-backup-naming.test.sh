#!/bin/bash
# Test H-PLAN-1: Plan backup should use .plan-superseded.md, not .bak
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLAN_SH="$TASK_AI_ROOT/skills/plan/scripts/plan.sh"

FAILED=0

# Should NOT use .bak extension
if grep -q '\.bak' "$PLAN_SH"; then
    echo "FAIL: plan.sh uses .bak extension for backup"
    ((FAILED++)) || true
fi

# Should use .plan-superseded pattern
if ! grep -q 'superseded' "$PLAN_SH"; then
    echo "FAIL: plan.sh does not use superseded naming convention"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: plan.sh uses correct backup naming"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
