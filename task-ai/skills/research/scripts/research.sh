#!/usr/bin/env bash
# /task-ai:research implementation
# Usage: research.sh <notebook> [--caller target|plan|test|verify|check|exec] [--phase objective|requirements] [--scope full|gap]

set -uo pipefail
# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../.dev/contracts/lib.sh"


NOTEBOOK="${1:-}"
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

CALLER=""
PHASE=""
SCOPE=""
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --caller) CALLER="$2"; shift 2 ;;
    --phase)  PHASE="$2"; shift 2 ;;
    --scope)  SCOPE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
TARGET_MD="$WORK_DIR/.target.md"

if [[ ! -f "$TARGET_MD" ]]; then
    echo "[ERROR] .target.md not found at $TARGET_MD" >&2
    exit 1
fi

DETECT_STAGE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/detect_stage.py"

detect_stage() {
    python3 "$DETECT_STAGE_PY" "$TARGET_MD"
}

if [[ "$CALLER" == "target" && "$PHASE" == "objective" ]]; then
    STAGE=$(detect_stage)
    echo "Detected stage: $STAGE"
    
    if [[ "$STAGE" == "PENDING" ]]; then
        echo "[ABORT] Pending [PROPOSED] items found. Please review and remove markers before advancing."
        exit 0
    elif [[ "$STAGE" == "COMPLETE" ]]; then
        echo "All objective stages complete. Run with --phase requirements to continue."
        exit 0
    fi
    
    # 模拟写入
    DATE=$(date +%Y-%m-%d)
    if ! grep -q "## Research Insights" "$TARGET_MD"; then
        echo -e "\n## Research Insights" >> "$TARGET_MD"
    fi
    echo -e "\n### $STAGE: Insights · $DATE\n\n#### [PROPOSED] Refinement\n- Data for $STAGE..." >> "$TARGET_MD"
    echo "Updated .target.md with $STAGE insights."
else
    echo "Executing research for caller: $CALLER, scope: $SCOPE"
fi
