#!/usr/bin/env bash
# /task-ai:target implementation
# Usage: target.sh [objective_content]
#        target.sh --refine "refinement content"
#        target.sh --finalize

set -euo pipefail
trap 'rm -f "${TMP_FILE:-}"' EXIT INT TERM

# Parse arguments
REFINE_MODE=0
FINALIZE_MODE=0
OBJECTIVE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --refine)
            REFINE_MODE=1
            OBJECTIVE="${2:-}"
            shift 2 || shift
            ;;
        --finalize)
            FINALIZE_MODE=1
            shift
            ;;
        *)
            OBJECTIVE="$1"
            shift
            ;;
    esac
done

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

if ! find_nb_context; then
    echo "[ERROR] No active task context detected. Enter a notebook directory or switch to a task branch." >&2
    exit 1
fi

TARGET_FILE="$NB_WORKING/.target.md"
SESSION_CONTEXT="$NB_WORKING/.session-context"

# ─────────────────────────────────────────────────────────────────────────────
# Mode 1: Finalize (exit target-refinement, merge refinements)
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$FINALIZE_MODE" -eq 1 ]]; then
    if [[ -f "$SESSION_CONTEXT" ]] && grep -q "phase: target-refinement" "$SESSION_CONTEXT"; then
        rm -f "$SESSION_CONTEXT"
        echo "[target] Target finalized. Exited target-refinement phase."
        echo "[target] Run /plan to generate implementation plan."
    else
        echo "[target] Not in target-refinement phase."
    fi
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 2: Read (no objective provided)
# ─────────────────────────────────────────────────────────────────────────────
if [[ -z "$OBJECTIVE" ]] && [[ "$REFINE_MODE" -eq 0 ]]; then
    if [[ ! -f "$TARGET_FILE" ]]; then
        echo "[ERROR] Target file not found at $TARGET_FILE." >&2
        exit 1
    fi
    echo "--- Current Task Objective ---"
    cat "$TARGET_FILE"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 3: Refine (append refinement to existing target)
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$REFINE_MODE" -eq 1 ]]; then
    # D2: Validate refinement content is not empty
    if [[ -z "$OBJECTIVE" ]]; then
        echo "[ERROR] Refinement content cannot be empty." >&2
        exit 1
    fi

    if [[ ! -f "$TARGET_FILE" ]]; then
        echo "[ERROR] Cannot refine - no target file exists. Use /target first." >&2
        exit 1
    fi

    # D3: Warn if not in target-refinement phase (non-blocking)
    if [[ ! -f "$SESSION_CONTEXT" ]] || ! grep -q "phase: target-refinement" "$SESSION_CONTEXT"; then
        echo "[WARN] Not in target-refinement phase. Proceeding anyway."
    fi

    DATE=$(date "+%Y-%m-%d %H:%M")
    # D2: Use printf to avoid echo interpreting -n/-e as options
    REFINEMENT_LINE=$(printf '- [%s] %s' "$DATE" "$OBJECTIVE")

    # D1: Append refinement within Refinements section (not at file end)
    if grep -q "^## Refinements" "$TARGET_FILE"; then
        # Insert after ## Refinements section header (before next ## or EOF)
        TMP_FILE=$(mktemp) || { echo "[ERROR] Failed to create temp file" >&2; exit 1; }
        # D2: Use ENVIRON instead of -v to avoid backslash interpretation
        AWK_LINE="$REFINEMENT_LINE" awk '
            /^## Refinements/ { print; found=1; next }
            /^## / && found { print ENVIRON["AWK_LINE"]; print ""; found=0 }
            { print }
            END { if (found) print ENVIRON["AWK_LINE"] }
        ' "$TARGET_FILE" > "$TMP_FILE"
        if ! mv "$TMP_FILE" "$TARGET_FILE" 2>&1; then
            echo "[ERROR] Failed to update $TARGET_FILE" >&2
            exit 1
        fi
    else
        # Create Refinements section at end
        printf '\n## Refinements\n\n%s\n' "$REFINEMENT_LINE" >> "$TARGET_FILE"
    fi

    # D3: git with error handling
    if ! git add "$TARGET_FILE" 2>&1; then
        echo "[ERROR] git add failed" >&2
        exit 1
    fi
    if ! git commit -m "task-ai($NB_NOTEBOOK):target refine objective" 2>&1; then
        echo "[WARN] git commit failed (may be no changes)" >&2
    fi

    echo "[target] Refinement added: $OBJECTIVE"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 4: Write (create or replace objective)
# ─────────────────────────────────────────────────────────────────────────────
echo "Updating task objective in $TARGET_FILE..."

if [[ ! -f "$TARGET_FILE" ]]; then
    # D2: Use quoted 'TARGET_END' to prevent variable expansion in OBJECTIVE
    cat > "$TARGET_FILE" << 'TARGET_END'
# Task Target: NOTEBOOK_PLACEHOLDER

## Objective

OBJECTIVE_PLACEHOLDER

## Requirements

<!-- List specific requirements -->

## Constraints

<!-- Any constraints or limitations -->
TARGET_END
    # D2: Safe substitution with escaped special chars
    NB_ESCAPED="${NB_NOTEBOOK//\\/\\\\}"
    NB_ESCAPED="${NB_ESCAPED//&/\\&}"
    NB_ESCAPED="${NB_ESCAPED//\//\\/}"
    OBJ_ESCAPED="${OBJECTIVE//\\/\\\\}"
    OBJ_ESCAPED="${OBJ_ESCAPED//&/\\&}"
    OBJ_ESCAPED="${OBJ_ESCAPED//\//\\/}"
    sed -i "s/NOTEBOOK_PLACEHOLDER/${NB_ESCAPED}/g; s/OBJECTIVE_PLACEHOLDER/${OBJ_ESCAPED}/g" "$TARGET_FILE"
else
    # Update only the ## Objective section
    TMP_FILE=$(mktemp) || { echo "[ERROR] Failed to create temp file" >&2; exit 1; }
    # D6: Pass OBJECTIVE via environment variable to avoid shell escaping issues
    AWK_OBJ="$OBJECTIVE" awk '
      BEGIN { in_obj=0; found=0 }
      /^## Objective/ { print $0; print ""; print ENVIRON["AWK_OBJ"]; in_obj=1; found=1; next }
      /^## / && in_obj { in_obj=0 }
      !in_obj { print $0 }
      END { if (!found) { print "## Objective"; print ""; print ENVIRON["AWK_OBJ"] } }
    ' "$TARGET_FILE" > "$TMP_FILE"
    # D3: mv with error handling - abort if fails to prevent data loss
    if ! mv "$TMP_FILE" "$TARGET_FILE" 2>&1; then
        echo "[ERROR] Failed to update $TARGET_FILE - original preserved" >&2
        exit 1
    fi
fi

# D3: git with error handling
if ! git add "$TARGET_FILE" 2>&1; then
    echo "[ERROR] git add failed" >&2
    exit 1
fi
if ! git commit -m "task-ai($NB_NOTEBOOK):target update objective" 2>&1; then
    echo "[WARN] git commit failed (may be no changes)" >&2
fi

echo "Objective successfully updated and committed."

# Enter target-refinement phase
# D2: Variables are safe here (controlled values), but use explicit format
# D3: Error handling for session context write
if ! printf 'phase: target-refinement\nentered_at: %s\nentered_by: /task-ai:target\n' "$(date -Iseconds)" > "$SESSION_CONTEXT" 2>&1; then
    echo "[WARN] Failed to write session context" >&2
fi

echo "[target] Entered target-refinement phase."
echo "[target] Continue discussing to refine. Use /plan when ready."
