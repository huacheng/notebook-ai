#!/usr/bin/env bash
# /task-ai:target implementation
# Usage: target.sh [objective_content]
#        target.sh --refine "refinement content"
#        target.sh --satisfy

set -euo pipefail
trap 'rm -f "${TMP_FILE:-}" "${TMP_STATUS:-}"' EXIT ERR INT TERM HUP

# Parse arguments
REFINE_MODE=0
SATISFY_MODE=0
OBJECTIVE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --refine)
            REFINE_MODE=1
            # D2: Validate that --refine's value is not another flag
            if [[ "${2:-}" == --* ]]; then
                echo "[ERROR] --refine requires a content argument, got '$2'" >&2
                exit 1
            fi
            OBJECTIVE="${2:-}"
            shift 2 || shift
            ;;
        --satisfy)
            SATISFY_MODE=1
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
STATUS_FILE="$NB_WORKING/.status.json"
BASELINE_FILE="$NB_WORKING/.convergence-baseline.md"
STATE_PY="$SCRIPT_DIR/../../../core/state.py"

# ─────────────────────────────────────────────────────────────────────────────
# D1: Read .status.json and reject complete/cancelled tasks (SKILL.md step 1)
# ─────────────────────────────────────────────────────────────────────────────
CURRENT_STATUS=""
if [[ -f "$STATUS_FILE" ]]; then
    # D3: Graceful fallback if jq unavailable or JSON malformed
    if command -v jq &>/dev/null; then
        CURRENT_STATUS=$(jq -r '.status // "draft"' "$STATUS_FILE" 2>/dev/null) || CURRENT_STATUS="draft"
    else
        # Fallback: grep-based extraction
        CURRENT_STATUS=$(grep -oP '"status"\s*:\s*"\K[^"]+' "$STATUS_FILE" 2>/dev/null) || CURRENT_STATUS="draft"
    fi
fi
CURRENT_STATUS="${CURRENT_STATUS:-draft}"

# D1: Reject cancelled tasks (SKILL.md State Transitions table)
if [[ "$CURRENT_STATUS" == "cancelled" ]]; then
    echo "[ERROR] Cancelled tasks cannot be re-targeted." >&2
    exit 1
fi

# D1: evolving with objective write should be rejected (require agent workflow for Stage Advance)
if [[ "$CURRENT_STATUS" == "evolving" ]] && [[ -n "${OBJECTIVE:-}" || "$REFINE_MODE" -eq 1 ]]; then
    echo "[ERROR] Status is 'evolving'. Stage advance requires agent workflow — use the agent workflow, not direct script invocation." >&2
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 1: Satisfy (mark task as satisfied from evolving status)
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$SATISFY_MODE" == "1" ]]; then
    if [[ ! -f "$STATUS_FILE" ]]; then
        echo "[ERROR] Task not initialized — .status.json does not exist at $STATUS_FILE" >&2
        exit 1
    fi
    CURRENT_STATUS=$(python3 "$STATE_PY" get "$STATUS_FILE" status 2>/dev/null || echo "")
    if [[ "$CURRENT_STATUS" != "evolving" ]]; then
        echo "[ERROR] --satisfy requires status 'evolving', current is '$CURRENT_STATUS'" >&2
        exit 1
    fi
    python3 "$STATE_PY" set "$STATUS_FILE" status satisfied
    if ! git add "$STATUS_FILE" || ! git commit -m "task-ai($NB_NOTEBOOK):target marked satisfied" 2>/dev/null; then
        echo "[WARN] git commit failed (status updated locally but not committed)" >&2
    fi
    echo "Task marked as satisfied. Use /task-ai:target to re-enter evolution if needed."
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
        echo "[ERROR] Cannot refine — no target file exists. Use /task-ai:target first." >&2
        exit 1
    fi

    DATE=$(date "+%Y-%m-%d %H:%M")
    # D2: Direct string assignment — avoids echo -n/-e interpretation and
    # printf format specifier injection from user content (e.g., "50% done")
    REFINEMENT_LINE="- [$DATE] $OBJECTIVE"

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
        if ! mv "$TMP_FILE" "$TARGET_FILE" 2>/dev/null; then
            echo "[ERROR] Failed to update $TARGET_FILE" >&2
            exit 1
        fi
    else
        # Create Refinements section at end
        printf '\n## Refinements\n\n%s\n' "$REFINEMENT_LINE" >> "$TARGET_FILE"
    fi

    # D3: git with error handling — include baseline file if it exists
    REFINE_GIT_FILES=("$TARGET_FILE")
    if [[ -f "$BASELINE_FILE" ]]; then
        REFINE_GIT_FILES+=("$BASELINE_FILE")
    fi
    if ! git add "${REFINE_GIT_FILES[@]}" 2>/dev/null; then
        echo "[ERROR] git add failed" >&2
        exit 1
    fi
    if ! git commit -m "task-ai($NB_NOTEBOOK):target refine objective" 2>/dev/null; then
        echo "[WARN] git commit failed (may be no changes)" >&2
    fi

    echo "[target] Refinement added: $OBJECTIVE"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 4: Write (create or replace objective)
# Implements SKILL.md step 2c (Normal mode). Steps 2a (Stage Advance) and
# 2b (Multi-stage Update) are handled by the agent, not this script.
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
    # D2: Use awk ENVIRON for safe substitution (handles newlines, special chars)
    # D2: Escape \ and & in replacement strings — awk gsub treats \ as escape and & as matched text
    TMP_FILE=$(mktemp) || { echo "[ERROR] Failed to create temp file" >&2; exit 1; }
    AWK_NB="$NB_NOTEBOOK" AWK_OBJ="$OBJECTIVE" awk '
        BEGIN {
            nb = ENVIRON["AWK_NB"]; gsub(/\\/, "\\\\", nb); gsub(/&/, "\\\\&", nb)
            obj = ENVIRON["AWK_OBJ"]; gsub(/\\/, "\\\\", obj); gsub(/&/, "\\\\&", obj)
        }
        { gsub(/NOTEBOOK_PLACEHOLDER/, nb); gsub(/OBJECTIVE_PLACEHOLDER/, obj); print }
    ' "$TARGET_FILE" > "$TMP_FILE"
    if ! mv "$TMP_FILE" "$TARGET_FILE" 2>/dev/null; then
        echo "[ERROR] Failed to write $TARGET_FILE" >&2
        exit 1
    fi
else
    # Update only the ## Objective section
    TMP_FILE=$(mktemp) || { echo "[ERROR] Failed to create temp file" >&2; exit 1; }
    # D6: Pass OBJECTIVE via environment variable to avoid shell escaping issues
    # D3: Preserve blank line before next section header to avoid format degradation
    AWK_OBJ="$OBJECTIVE" awk '
      BEGIN { in_obj=0; found=0 }
      /^## Objective/ { print $0; print ""; print ENVIRON["AWK_OBJ"]; in_obj=1; found=1; next }
      /^## / && in_obj { print ""; in_obj=0 }
      !in_obj { print $0 }
      END { if (!found) { print "## Objective"; print ""; print ENVIRON["AWK_OBJ"] } }
    ' "$TARGET_FILE" > "$TMP_FILE"
    # D3: mv with error handling — abort if fails to prevent data loss
    if ! mv "$TMP_FILE" "$TARGET_FILE" 2>/dev/null; then
        echo "[ERROR] Failed to update $TARGET_FILE — original preserved" >&2
        exit 1
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Convergence Baseline: create template if it doesn't exist (SKILL.md step 3e)
# Actual R# extraction requires LLM intelligence — script only ensures the file
# exists with the correct header structure so the agent can populate it.
# ─────────────────────────────────────────────────────────────────────────────
if [[ ! -f "$BASELINE_FILE" ]]; then
    BASELINE_DATE=$(date -u "+%Y-%m-%dT%H:%M:%SZ")
    cat > "$BASELINE_FILE" << BASELINE_END
# Convergence Baseline

Generated from: .target.md Overall Objective + Requirements
Updated: $BASELINE_DATE

| # | Requirement | Weight | Source |
|---|------------|--------|--------|
BASELINE_END
    echo "[target] Created convergence baseline template: $BASELINE_FILE"
fi

# D1: Update .status.json status transition (SKILL.md State Transitions table)
# draft → planning; blocked → planning; review → re-planning; satisfied → planning (re-enter evolution)
if [[ -f "$STATUS_FILE" ]] && ! command -v jq &>/dev/null; then
    echo "[WARN] jq not found — cannot update .status.json status transition" >&2
elif [[ -f "$STATUS_FILE" ]]; then
    NEW_STATUS=""
    case "$CURRENT_STATUS" in
        draft|blocked|satisfied)  NEW_STATUS="planning" ;;
        review)                   NEW_STATUS="re-planning" ;;
    esac
    if [[ -n "$NEW_STATUS" ]]; then
        TMP_STATUS=$(mktemp) || { echo "[ERROR] Failed to create temp file for status" >&2; exit 1; }
        if jq --arg s "$NEW_STATUS" '.status = $s' "$STATUS_FILE" > "$TMP_STATUS" 2>/dev/null; then
            mv "$TMP_STATUS" "$STATUS_FILE" || echo "[WARN] Failed to update status" >&2
        else
            rm -f "$TMP_STATUS"
            echo "[WARN] Failed to update .status.json" >&2
        fi
    fi
fi

# D3: git with error handling — always add target file; add status/baseline files if modified
GIT_ADD_FILES=("$TARGET_FILE")
if [[ -n "${NEW_STATUS:-}" ]]; then
    GIT_ADD_FILES+=("$STATUS_FILE")
fi
if [[ -f "$BASELINE_FILE" ]]; then
    GIT_ADD_FILES+=("$BASELINE_FILE")
fi
if ! git add "${GIT_ADD_FILES[@]}" 2>/dev/null; then
    echo "[ERROR] git add failed" >&2
    exit 1
fi
if ! git commit -m "task-ai($NB_NOTEBOOK):target update objective" 2>/dev/null; then
    echo "[WARN] git commit failed (may be no changes)" >&2
fi

echo "Objective successfully updated and committed."
echo "[target] Continue discussing to refine. Use /task-ai:plan when ready."
