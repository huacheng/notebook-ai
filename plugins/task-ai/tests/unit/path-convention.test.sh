#!/bin/bash
# Test C-PATH-1: No ../ path patterns in WORK_DIR references
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Check for $WORK_DIR/../ pattern which should be $WORK_DIR/
VIOLATIONS=$(grep -rn '\$WORK_DIR/\.\./' "$TASK_AI_ROOT/skills/"*/scripts/*.sh 2>/dev/null || true)

if [[ -n "$VIOLATIONS" ]]; then
    echo "FAIL: Found ../ path pattern violations:"
    echo "$VIOLATIONS"
    exit 1
fi

echo "PASS: No ../ path violations found"
exit 0
