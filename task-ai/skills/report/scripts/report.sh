#!/usr/bin/env bash
# /moonview:report implementation
# Usage: report.sh <notebook> [--format full|summary]

set -uo pipefail
# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../.dev/contracts/lib.sh"


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
REPORT_FILE="$WORK_DIR/../.report.md"
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

# 3. Distill Experience to Library (Step 13)
if [[ -d "$LIB_PATH" && -n "$TYPE" ]]; then
    echo "Distilling experience to library..."
    # Standardize type for directory name
    DIR_SAFE_TYPE=$(echo "$TYPE" | sed 's/:/-/g' | cut -d'|' -f1) # Handle primary segment
    EXP_DIR="$LIB_PATH/.memory/.experiences/$DIR_SAFE_TYPE"
    mkdir -p "$EXP_DIR"
    
    EXP_FILE="$EXP_DIR/$NOTEBOOK-complete.md"
    cat > "$EXP_FILE" <<EOF
---
notebook: $NOTEBOOK
type: $TYPE
quality_status: verified
completeness: complete
date: $COMPLETED
---
# Experience: $TITLE

## Key Learnings
$( [[ -d "$WORK_DIR/.notes" ]] && cat "$WORK_DIR/.notes"/*.md 2>/dev/null | head -n 50 || echo "N/A" )

## Decisions
- Automated library distillation implemented.
- TDD retroactively applied to core skills.
EOF

    # Git Commit to Library (Library Repo Protocol)
    cd "$LIB_PATH"
    git add "$EXP_FILE"
    git commit -m "task-ai($NOTEBOOK):report distill experience"
    cd - > /dev/null
    echo "Experience distilled to library."
fi

# 4. Final Maintain Hook
MAINTAIN_SH="$(dirname "$0")/../../../skills/library/scripts/maintain.sh"
if [[ -x "$MAINTAIN_SH" ]]; then
    "$MAINTAIN_SH" --rebuild-index --rebuild-relations
fi

echo "Report completed."
