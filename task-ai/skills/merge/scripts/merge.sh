#!/usr/bin/env bash
# /task-ai:merge implementation
# Merge only — does NOT delete branches or worktrees.
# Usage: merge.sh <notebook>

set -euo pipefail

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
TASK_BRANCH=$(python3 "$STATE_PY" get "$INDEX_JSON" branch 2>/dev/null || echo "")

if [[ -z "$TASK_BRANCH" ]]; then
    TASK_BRANCH="task/$NOTEBOOK"
fi

# 2. Dynamically detect main branch (not hardcoded to master)
MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

# 3. Check for multi-stage tasks
STAGE_CURRENT=$(python3 "$STATE_PY" get "$INDEX_JSON" stage.current 2>/dev/null || echo "1")
STAGE_TOTAL=$(python3 "$STATE_PY" get "$INDEX_JSON" stage.total 2>/dev/null || echo "1")

if [[ "$STAGE_CURRENT" -lt "$STAGE_TOTAL" ]]; then
    echo "[STAGE] Stage $STAGE_CURRENT/$STAGE_TOTAL complete. Advancing to next stage."
    python3 "$STATE_PY" transition "$INDEX_JSON" --status stage-done
    echo "Task $NOTEBOOK stage $STAGE_CURRENT complete. Use init --continue to start next stage."
    exit 0
fi

echo "[GIT] Merging $TASK_BRANCH into $MAIN_BRANCH..."

# 4. Execute actual git merge
git checkout "$MAIN_BRANCH" || { echo "[ERROR] Failed to checkout $MAIN_BRANCH"; exit 1; }
git merge "$TASK_BRANCH" --no-ff -m "Merge task/$NOTEBOOK into $MAIN_BRANCH" || {
    echo "[ERROR] Merge conflict detected. Please resolve manually."
    git merge --abort
    git checkout "$TASK_BRANCH"
    exit 1
}

# 5. Return to task branch (keep it for reference)
git checkout "$TASK_BRANCH"

# 6. Update status to complete
python3 "$STATE_PY" transition "$INDEX_JSON" --status complete

# 7. Release lock
rm -f "$WORK_DIR/.lock"

echo "Task $NOTEBOOK successfully merged into $MAIN_BRANCH. Branch '$TASK_BRANCH' retained."
