#!/bin/bash
# Test H-AUTO-1: ACTION variable should have default value
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUTO_SH="$TASK_AI_ROOT/skills/auto/scripts/auto.sh"

FAILED=0

# Should initialize ACTION before the while loop
if ! grep -qE 'ACTION="[^"]*"' "$AUTO_SH" | head -1 | grep -qE '^[^#]*ACTION='; then
    # Check if there's a default value before the case statement
    if ! awk '/^while/,/^done/' "$AUTO_SH" | grep -q 'ACTION='; then
        # Look for ACTION initialization before while loop
        if ! awk '1;/^while/{exit}' "$AUTO_SH" | grep -qE '^ACTION='; then
            echo "FAIL: ACTION variable not initialized with default value"
            ((FAILED++)) || true
        fi
    fi
fi

# More precise check: ACTION should be defined before the while loop
BEFORE_WHILE=$(awk '1;/^while/{exit}' "$AUTO_SH")
if ! echo "$BEFORE_WHILE" | grep -qE '^ACTION='; then
    echo "FAIL: ACTION not initialized before option parsing"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: ACTION variable properly initialized"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
