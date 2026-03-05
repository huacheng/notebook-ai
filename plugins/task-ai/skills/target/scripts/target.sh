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

    # Append refinement to Refinements section (create if not exists)
    if grep -q "^## Refinements" "$TARGET_FILE"; then
        # Append to existing Refinements section
        echo "- [$DATE] $OBJECTIVE" >> "$TARGET_FILE"
    else
        # Create Refinements section
        echo "" >> "$TARGET_FILE"
        echo "## Refinements" >> "$TARGET_FILE"
        echo "" >> "$TARGET_FILE"
        echo "- [$DATE] $OBJECTIVE" >> "$TARGET_FILE"
    fi

    git add "$TARGET_FILE"
    git commit -m "task-ai($NB_NOTEBOOK):target refine objective"

    echo "[target] Refinement added: $OBJECTIVE"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode 4: Write (create or replace objective)
# ─────────────────────────────────────────────────────────────────────────────
echo "Updating task objective in $TARGET_FILE..."

if [[ ! -f "$TARGET_FILE" ]]; then
    cat > "$TARGET_FILE" <<EOF
# Task Target: $NB_NOTEBOOK

## Objective

$OBJECTIVE

## Requirements

<!-- List specific requirements -->

## Constraints

<!-- Any constraints or limitations -->
EOF
else
    # Update only the ## Objective section
    TMP_FILE=$(mktemp)
    AWK_OBJ="$OBJECTIVE" awk '
      BEGIN { in_obj=0; found=0 }
      /^## Objective/ { print $0; print ""; print ENVIRON["AWK_OBJ"]; in_obj=1; found=1; next }
      /^## / && in_obj { in_obj=0 }
      !in_obj { print $0 }
      END { if (!found) { print "## Objective"; print ""; print ENVIRON["AWK_OBJ"] } }
    ' "$TARGET_FILE" > "$TMP_FILE"
    mv "$TMP_FILE" "$TARGET_FILE"
fi

git add "$TARGET_FILE"
git commit -m "task-ai($NB_NOTEBOOK):target update objective"

echo "Objective successfully updated and committed."

# Enter target-refinement phase
cat > "$SESSION_CONTEXT" << EOF
phase: target-refinement
entered_at: $(date -Iseconds)
entered_by: /task-ai:target
EOF

echo "[target] Entered target-refinement phase."
echo "[target] Continue discussing to refine. Use /plan when ready."
