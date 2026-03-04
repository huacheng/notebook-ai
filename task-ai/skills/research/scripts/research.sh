#!/usr/bin/env bash
# /task-ai:research implementation
# Usage: research.sh <notebook> [--caller target|plan|test|verify|check|exec] [--phase objective|requirements] [--scope full|gap]

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"


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

# Handle audit caller mode - intelligence collection for rule evolution
# Does not require .target.md or task context
if [[ "$CALLER" == "audit" ]]; then
    LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
    INTEL_SOURCES="$LIB_PATH/.audit-intel-sources.yaml"
    EVOLVING_RULES_DIR="$LIB_PATH/.evolving-rules"
    YAML_PARSER="$SCRIPT_DIR/../../../core/yaml_parser.py"
    INTEL_FETCHER="$SCRIPT_DIR/intel-fetcher.sh"

    echo "[research:audit] Starting intelligence collection..."

    # Ensure candidates directories exist
    for domain in security sanitization audit; do
        mkdir -p "$EVOLVING_RULES_DIR/$domain/candidates"
    done

    # Check if intel sources config exists
    if [[ -f "$INTEL_SOURCES" ]]; then
        echo "[research:audit] Loading intel sources from $INTEL_SOURCES"

        # Parse sources using Python yaml_parser
        if [[ -f "$YAML_PARSER" ]]; then
            SOURCES_JSON=$(python3 "$YAML_PARSER" parse "$INTEL_SOURCES" 2>/dev/null || echo '{}')
            echo "[research:audit] Parsed intel sources config"
        fi

        # Call intel-fetcher if available
        if [[ -f "$INTEL_FETCHER" ]]; then
            echo "[research:audit] Invoking intel-fetcher..."
            bash "$INTEL_FETCHER" --sources "$INTEL_SOURCES" --output "$EVOLVING_RULES_DIR" 2>/dev/null || true
        else
            echo "[research:audit] intel-fetcher.sh not found, skipping external fetch"
        fi
    else
        echo "[research:audit] No intel sources config at $INTEL_SOURCES"
        echo "[research:audit] Copy template from skills/library/templates/audit-intel-sources.yaml"
    fi

    # Output .auto-signal for automation loop
    echo "[research:audit] Intelligence collection complete"
    echo 'result="(intel-collected)"' > "$WORK_DIR/.auto-signal" 2>/dev/null || true
    echo 'next="(stop)"' >> "$WORK_DIR/.auto-signal" 2>/dev/null || true

    exit 0
fi

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
