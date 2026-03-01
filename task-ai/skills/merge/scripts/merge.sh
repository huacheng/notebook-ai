#!/usr/bin/env bash
# /task-ai:merge implementation
# Merge only — does NOT delete branches or worktrees.
# Usage: merge.sh <notebook>

set -uo pipefail
trap 'rm -f "${LOCK_FILE:-}" "${TMP_FILE:-}"' EXIT INT TERM

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

NOTEBOOK="${1:-}"
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

INDEX_JSON="$WORK_DIR/.index.json"
STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"

echo "Merging task: $NOTEBOOK"

# 1. Resolve task branch
TASK_BRANCH=$(python3 "$STATE_PY" get "$INDEX_JSON" branch)

if [[ -z "$TASK_BRANCH" ]]; then
    TASK_BRANCH="task/$NOTEBOOK"
fi

echo "[GIT] Merging $TASK_BRANCH into master..."

# 2. Update status to complete (retain branch/worktree metadata)
python3 "$STATE_PY" transition "$INDEX_JSON" --status complete

# 3. Release lock
rm -f "$WORK_DIR/.lock"

echo "Task $NOTEBOOK successfully merged. Branch '$TASK_BRANCH' retained."
