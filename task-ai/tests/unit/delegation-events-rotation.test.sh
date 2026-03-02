#!/bin/bash
# Test C-PERF-1: Delegation events should have size/rotation control documented
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOC_FILE="$TASK_AI_ROOT/skills/auto/references/plugin-delegation.md"

FAILED=0

# Should mention size/rotation control
if ! grep -qE 'rotation|max.*events|archive|compact|Size Control|Event Lifecycle' "$DOC_FILE"; then
    echo "FAIL: plugin-delegation.md has no event size/rotation documentation"
    ((FAILED++)) || true
fi

# Should mention specific limits
if ! grep -qE '[0-9]+\s*(events|lines|MB)' "$DOC_FILE"; then
    echo "FAIL: plugin-delegation.md has no specific size limits"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: Delegation events have size control documented"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
