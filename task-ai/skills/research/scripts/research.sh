#!/usr/bin/env bash
# /moonview:research implementation
# Usage: research.sh <notebook> [--caller target|plan|test|verify|check|exec] [--phase objective|requirements] [--scope full|gap]

set -uo pipefail
# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../.dev/contracts/lib.sh"


NOTEBOOK="${1:-}"
# 1. Identify Context
if [[ -z "$NOTEBOOK" ]]; then
    if ! find_nb_context; then
        echo "[ERROR] No active task context detected. Enter a notebook directory or specify a name." >&2
        exit 1
    fi
    NOTEBOOK="$NB_NOTEBOOK"
    WORK_DIR="$NB_WORKING"
else
    # Explicit notebook name provided
    if [[ ! "$NOTEBOOK" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        echo "[ERROR] Invalid notebook name." >&2
        exit 1
    fi
    NB_ROOT="${NB_WORKSPACES_ROOT:-$(pwd)}"
    NB_DIR=$(find "$NB_ROOT" -name "$NOTEBOOK" -type d | head -n 1)
    if [[ -z "$NB_DIR" ]]; then
        echo "[ERROR] Notebook directory '$NOTEBOOK' not found under $NB_ROOT" >&2
        exit 1
    fi
    WORK_DIR="$NB_DIR/.working"
fi

if [[ ! "$NOTEBOOK" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "[ERROR] Invalid notebook name." >&2
    exit 1
fi

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --caller) CALLER="$2"; shift 2 ;;
    --phase)  PHASE="$2"; shift 2 ;;
    --scope)  SCOPE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

NB_ROOT="${NB_WORKSPACES_ROOT:-$(pwd)}"
# 更鲁棒的目录查找逻辑
NB_DIR=$(find "$NB_ROOT" -name "$NOTEBOOK" -type d | head -n 1)
if [[ -z "$NB_DIR" ]]; then
    echo "[ERROR] Notebook directory '$NOTEBOOK' not found under $NB_ROOT" >&2
    exit 1
fi
WORK_DIR="$NB_DIR/.working"
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
