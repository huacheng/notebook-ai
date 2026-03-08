#!/bin/bash
# Test H-INIT-1: init.sh should have rollback mechanism on failure
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INIT_SH="$TASK_AI_ROOT/skills/init/scripts/init.sh"

FAILED=0

# Should have cleanup/rollback trap
if ! grep -qE 'trap.*cleanup|trap.*ERR|trap.*EXIT' "$INIT_SH"; then
    echo "FAIL: init.sh has no trap for cleanup/rollback"
    ((FAILED++)) || true
fi

# Should have cleanup function
if ! grep -qE 'cleanup\s*\(\)|rollback\s*\(\)' "$INIT_SH"; then
    echo "FAIL: init.sh has no cleanup/rollback function"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: init.sh has proper rollback mechanism"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
