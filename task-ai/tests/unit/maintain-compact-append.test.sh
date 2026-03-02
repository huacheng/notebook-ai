#!/bin/bash
# Test H-MAINTAIN-1: --compact should append to existing archive, not overwrite
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAINTAIN_SH="$TASK_AI_ROOT/skills/library/scripts/maintain.sh"

FAILED=0

# Should check if archive file exists before writing
if ! grep -E '\-f.*ARCHIVE\|\|.*cat.*>>|append' "$MAINTAIN_SH" >/dev/null 2>&1; then
    # Alternative: should not just mv, should handle existing file
    if grep -q 'mv "$CHANGELOG" "$ARCHIVE_DIR/$DATE_STR.md"' "$MAINTAIN_SH" && \
       ! grep -q 'if.*-f.*ARCHIVE' "$MAINTAIN_SH"; then
        echo "FAIL: --compact overwrites existing archive without checking"
        ((FAILED++)) || true
    fi
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: --compact handles existing archives"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
