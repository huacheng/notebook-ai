#!/bin/bash
# Test C-MERGE-1/2: merge.sh should execute actual merge and not hardcode branch
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MERGE_SH="$TASK_AI_ROOT/skills/merge/scripts/merge.sh"

FAILED=0

# Should contain actual git merge command
if ! grep -q 'git merge' "$MERGE_SH"; then
    echo "FAIL: merge.sh does not contain 'git merge' command"
    ((FAILED++)) || true
fi

# Should NOT hardcode 'master' as branch name (exclude fallback detection logic)
# Allowed: refs/heads/master (branch existence check), MAIN_BRANCH="master" (fallback assignment), comments
HARDCODED_MASTER=$(grep -E 'into master|checkout master|git merge.*master' "$MERGE_SH" | grep -vE 'refs/heads/master|MAIN_BRANCH="master"|^\s*#' || true)
if [[ -n "$HARDCODED_MASTER" ]]; then
    echo "FAIL: merge.sh hardcodes 'master' branch"
    echo "  Found: $HARDCODED_MASTER"
    ((FAILED++)) || true
fi

# Should use dynamic main branch detection
if ! grep -qE 'symbolic-ref|MAIN_BRANCH' "$MERGE_SH"; then
    echo "FAIL: merge.sh does not dynamically detect main branch"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: merge.sh implements actual merge with dynamic branch"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
