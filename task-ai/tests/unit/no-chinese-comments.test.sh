#!/bin/bash
# Test H-DOC-3: Scripts should not have Chinese comments
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FAILED=0

# Check for Chinese characters in shell scripts (excluding test files)
CHINESE_LINES=$(grep -rn '[一-龥]' "$TASK_AI_ROOT/skills/"*/scripts/*.sh "$TASK_AI_ROOT/core/"*.sh 2>/dev/null | grep -v 'test' || true)

if [[ -n "$CHINESE_LINES" ]]; then
    echo "FAIL: Found Chinese text in scripts:"
    echo "$CHINESE_LINES" | head -5
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: No Chinese comments in scripts"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
