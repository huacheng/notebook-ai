#!/bin/bash
# Test C-ATOMIC-1: Library writes should use atomic .tmp → rename pattern
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FAILED=0

for script in read.sh research.sh; do
    script_path=$(find "$TASK_AI_ROOT/skills" -name "$script" -path "*/scripts/*" | head -1)
    if [[ -z "$script_path" ]]; then
        continue
    fi

    # Check if script writes to library (using cat > or echo > patterns)
    if grep -qE 'cat\s*>\s*"\$.*_FILE"|cat\s*>>\s*"\$.*_FILE"|>\s*"\$REF_FILE' "$script_path"; then
        # Should use .tmp pattern
        if ! grep -qE '\.tmp|TMP_FILE' "$script_path"; then
            echo "FAIL: $script writes to library but no .tmp pattern"
            ((FAILED++)) || true
        else
            echo "OK: $script uses atomic write"
        fi
    fi
done

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: All library writes use atomic pattern"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
