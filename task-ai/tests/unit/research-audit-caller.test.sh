#!/usr/bin/env bash
# Test: research.sh supports --caller audit mode
# Red/Green TDD - E2 test

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RESEARCH_SH="$PROJECT_ROOT/skills/research/scripts/research.sh"

echo "=== Test: research.sh --caller audit ==="

# Test 1: --caller audit handling exists
echo -n "Test 1: audit caller handling in research.sh... "
if grep -qE 'CALLER.*==.*"audit"|"audit".*CALLER' "$RESEARCH_SH"; then
    echo "PASS"
else
    echo "FAIL: audit caller handling not found in research.sh"
    exit 1
fi

# Test 2: References intel sources config
echo -n "Test 2: References intel sources config... "
if grep -qE 'INTEL_SOURCES|intel.sources|audit-intel-sources' "$RESEARCH_SH"; then
    echo "PASS"
else
    echo "FAIL: No reference to intel sources configuration"
    exit 1
fi

# Test 3: Generates .auto-signal for audit mode
echo -n "Test 3: Generates .auto-signal output... "
if grep -qE '\.auto-signal|intel-collected' "$RESEARCH_SH"; then
    echo "PASS"
else
    echo "FAIL: No .auto-signal generation for audit mode"
    exit 1
fi

echo "=== All E2 tests passed ==="
