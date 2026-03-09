#!/usr/bin/env bash
# /task-ai:research implementation
# Usage: research.sh [notebook|"topic"] [--caller target|plan|test|verify|check|exec|library|audit] [--phase objective|requirements] [--scope gap|deep]
# - notebook: optional, auto-detected from .working/ or task/* branch
# - topic: natural language string (standalone research without notebook context)
# - --scope: gap (default, incremental) or deep (force refresh)

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

# Ensure library exists before any library operations (C pattern)
ensure_library

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

# D2: Allowed values for validated arguments
VALID_CALLERS="target plan test verify check exec library audit"
VALID_PHASES="objective requirements"
VALID_SCOPES="gap deep"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --caller) [[ $# -ge 2 ]] || { echo "[ERROR] --caller requires a value" >&2; exit 1; }; CALLER="$2"; shift 2 ;;
    --phase)  [[ $# -ge 2 ]] || { echo "[ERROR] --phase requires a value" >&2; exit 1; }; PHASE="$2"; shift 2 ;;
    --scope)  [[ $# -ge 2 ]] || { echo "[ERROR] --scope requires a value" >&2; exit 1; }; SCOPE="$2"; shift 2 ;;
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

# D2: Validate argument values via exact match (case statement prevents regex injection)
if [[ -n "$CALLER" ]]; then
    case "$CALLER" in
        target|plan|test|verify|check|exec|library|audit) ;;
        *) echo "[ERROR] Invalid --caller value: $CALLER" >&2; echo "Allowed: $VALID_CALLERS" >&2; exit 1 ;;
    esac
fi
if [[ -n "$PHASE" ]]; then
    case "$PHASE" in
        objective|requirements) ;;
        *) echo "[ERROR] Invalid --phase value: $PHASE" >&2; echo "Allowed: $VALID_PHASES" >&2; exit 1 ;;
    esac
fi
case "$SCOPE" in
    gap|deep) ;;
    *) echo "[ERROR] Invalid --scope value: $SCOPE" >&2; echo "Allowed: $VALID_SCOPES" >&2; exit 1 ;;
esac

# Try to resolve notebook context (may fail if standalone topic research)
WORK_DIR=""
if [[ -n "$NOTEBOOK" ]] || [[ -z "$TOPIC" ]]; then
    resolve_workdir "${NOTEBOOK:-}" 2>/dev/null && {
        NOTEBOOK="$NB_NOTEBOOK"
        # resolve_workdir sets WORK_DIR via export
    } || true
fi

TARGET_MD="${WORK_DIR:+$WORK_DIR/.target.md}"

# Default --phase to "objective" when --caller target (per SKILL.md)
if [[ "$CALLER" == "target" && -z "$PHASE" ]]; then
    PHASE="objective"
fi

# Handle audit caller mode - intelligence collection for rule evolution
# Does not require .target.md or task context
if [[ "$CALLER" == "audit" ]]; then
    # D5: LIB_PATH already defined at top of file (L18)
    INTEL_SOURCES="$LIB_PATH/.audit-intel-sources.yaml"
    EVOLVING_RULES_DIR="$LIB_PATH/.evolving-rules"
    TEST_CORPUS_DIR="$LIB_PATH/.test-corpus"
    # D6: YAML_PARSER removed - intel-fetcher.sh handles YAML parsing internally
    INTEL_FETCHER="$SCRIPT_DIR/intel-fetcher.sh"

    echo "[research:audit] Starting intelligence collection..."

    # R5: Define constants for magic strings (D6 maintainability)
    QUALITY_STATUS_VERIFIED="quality_status: verified"
    MAX_EXPERIENCE_SIZE=102400  # 100KB max for experience files (D2 security)

    # R4: Directory creation delegated to intel-fetcher.sh (D5 architecture)
    # intel-fetcher creates: candidates/, positive/, negative/ for all domains

    # Check if intel sources config exists
    if [[ -f "$INTEL_SOURCES" ]]; then
        echo "[research:audit] Loading intel sources from $INTEL_SOURCES"

        # D1: intel-fetcher.sh reads INTEL_SOURCES directly
        # No need to pre-parse here (removed unused SOURCES_JSON)

        # Call intel-fetcher if available
        # intel-fetcher generates both candidate rules AND test samples
        if [[ -f "$INTEL_FETCHER" ]]; then
            echo "[research:audit] Invoking intel-fetcher..."
            # R2: Capture exit status and log errors instead of silent ignore
            INTEL_FETCH_STATUS=0
            bash "$INTEL_FETCHER" --sources "$INTEL_SOURCES" \
                --output "$EVOLVING_RULES_DIR" \
                --test-corpus "$TEST_CORPUS_DIR" 2>&1 || INTEL_FETCH_STATUS=$?
            if [[ "$INTEL_FETCH_STATUS" -ne 0 ]]; then
                echo "[research:audit] WARNING: intel-fetcher failed with status $INTEL_FETCH_STATUS"
            fi
        else
            echo "[research:audit] intel-fetcher.sh not found, skipping external fetch"
        fi
    else
        echo "[research:audit] No intel sources config at $INTEL_SOURCES"
        echo "[research:audit] Copy template from skills/library/templates/audit-intel-sources.yaml"
    fi

    # Also extract negative samples from successful historical tasks
    # These are known-good code patterns that should NOT trigger security rules
    EXPERIENCES_DIR="$LIB_PATH/.memory/.experiences"
    if [[ -d "$EXPERIENCES_DIR" ]]; then
        echo "[research:audit] Extracting negative samples from verified experiences..."
        NEGATIVE_COUNT=0
        SKIPPED_COUNT=0
        # Ensure target directory exists before copying
        mkdir -p "$TEST_CORPUS_DIR/security/negative"
        while IFS= read -r -d '' exp_file; do
            # R5: Use named constant instead of magic string
            if grep -q "$QUALITY_STATUS_VERIFIED" "$exp_file" 2>/dev/null; then
                # R3: Validate content before copy (D2 security)
                # Check 1: File size limit
                # D3: Linux stat first (primary platform), macOS fallback second
                FILE_SIZE=$(stat -c%s "$exp_file" 2>/dev/null || stat -f%z "$exp_file" 2>/dev/null || echo "")
                # D3: If stat failed for both platforms, skip the file
                if [[ -z "$FILE_SIZE" ]]; then
                    echo "[research:audit] Skip: $exp_file — cannot determine file size"
                    ((SKIPPED_COUNT++)) || true
                    continue
                fi
                if [[ "$FILE_SIZE" -gt "$MAX_EXPERIENCE_SIZE" ]]; then
                    echo "[research:audit] Skip: $exp_file exceeds size limit"
                    ((SKIPPED_COUNT++)) || true
                    continue
                fi
                # Check 2: No dangerous patterns (basic sanitization)
                # D2: Check full file for dangerous patterns (security over performance)
                if grep -qE '\$\(|`[^`]+`|curl.*\|.*bash' "$exp_file" 2>/dev/null; then
                    echo "[research:audit] Skip: $exp_file contains dangerous patterns"
                    ((SKIPPED_COUNT++)) || true
                    continue
                fi

                SLUG=$(basename "$exp_file" .md | tr -cd 'a-zA-Z0-9_-')
                # D2: Guard against empty SLUG (special character filenames)
                if [[ -z "$SLUG" ]]; then
                    SLUG="exp-$(date +%s)-$RANDOM"
                fi
                # Copy to security/negative as these are known-safe patterns
                if [[ ! -f "$TEST_CORPUS_DIR/security/negative/$SLUG.md" ]]; then
                    # D3: cp with error handling
                    if cp "$exp_file" "$TEST_CORPUS_DIR/security/negative/$SLUG.md" 2>/dev/null; then
                        ((NEGATIVE_COUNT++)) || true
                    else
                        echo "[research:audit] WARN: Failed to copy $exp_file" >&2
                    fi
                fi
            fi
        # D4: Limit find depth for experience files
        done < <(find "$EXPERIENCES_DIR" -maxdepth 3 -name "*-complete.md" -type f -print0 2>/dev/null)
        echo "[research:audit] Extracted $NEGATIVE_COUNT negative samples (skipped $SKIPPED_COUNT)"
    fi

    echo "[research:audit] Intelligence collection complete"
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
        # D2/D3: Strip ALL leading dashes to prevent option confusion (e.g., "--help" → "help")
        while [[ "$FILENAME" == -* ]]; do FILENAME="${FILENAME#-}"; done
        if [[ -z "$FILENAME" ]]; then
            FILENAME="research-$(date +%s)"
        fi
        FILEPATH="$REFS_DIR/${FILENAME}.md"
        DATE=$(date +%Y-%m-%d)
        # D3: %3N is GNU-only; provide portable fallback
        TS=$(date +%s%3N 2>/dev/null || date +%s000)

        # Archive existing if deep mode
        if [[ "$SCOPE" == "deep" ]] && [[ -f "$FILEPATH" ]]; then
            ARCHIVE_DIR="$REFS_DIR/.archive"
            mkdir -p "$ARCHIVE_DIR"
            # D3: mv with error handling - abort if archive fails to prevent data loss
            if mv "$FILEPATH" "$ARCHIVE_DIR/${FILENAME}.${DATE}.md" 2>/dev/null; then
                echo "[research] Archived previous version"
            else
                echo "[ERROR] Failed to archive $FILEPATH - aborting to prevent data loss" >&2
                exit 1
            fi
        fi

        # Write placeholder (actual research content would be generated by agent)
        # D2: Use quoted 'EOF' to prevent variable expansion issues in TOPIC
        cat > "$FILEPATH" << 'RESEARCH_END'
# TOPIC_PLACEHOLDER

> Researched: DATE_PLACEHOLDER
> Scope: SCOPE_PLACEHOLDER

## Overview

<!-- Research findings -->

## Key Points

- TODO: Agent fills in research findings

## Sources

- TODO: Add sources

RESEARCH_END
        # Replace placeholders with actual values (safe substitution)
        # D2: Escape sed special chars in TOPIC: newlines, \ (escape), & (match ref), / (delimiter)
        TOPIC_ESCAPED="${TOPIC//$'\n'/ }"  # Strip newlines first
        TOPIC_ESCAPED="${TOPIC_ESCAPED//\\/\\\\}"  # Escape backslashes
        TOPIC_ESCAPED="${TOPIC_ESCAPED//&/\\&}"  # Then ampersands
        TOPIC_ESCAPED="${TOPIC_ESCAPED//\//\\/}"  # Then forward slashes
        sed -i "s/TOPIC_PLACEHOLDER/${TOPIC_ESCAPED}/g; s/DATE_PLACEHOLDER/$DATE/g; s/SCOPE_PLACEHOLDER/$SCOPE/g" "$FILEPATH"
        echo "[research] Created reference: $FILEPATH"

        # Step 3: Append to changelog (with lock for concurrency)
        CHANGELOG="$LIB_PATH/.changelog"
        CHANGELOG_LOCK="$LIB_PATH/.changelog.lock"
        (
            flock -w 5 200 || { echo "[WARN] changelog lock timeout, proceeding anyway" >&2; }
            echo "- [reference] ${FILENAME}.md | added | ts=${TS}" >> "$CHANGELOG"
        ) 200>"$CHANGELOG_LOCK"

        # Step 4: Trigger quick maintenance
        post_write_maintain
    fi

    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Notebook-context research (requires WORK_DIR and .target.md)
# ─────────────────────────────────────────────────────────────────────────────
if [[ -z "$WORK_DIR" ]] || [[ ! -f "$TARGET_MD" ]]; then
    echo "[ERROR] No notebook context and no topic provided" >&2
    echo "Usage: research.sh [notebook] [--caller ...] OR research.sh \"topic to research\"" >&2
    exit 1
fi

DETECT_STAGE_PY="$SCRIPT_DIR/detect_stage.py"

detect_stage() {
    # D3: Check script existence before calling
    if [[ ! -f "$DETECT_STAGE_PY" ]]; then
        echo "[ERROR] detect_stage.py not found: $DETECT_STAGE_PY" >&2
        echo "UNKNOWN"
        return 1
    fi
    python3 "$DETECT_STAGE_PY" "$TARGET_MD"
}

if [[ "$CALLER" == "target" && "$PHASE" == "requirements" ]]; then
    # --caller target --phase requirements: append proposed requirements
    DATE=$(date +%Y-%m-%d)
    if ! grep -q "## Research Insights" "$TARGET_MD"; then
        printf '\n## Research Insights\n' >> "$TARGET_MD"
    fi
    printf '\n### Proposed Requirements · %s\n\n#### [PROPOSED] Error Handling Strategy\n- TODO: Agent fills in requirements\n\n#### [PROPOSED] Performance Constraints\n- TODO: Agent fills in requirements\n\n#### [PROPOSED] Security Requirements\n- TODO: Agent fills in requirements\n' "$DATE" >> "$TARGET_MD"
    echo "Updated .target.md with proposed requirements."

    post_write_maintain

elif [[ "$CALLER" == "target" && "$PHASE" == "objective" ]]; then
    # D3: Tolerate detect_stage failure (missing script, unreadable file) under set -e
    STAGE=$(detect_stage) || true
    # D2: Validate STAGE for safe characters (prevent injection)
    # Allow colon for PENDING:O1/O2/O3 format
    STAGE=$(echo "$STAGE" | tr -cd 'A-Za-z0-9_-:')
    if [[ -z "$STAGE" ]]; then
        STAGE="UNKNOWN"
    fi
    echo "Detected stage: $STAGE"

    if [[ "$STAGE" == "UNKNOWN" ]]; then
        echo "[ERROR] Could not detect O-stage from $TARGET_MD" >&2
        exit 1
    elif [[ "$STAGE" == PENDING* ]]; then
        PENDING_STAGE="${STAGE#PENDING:}"
        echo "[ABORT] Pending [PROPOSED] items in $PENDING_STAGE — review and confirm before continuing."
        exit 0
    elif [[ "$STAGE" == "COMPLETE" ]]; then
        echo "All objective stages complete. Run with --phase requirements to continue."
        exit 0
    fi

    # Write insights to .target.md
    DATE=$(date +%Y-%m-%d)
    if ! grep -q "## Research Insights" "$TARGET_MD"; then
        printf '\n## Research Insights\n' >> "$TARGET_MD"
    fi
    # D1/D2: Use printf instead of echo -e to avoid interpreting escape sequences in STAGE
    printf '\n### %s: Insights · %s\n\n#### [PROPOSED] Refinement\n- Data for %s...\n' "$STAGE" "$DATE" "$STAGE" >> "$TARGET_MD"
    echo "Updated .target.md with $STAGE insights."

    # Trigger quick maintenance (research may have written to library)
    post_write_maintain
else
    # D6: Non-objective callers (plan/test/verify/check/exec/library or auto)
    # These callers need library search for context, not stage-based insights
    echo "Executing research for caller: ${CALLER:-auto}, scope: $SCOPE"

    # Default flow: search library first, then research gaps
    if [[ -f "$TARGET_MD" ]]; then
        # Extract keywords from target for library search
        # D3: grep returns 1 on no match; || true prevents set -euo pipefail from aborting
        KEYWORDS=$(grep -E "^##|^-" "$TARGET_MD" 2>/dev/null | head -5 | tr '\n' ' ' || true)
        if [[ -n "$KEYWORDS" ]]; then
            echo "[research] Searching library for: $KEYWORDS"
            library_search "$KEYWORDS"
        fi
    fi

    # Trigger maintenance (agent may have written to library during research)
    post_write_maintain

fi
