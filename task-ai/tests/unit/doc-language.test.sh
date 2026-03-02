#!/bin/bash
# Test C-DOC-1, H-DOC-1, H-DOC-2: Document consistency checks
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FAILED=0

# C-DOC-1: No broken "the agent" phrase (should be "Claude" or "the AI")
if grep -qE 'single the agent|the agent checks|the agent performs|the agent fills|the agent writes|the agent evaluates|the agent naturally|the agent loses|the agent remembers|the agent tracks' "$TASK_AI_ROOT/skills/auto/SKILL.md"; then
    echo "FAIL: auto/SKILL.md has broken 'the agent' phrases"
    ((FAILED++)) || true
fi

# H-DOC-1: Compression threshold should be consistent (82%, not 70%)
if grep -qE '≥\s*70%' "$TASK_AI_ROOT/skills/auto/SKILL.md"; then
    echo "FAIL: auto/SKILL.md has inconsistent 70% threshold (should be 82%)"
    ((FAILED++)) || true
fi

# H-DOC-2: highlight scope count should be consistent (6, not 7)
if grep -q '7 scopes' "$TASK_AI_ROOT/skills/highlight/SKILL.md"; then
    echo "FAIL: highlight/SKILL.md has inconsistent '7 scopes' (should be 6)"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: All documentation consistency checks passed"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
