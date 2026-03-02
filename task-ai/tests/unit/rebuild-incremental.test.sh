#!/bin/bash
# Test C-PERF-2: rebuild-index.py should have incremental mechanism
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REBUILD_PY="$TASK_AI_ROOT/skills/library/scripts/rebuild-index.py"

FAILED=0

# Should have mtime/incremental check
if ! grep -qE 'mtime|st_mtime|needs_rebuild|incremental|--force' "$REBUILD_PY"; then
    echo "FAIL: rebuild-index.py has no incremental mechanism"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: rebuild-index.py supports incremental builds"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
