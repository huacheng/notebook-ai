#!/bin/bash
# Test: init-lib.sh creates directories required by highlight
# Red/Green TDD: highlight needs .memory/.experiences/ and .memory/.type-profiles/
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INIT_LIB="$TASK_AI_ROOT/skills/library/scripts/init-lib.sh"

FAILED=0
TEST_TMP=$(mktemp -d)
trap "rm -rf $TEST_TMP" EXIT

export NB_WORKSPACES_LIBRARY="$TEST_TMP/.library"

echo "--- init-lib.sh Highlight Directories Tests ---"

# Run init-lib.sh
bash "$INIT_LIB" >/dev/null 2>&1 || true

# Test 1: .memory/.experiences/ exists
if [[ -d "$NB_WORKSPACES_LIBRARY/.memory/.experiences" ]]; then
    echo "PASS: .memory/.experiences/ created"
else
    echo "FAIL: .memory/.experiences/ not created (required by highlight scope=impl/verify/complete/adhoc)"
    ((FAILED++)) || true
fi

# Test 2: .memory/.type-profiles/ exists
if [[ -d "$NB_WORKSPACES_LIBRARY/.memory/.type-profiles" ]]; then
    echo "PASS: .memory/.type-profiles/ created"
else
    echo "FAIL: .memory/.type-profiles/ not created (required by highlight scope=complete Output C)"
    ((FAILED++)) || true
fi

# Test 3: .memory/.thinking/raw/ exists (already should exist)
if [[ -d "$NB_WORKSPACES_LIBRARY/.memory/.thinking/raw" ]]; then
    echo "PASS: .memory/.thinking/raw/ created"
else
    echo "FAIL: .memory/.thinking/raw/ not created"
    ((FAILED++)) || true
fi

# Test 4: .memory/.thinking/patterns/ exists (already should exist)
if [[ -d "$NB_WORKSPACES_LIBRARY/.memory/.thinking/patterns" ]]; then
    echo "PASS: .memory/.thinking/patterns/ created"
else
    echo "FAIL: .memory/.thinking/patterns/ not created"
    ((FAILED++)) || true
fi

# Test 5: .gitkeep files exist for empty directories
if [[ -f "$NB_WORKSPACES_LIBRARY/.memory/.experiences/.gitkeep" ]]; then
    echo "PASS: .memory/.experiences/.gitkeep created"
else
    echo "FAIL: .memory/.experiences/.gitkeep not created"
    ((FAILED++)) || true
fi

if [[ -f "$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/.gitkeep" ]]; then
    echo "PASS: .memory/.type-profiles/.gitkeep created"
else
    echo "FAIL: .memory/.type-profiles/.gitkeep not created"
    ((FAILED++)) || true
fi

# Summary
echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "PASS: All highlight directory tests passed"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
