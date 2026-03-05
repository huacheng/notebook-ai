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
    --format) FORMAT="${2:-}"; shift 2 2>/dev/null || shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found for $NOTEBOOK." >&2
    exit 1
fi

echo "Generating report for $NOTEBOOK..."
STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"
STATUS_JSON="$WORK_DIR/.status.json"

# D3: Check state.py existence before calling
if [[ ! -f "$STATE_PY" ]]; then
    echo "[ERROR] state.py not found: $STATE_PY" >&2
    exit 1
fi

# 1. Gather Metadata
# D3: python3 calls with error handling
TITLE=$(python3 "$STATE_PY" get "$STATUS_JSON" title 2>/dev/null || echo "$NOTEBOOK")
STATUS=$(python3 "$STATE_PY" get "$STATUS_JSON" status 2>/dev/null || echo "unknown")
CREATED=$(python3 "$STATE_PY" get "$STATUS_JSON" created 2>/dev/null || echo "unknown")
COMPLETED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TYPE=$(python3 "$STATE_PY" get "$STATUS_JSON" type 2>/dev/null || echo "")
TYPE=${TYPE:-generic}

# D2: Validate FORMAT parameter
if [[ -n "$FORMAT" && "$FORMAT" != "full" && "$FORMAT" != "summary" ]]; then
    echo "[WARN] Unknown format '$FORMAT', defaulting to 'full'" >&2
    FORMAT="full"
fi
FORMAT=${FORMAT:-full}

# 2. Compose Report (D1: FORMAT-aware generation)
REPORT_FILE="$WORK_DIR/.report.md"

# Generate report content based on FORMAT
if [[ "$FORMAT" == "summary" ]]; then
    # Summary format: minimal output
    REPORT_CONTENT="# Task Report: $TITLE

## Summary
- **Status**: $STATUS
- **Created**: $CREATED
- **Completed**: $COMPLETED
- **Type**: $TYPE
"
else
    # Full format: include all sections
    REPORT_CONTENT="# Task Report: $TITLE

## Summary
- **Status**: $STATUS
- **Created**: $CREATED
- **Completed**: $COMPLETED
- **Type**: $TYPE

## Objective
$(cat "$WORK_DIR/.target.md" 2>/dev/null | sed -n '/## Objective/,/##/p' | grep -v '##' || echo "N/A")

## Plan
$( [[ -f "$WORK_DIR/.plan.md" ]] && cat "$WORK_DIR/.plan.md" | head -n 20 || echo "N/A" )

## Lessons Learned
$( [[ -d "$WORK_DIR/.notes" ]] && cat "$WORK_DIR/.notes"/*.md 2>/dev/null | grep -v '^#' | head -n 20 || echo "N/A" )
"
fi

# D3: Report write with error handling
if ! printf '%s' "$REPORT_CONTENT" > "$REPORT_FILE" 2>&1; then
    echo "[WARN] Failed to write report to $REPORT_FILE" >&2
fi

echo "Report written to $REPORT_FILE."

# Note: Experience distillation moved to /task-ai:highlight skill
# This script only generates reports; use highlight for library writes

# 3. Git commit (D1: consistent with SKILL.md)
if ! git add "$REPORT_FILE" 2>&1; then
    echo "[WARN] Failed to stage report file" >&2
elif ! git commit -m "task-ai($NOTEBOOK):report generate completion report" 2>&1; then
    echo "[WARN] Failed to commit report (may be no changes)" >&2
fi

# 4. Final Maintain Hook
MAINTAIN_SH="$(dirname "$0")/../../../skills/library/scripts/maintain.sh"
# D3: maintain.sh call with error handling
if [[ -x "$MAINTAIN_SH" ]]; then
    if ! "$MAINTAIN_SH" --rebuild-index --rebuild-relations 2>&1; then
        echo "[WARN] maintain.sh failed" >&2
    fi
fi

# 5. Write .auto-signal (D1: consistent with SKILL.md)
if ! cat > "$WORK_DIR/.auto-signal" <<'EOF'
{"step":"report","result":"(generated)","next":"(stop)","checkpoint":"","timestamp":""}
EOF
then
    echo "[WARN] Failed to write .auto-signal" >&2
fi

echo "Report completed."
