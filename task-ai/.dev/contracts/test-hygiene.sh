#!/usr/bin/env bash
# L1: Verify functional tests have proper cleanup (trap handlers)
source "$(dirname "$0")/lib.sh"

# All test scripts that create temp directories should have trap cleanup
# Includes both *-functional.sh and L2 library tests
FUNCTIONAL_TESTS=$(find "$DEV_ROOT/contracts" \( -name "*-functional.sh" -o -name "library-*.sh" \) -type f | sort)

for test_script in $FUNCTIONAL_TESTS; do
  rel=$(basename "$test_script")

  # Check if script creates temp directories (uses NB_WORKSPACES_ROOT or /tmp/)
  if grep -qE 'NB_WORKSPACES_ROOT=|mkdir.*tmp' "$test_script"; then
    # Should have a trap handler for cleanup
    if grep -q 'trap ' "$test_script"; then
      emit_pass "$rel: has trap cleanup handler"
    else
      emit_fail "$rel: creates temp dirs but missing trap cleanup — orphaned files on failure"
    fi
  else
    emit_pass "$rel: no temp dirs (no trap needed)"
  fi
done

summary
