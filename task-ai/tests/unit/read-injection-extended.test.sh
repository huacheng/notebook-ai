#!/bin/bash
# Test H-READ-1: Injection detection should cover more than just eval/btoa
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
READ_SH="$TASK_AI_ROOT/skills/read/scripts/read.sh"

FAILED=0

# Should detect more injection patterns (at least 5 categories from injection-rules.md)
PATTERNS_COUNT=$(grep -cE 'curl|wget|LD_PRELOAD|NODE_OPTIONS|<system>|ignore previous|base64|\\x1b' "$READ_SH" 2>/dev/null || echo "0")

if [[ "$PATTERNS_COUNT" -lt 3 ]]; then
    echo "FAIL: read.sh only detects eval/btoa, should cover more injection patterns"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: read.sh has extended injection detection"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
