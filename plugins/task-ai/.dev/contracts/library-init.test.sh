#!/usr/bin/env bash
# Test: library initialization integration
# Verifies A+C pattern: init triggers library setup, write commands also check

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Test helpers
pass() { echo "✓ $1"; }
fail() { echo "✗ $1" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# Test A: init.sh calls init-lib.sh
# ─────────────────────────────────────────────────────────────────────────────
test_init_calls_init_lib() {
    # Verify init.sh contains call to init-lib.sh
    if grep -qE 'init-lib\.sh|ensure_library' "$TASK_AI_ROOT/skills/init/scripts/init.sh"; then
        pass "init.sh calls library initialization"
    else
        fail "init.sh missing library initialization call"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test C1: promote.sh (highlight's library writer) has library init check
# ─────────────────────────────────────────────────────────────────────────────
test_promote_has_lib_check() {
    if grep -qE 'init-lib\.sh|ensure_library' "$TASK_AI_ROOT/skills/highlight/scripts/promote.sh"; then
        pass "promote.sh has library init check"
    else
        fail "promote.sh missing library init check"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test C2: research.sh has library init check
# ─────────────────────────────────────────────────────────────────────────────
test_research_has_lib_check() {
    if grep -qE 'init-lib\.sh|ensure_library' "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "research.sh has library init check"
    else
        fail "research.sh missing library init check"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test: lib.sh exports ensure_library function
# ─────────────────────────────────────────────────────────────────────────────
test_lib_exports_ensure_library() {
    if grep -qE '^ensure_library\(\)' "$TASK_AI_ROOT/core/lib.sh"; then
        pass "lib.sh exports ensure_library()"
    else
        fail "lib.sh missing ensure_library() function"
    fi
}

# Run tests
echo "=== Library Init Integration Tests ==="
test_lib_exports_ensure_library
test_init_calls_init_lib
test_promote_has_lib_check
test_research_has_lib_check
echo ""
echo "All tests passed."
