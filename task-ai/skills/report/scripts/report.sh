#!/usr/bin/env bash
# /task-ai:report implementation
# Usage: report.sh <notebook> [--format full|summary]

set -euo pipefail
# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"


NOTEBOOK="${1:-}"
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

FORMAT=""
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --format) FORMAT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

NB_ROOT="${NB_WORKSPACES_ROOT:-$(pwd)}"
LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_ROOT}/.library}"

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found for $NOTEBOOK." >&2
    exit 1
fi

echo "Generating report for $NOTEBOOK..."
STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"
INDEX_JSON="$WORK_DIR/.index.json"

# 1. Gather Metadata
TITLE=$(python3 "$STATE_PY" get "$INDEX_JSON" title)
STATUS=$(python3 "$STATE_PY" get "$INDEX_JSON" status)
CREATED=$(python3 "$STATE_PY" get "$INDEX_JSON" created)
COMPLETED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TYPE=$(python3 "$STATE_PY" get "$INDEX_JSON" type)
TYPE=${TYPE:-generic}

# 2. Compose Report (Simplified for script)
REPORT_FILE="$WORK_DIR/.report.md"
cat > "$REPORT_FILE" <<EOF
# Task Report: $TITLE

## Summary
- **Status**: $STATUS
- **Created**: $CREATED
- **Completed**: $COMPLETED
- **Type**: $TYPE

## Objective
$(cat "$WORK_DIR/.target.md" | sed -n '/## Objective/,/##/p' | grep -v '##')

## Plan
$( [[ -f "$WORK_DIR/.plan.md" ]] && cat "$WORK_DIR/.plan.md" | head -n 20 || echo "N/A" )

## Lessons Learned
$( [[ -d "$WORK_DIR/.notes" ]] && cat "$WORK_DIR/.notes"/*.md 2>/dev/null | grep -v '^#' | head -n 20 || echo "N/A" )
EOF

echo "Report written to $REPORT_FILE."

# Note: Experience distillation moved to /task-ai:highlight skill
# This script only generates reports; use highlight for library writes

# 3. Final Maintain Hook
MAINTAIN_SH="$(dirname "$0")/../../../skills/library/scripts/maintain.sh"
if [[ -x "$MAINTAIN_SH" ]]; then
    "$MAINTAIN_SH" --rebuild-index --rebuild-relations
fi

echo "Report completed."
