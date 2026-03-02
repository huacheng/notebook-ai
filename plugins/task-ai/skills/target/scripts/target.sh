#!/usr/bin/env bash
# /task-ai:target implementation
# Usage: target.sh [objective_content]

set -uo pipefail
trap 'rm -f "${TMP_FILE:-}"' EXIT INT TERM

OBJECTIVE="${1:-}"

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

if ! find_nb_context; then
    echo "[ERROR] No active task context detected. Enter a notebook directory or switch to a task branch." >&2
    exit 1
fi

TARGET_FILE="$NB_WORKING/.target.md"

# 1. Read Mode (No objective provided)
if [[ -z "$OBJECTIVE" ]]; then
    if [[ ! -f "$TARGET_FILE" ]]; then
        echo "[ERROR] Target file not found at $TARGET_FILE." >&2
        exit 1
    fi
    echo "--- Current Task Objective ---"
    cat "$TARGET_FILE"
    exit 0
fi

# 2. Write Mode (Objective provided)
echo "Updating task objective in $TARGET_FILE..."

# Simple Markdown structure (can be enhanced with agent logic for sophisticated parsing)
# For now, we update the # Task Target heading or create it if missing.
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
    # Update only the ## Objective section using a temporary file
    TMP_FILE=$(mktemp)
    AWK_OBJ="$OBJECTIVE" awk '
      BEGIN { in_obj=0; found=0 }
      /^## Objective/ { print $0; print ENVIRON["AWK_OBJ"]; in_obj=1; found=1; next }
      /^## / && in_obj { in_obj=0 }
      !in_obj { print $0 }
      END { if (!found) { print "## Objective"; print ENVIRON["AWK_OBJ"] } }
    ' "$TARGET_FILE" > "$TMP_FILE"
    mv "$TMP_FILE" "$TARGET_FILE"
fi

# 3. Git Commit
git add "$TARGET_FILE"
git commit -m "task-ai($NB_NOTEBOOK):target update objective"

echo "Objective successfully updated and committed."
