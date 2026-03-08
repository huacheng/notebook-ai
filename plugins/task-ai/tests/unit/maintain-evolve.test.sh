#!/usr/bin/env bash
# Test: maintain.sh supports --evolve option
# Red/Green TDD - E1 test

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

MAINTAIN_SH="$PROJECT_ROOT/skills/library/scripts/maintain.sh"
EVOLVE_SH="$PROJECT_ROOT/skills/library/scripts/evolve-rules.sh"

echo "=== Test: maintain.sh --evolve option ==="

# Test 1: --evolve option exists in maintain.sh
echo -n "Test 1: --evolve option in case statement... "
if grep -qE '\-\-evolve\)' "$MAINTAIN_SH"; then
    echo "PASS"
else
    echo "FAIL: --evolve option not found in maintain.sh"
    exit 1
fi

# Test 2: evolve-rules.sh exists
echo -n "Test 2: evolve-rules.sh exists... "
if [[ -f "$EVOLVE_SH" ]]; then
    echo "PASS"
else
    echo "FAIL: evolve-rules.sh not found"
    exit 1
fi

# Test 3: evolve-rules.sh is executable or has bash shebang
echo -n "Test 3: evolve-rules.sh has proper shebang... "
if head -1 "$EVOLVE_SH" | grep -qE '^#!/usr/bin/env bash|^#!/bin/bash'; then
    echo "PASS"
else
    echo "FAIL: evolve-rules.sh missing proper shebang"
    exit 1
fi

# Test 4: evolve-rules.sh accepts --domain and --mode flags
echo -n "Test 4: evolve-rules.sh handles domain/mode args... "
if grep -qE '\-\-domain|\-\-mode' "$EVOLVE_SH"; then
    echo "PASS"
else
    echo "FAIL: evolve-rules.sh missing --domain/--mode handling"
    exit 1
fi

echo "=== All E1 tests passed ==="
