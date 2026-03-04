#!/bin/bash
# Test C-SHELL-1: All scripts must have set -e
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SCRIPTS=$(find "$TASK_AI_ROOT" -name "*.sh" -type f \
    ! -path "*/.dev/*" \
    ! -path "*/tests/*" \
    ! -name "lib.sh" \
    ! -name "shell-aliases.sh")
MISSING=0

for script in $SCRIPTS; do
    if ! head -10 "$script" | grep -qE 'set\s+-[a-z]*e'; then
        echo "FAIL: $script missing 'set -e'"
        ((MISSING++)) || true
    fi
done

if [[ $MISSING -eq 0 ]]; then
    echo "PASS: All scripts have set -e"
    exit 0
else
    echo "TOTAL FAILURES: $MISSING"
    exit 1
fi
