#!/usr/bin/env bash
# /task-ai:target implementation
# Usage: target.sh [objective_content]
#        target.sh --refine "refinement content"
#        target.sh --finalize

set -euo pipefail
trap 'rm -f "${TMP_FILE:-}" "${TMP_STATUS:-}"' EXIT ERR INT TERM HUP

# Parse arguments
REFINE_MODE=0
FINALIZE_MODE=0
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
STATUS_FILE="$NB_WORKING/.status.json"

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

# D1: Reject completed/cancelled tasks (SKILL.md State Transitions table)
if [[ "$CURRENT_STATUS" == "complete" || "$CURRENT_STATUS" == "cancelled" ]]; then
    echo "[ERROR] Completed/cancelled tasks cannot be re-targeted." >&2
    exit 1
fi

# D1: stage-done requires archive operations (SKILL.md step 2a) which are
# handled by the agent, not this script. Refuse direct script invocation.
if [[ "$CURRENT_STATUS" == "stage-done" ]] && [[ -n "${OBJECTIVE:-}" || "$REFINE_MODE" -eq 1 ]]; then
    echo "[ERROR] Status is 'stage-done'. Stage advance requires archive operations — use the agent workflow, not direct script invocation." >&2
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 1: Finalize (exit target-refinement phase)
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$FINALIZE_MODE" -eq 1 ]]; then
    if [[ -f "$SESSION_CONTEXT" ]] && grep -q "phase: target-refinement" "$SESSION_CONTEXT"; then
        rm -f "$SESSION_CONTEXT"
        echo "[target] Target finalized. Exited target-refinement phase."
        echo "[target] Run /task-ai:plan to generate implementation plan."
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
        echo "[ERROR] Cannot refine — no target file exists. Use /task-ai:target first." >&2
        exit 1
    fi

    # D3: Warn if not in target-refinement phase (non-blocking)
    if [[ ! -f "$SESSION_CONTEXT" ]] || ! grep -q "phase: target-refinement" "$SESSION_CONTEXT"; then
        echo "[WARN] Not in target-refinement phase. Proceeding anyway."
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

    # D3: git with error handling
    if ! git add "$TARGET_FILE" 2>/dev/null; then
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

# D1: Update .status.json status transition (SKILL.md State Transitions table)
# draft → planning; blocked → planning; review → re-planning
# NOTE: stage-done is NOT transitioned here — SKILL.md step 2a requires archive
# (steps 4-5) BEFORE status change. The agent handles stage-done → planning
# after performing archive operations. See SKILL.md "Atomicity" note.
if [[ -f "$STATUS_FILE" ]] && ! command -v jq &>/dev/null; then
    echo "[WARN] jq not found — cannot update .status.json status transition" >&2
elif [[ -f "$STATUS_FILE" ]]; then
    NEW_STATUS=""
    case "$CURRENT_STATUS" in
        draft|blocked)  NEW_STATUS="planning" ;;
        review)         NEW_STATUS="re-planning" ;;
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

# D3: git with error handling — always add target file; add status file if it was modified
GIT_ADD_FILES=("$TARGET_FILE")
if [[ -n "${NEW_STATUS:-}" ]]; then
    GIT_ADD_FILES+=("$STATUS_FILE")
fi
if ! git add "${GIT_ADD_FILES[@]}" 2>/dev/null; then
    echo "[ERROR] git add failed" >&2
    exit 1
fi
if ! git commit -m "task-ai($NB_NOTEBOOK):target update objective" 2>/dev/null; then
    echo "[WARN] git commit failed (may be no changes)" >&2
fi

echo "Objective successfully updated and committed."

# Enter target-refinement phase
# D2: Variables are safe here (controlled values), but use explicit format
# D3: Error handling for session context write
if ! printf 'phase: target-refinement\nentered_at: %s\nentered_by: /task-ai:target\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$SESSION_CONTEXT" 2>/dev/null; then
    echo "[WARN] Failed to write session context" >&2
fi

echo "[target] Entered target-refinement phase."
echo "[target] Continue discussing to refine. Use /task-ai:plan when ready."
