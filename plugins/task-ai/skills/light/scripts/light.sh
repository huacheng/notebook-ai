#!/usr/bin/env bash
# /task-ai:light commit helper
# Usage: light.sh --commit "<description>"
#
# Auto-discovers scope from notebook context or git root,
# then creates a commit: task-ai(<scope>):light <description>

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../.dev/contracts/lib.sh"

ARG1="${1:-}"
ARG2="${2:-}"

if [[ "$ARG1" != "--commit" || -z "$ARG2" ]]; then
    echo "[ERROR] Usage: light.sh --commit \"<description>\"" >&2
    exit 1
fi

DESCRIPTION="$ARG2"

# --- Context discovery: determine scope ---
SCOPE=""

# 1. Try notebook context (walk up looking for .working/.index.json)
if find_nb_context 2>/dev/null; then
    SCOPE="$NB_NOTEBOOK"
fi

# 2. Fallback: git root directory name
if [[ -z "$SCOPE" ]]; then
    GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
    if [[ -n "$GIT_ROOT" ]]; then
        SCOPE=$(basename "$GIT_ROOT")
    else
        echo "[ERROR] Not in a git repository." >&2
        exit 1
    fi
fi

# --- Commit staged changes ---
if git diff --cached --quiet 2>/dev/null; then
    echo "[ERROR] Nothing staged to commit." >&2
    exit 1
fi

git commit -m "task-ai($SCOPE):light $DESCRIPTION" > /dev/null
echo "Committed: task-ai($SCOPE):light $DESCRIPTION"
