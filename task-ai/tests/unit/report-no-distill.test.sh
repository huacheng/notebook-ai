#!/bin/bash
# Test C-REPORT-1: report.sh should not contain library distillation logic
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_SH="$TASK_AI_ROOT/skills/report/scripts/report.sh"

FAILED=0

# Should NOT contain distill experience code (moved to highlight)
if grep -q 'Distilling experience' "$REPORT_SH"; then
    echo "FAIL: report.sh still contains library distillation"
    ((FAILED++)) || true
fi

# Should NOT contain git commit for distill
if grep -qE 'git commit.*distill|distill experience' "$REPORT_SH"; then
    echo "FAIL: report.sh still has distill git commit"
    ((FAILED++)) || true
fi

# Should NOT create experience files
if grep -q '\.experiences/' "$REPORT_SH"; then
    echo "FAIL: report.sh still creates experience files"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: report.sh has no distillation logic"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
