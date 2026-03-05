#!/usr/bin/env bash
# /task-ai:research implementation
# Usage: research.sh [notebook] [--caller target|plan|test|verify|check|exec|library] [--phase objective|requirements] [--scope gap|deep]
# - notebook: optional, auto-detected from .working/ or task/* branch
# - --scope: gap (default, incremental) or deep (force refresh)

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

# Library paths
LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
MAINTAIN_SCRIPT="$TASK_AI_ROOT/skills/library/scripts/maintain.sh"
LIBRARY_SEARCH_SCRIPT="$TASK_AI_ROOT/skills/library/scripts/search.sh"

# Helper: call library search before researching
library_search() {
    local topic="$1"
    if [[ -f "$LIBRARY_SEARCH_SCRIPT" ]]; then
        bash "$LIBRARY_SEARCH_SCRIPT" "$topic" 2>/dev/null || true
    fi
}

# Helper: call maintain --mode quick after writing to library
post_write_maintain() {
    if [[ -f "$MAINTAIN_SCRIPT" ]]; then
        echo "[research] Triggering quick maintenance..."
        bash "$MAINTAIN_SCRIPT" --mode quick 2>/dev/null || true
    fi
}


# Parse arguments
NOTEBOOK=""
TOPIC=""
CALLER=""
PHASE=""
SCOPE="gap"  # Default to incremental mode

while [[ $# -gt 0 ]]; do
  case "$1" in
    --caller) CALLER="$2"; shift 2 ;;
    --phase)  PHASE="$2"; shift 2 ;;
    --scope)  SCOPE="$2"; shift 2 ;;
    --*)      echo "Unknown option: $1" >&2; exit 1 ;;
    *)
      # Positional argument: could be notebook name or topic
      if [[ -z "$NOTEBOOK" ]]; then
          # Check if it looks like a notebook name (no spaces, short)
          if [[ "$1" =~ ^[a-zA-Z0-9_-]+$ ]] && [[ ${#1} -lt 50 ]]; then
              NOTEBOOK="$1"
          else
              # Treat as topic (natural language)
              TOPIC="$1"
          fi
      else
          # Already have notebook, this is the topic
          TOPIC="$1"
      fi
      shift
      ;;
  esac
done

# Try to resolve notebook context (may fail if standalone topic research)
WORK_DIR=""
if [[ -n "$NOTEBOOK" ]] || [[ -z "$TOPIC" ]]; then
    resolve_workdir "${NOTEBOOK:-}" 2>/dev/null && {
        NOTEBOOK="$NB_NOTEBOOK"
        WORK_DIR="$NB_WORKDIR"
    } || true
fi

TARGET_MD="${WORK_DIR:+$WORK_DIR/.target.md}"

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

# ─────────────────────────────────────────────────────────────────────────────
# Standalone topic research (no notebook context)
# ─────────────────────────────────────────────────────────────────────────────
if [[ -n "$TOPIC" ]] && [[ -z "$WORK_DIR" ]]; then
    echo "[research] Standalone topic: $TOPIC"

    # Step 1: Search library first
    echo "[research] Checking library for existing knowledge..."
    SEARCH_RESULT=$(library_search "$TOPIC")

    if [[ -n "$SEARCH_RESULT" ]] && [[ "$SCOPE" != "deep" ]]; then
        echo "[research] Found in library:"
        echo "$SEARCH_RESULT"
        echo ""
        echo "[research] Use --scope deep to force refresh"
    else
        if [[ "$SCOPE" == "deep" ]]; then
            echo "[research] Deep mode: refreshing content..."
        else
            echo "[research] Not found in library, researching..."
        fi

        # Step 2: Research and write to library
        REFS_DIR="$LIB_PATH/.memory/.references"
        mkdir -p "$REFS_DIR"

        # Generate filename from topic (sanitize + validate)
        FILENAME=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | head -c 50)
        # D2/D3: Guard against empty filename
        if [[ -z "$FILENAME" ]] || [[ "$FILENAME" == "-" ]]; then
            FILENAME="research-$(date +%s)"
        fi
        FILEPATH="$REFS_DIR/${FILENAME}.md"
        DATE=$(date +%Y-%m-%d)
        TS=$(date +%s%3N)

        # Archive existing if deep mode
        if [[ "$SCOPE" == "deep" ]] && [[ -f "$FILEPATH" ]]; then
            ARCHIVE_DIR="$REFS_DIR/.archive"
            mkdir -p "$ARCHIVE_DIR"
            mv "$FILEPATH" "$ARCHIVE_DIR/${FILENAME}.${DATE}.md"
            echo "[research] Archived previous version"
        fi

        # Write placeholder (actual research content would be generated by agent)
        cat > "$FILEPATH" << EOF
# ${TOPIC}

> Researched: ${DATE}
> Scope: ${SCOPE}

## Overview

<!-- Research findings for: ${TOPIC} -->

## Key Points

- TODO: Agent fills in research findings

## Sources

- TODO: Add sources

EOF
        echo "[research] Created reference: $FILEPATH"

        # Step 3: Append to changelog (with lock for concurrency)
        CHANGELOG="$LIB_PATH/.changelog"
        CHANGELOG_LOCK="$LIB_PATH/.changelog.lock"
        (
            flock -w 5 200 || { echo "[WARN] changelog lock timeout, proceeding anyway"; }
            echo "- [reference] ${FILENAME}.md | added | ts=${TS}" >> "$CHANGELOG"
        ) 200>"$CHANGELOG_LOCK"

        # Step 4: Trigger quick maintenance
        post_write_maintain
    fi

    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Notebook-context research (target/plan/test/verify/check/exec)
# ─────────────────────────────────────────────────────────────────────────────
if [[ -z "$WORK_DIR" ]] || [[ ! -f "$TARGET_MD" ]]; then
    echo "[ERROR] No notebook context and no topic provided" >&2
    echo "Usage: research.sh [notebook] [--caller ...] OR research.sh \"topic to research\"" >&2
    exit 1
fi

DETECT_STAGE_PY="$SCRIPT_DIR/detect_stage.py"

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

    # Write insights to .target.md
    DATE=$(date +%Y-%m-%d)
    if ! grep -q "## Research Insights" "$TARGET_MD"; then
        echo -e "\n## Research Insights" >> "$TARGET_MD"
    fi
    echo -e "\n### $STAGE: Insights · $DATE\n\n#### [PROPOSED] Refinement\n- Data for $STAGE..." >> "$TARGET_MD"
    echo "Updated .target.md with $STAGE insights."

    # Trigger quick maintenance (research may have written to library)
    post_write_maintain
else
    echo "Executing research for caller: ${CALLER:-auto}, scope: $SCOPE"

    # Default flow: search library first, then research gaps
    if [[ -f "$TARGET_MD" ]]; then
        # Extract keywords from target for library search
        KEYWORDS=$(grep -E "^##|^-" "$TARGET_MD" | head -5 | tr '\n' ' ')
        if [[ -n "$KEYWORDS" ]]; then
            echo "[research] Searching library for: $KEYWORDS"
            library_search "$KEYWORDS"
        fi
    fi

    # After research writes to library
    post_write_maintain
fi
