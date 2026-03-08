#!/bin/bash
# Test H-AUTO-2: draft routing should check for [PROPOSED] markers
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUTO_SH="$TASK_AI_ROOT/skills/auto/scripts/auto.sh"

FAILED=0

# draft case should check for PROPOSED markers or research insights
if ! grep -A15 'draft)' "$AUTO_SH" | grep -qE 'PROPOSED|Research Insights|TARGET_MD'; then
    echo "FAIL: draft routing does not check for PROPOSED markers or research status"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: draft routing checks for PROPOSED markers"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
