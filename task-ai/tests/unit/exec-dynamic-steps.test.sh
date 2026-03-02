#!/bin/bash
# Test H-EXEC-1: TOTAL_STEPS should be read from .plan.md, not hardcoded
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXEC_SH="$TASK_AI_ROOT/skills/exec/scripts/exec.sh"

FAILED=0

# Should NOT hardcode TOTAL_STEPS
if grep -qE 'TOTAL_STEPS\s*=\s*[0-9]+' "$EXEC_SH"; then
    echo "FAIL: exec.sh hardcodes TOTAL_STEPS"
    ((FAILED++)) || true
fi

# Should read steps from .plan.md
if ! grep -qE '\.plan\.md' "$EXEC_SH"; then
    echo "FAIL: exec.sh does not reference .plan.md for step count"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: exec.sh uses dynamic step count"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
