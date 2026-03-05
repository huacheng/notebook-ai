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

STATUS_JSON="$WORK_DIR/.status.json"
STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"

# D3: Check state.py existence before calling
if [[ ! -f "$STATE_PY" ]]; then
    echo "[ERROR] state.py not found: $STATE_PY" >&2
    exit 1
fi

echo "Merging task: $NOTEBOOK"

# 1. Resolve task branch
TASK_BRANCH=$(python3 "$STATE_PY" get "$STATUS_JSON" branch 2>/dev/null || echo "")

if [[ -z "$TASK_BRANCH" ]]; then
    TASK_BRANCH="task/$NOTEBOOK"
fi

# 2. Dynamically detect main branch (not hardcoded to master)
MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

# 3. Check for multi-stage tasks
STAGE_CURRENT=$(python3 "$STATE_PY" get "$STATUS_JSON" stage.current 2>/dev/null || echo "1")
STAGE_TOTAL=$(python3 "$STATE_PY" get "$STATUS_JSON" stage.total 2>/dev/null || echo "1")

# D2: Validate STAGE numbers contain only digits
if [[ ! "$STAGE_CURRENT" =~ ^[0-9]+$ ]]; then
    STAGE_CURRENT=1
fi
if [[ ! "$STAGE_TOTAL" =~ ^[0-9]+$ ]]; then
    STAGE_TOTAL=1
fi

if [[ "$STAGE_CURRENT" -lt "$STAGE_TOTAL" ]]; then
    echo "[STAGE] Stage $STAGE_CURRENT/$STAGE_TOTAL complete. Advancing to next stage."
    # D3: stage-done transition with error handling
    if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status stage-done 2>&1; then
        echo "[WARN] Failed to update status to stage-done" >&2
    fi
    # D1: Write .auto-signal for stage-done (consistent with SKILL.md)
    if ! cat > "$WORK_DIR/.auto-signal" <<'EOF'
{"step":"merge","result":"stage-done","next":"highlight","checkpoint":"","timestamp":""}
EOF
    then
        echo "[WARN] Failed to write .auto-signal" >&2
    fi
    # D1: Git commit stage state (per SKILL.md)
    cd "$WORK_DIR" || true
    if ! git add .status.json .auto-signal 2>&1; then
        echo "[WARN] git add failed for stage state" >&2
    fi
    if ! git commit -m "task-ai($NOTEBOOK):merge stage $STAGE_CURRENT completed" 2>&1; then
        echo "[WARN] git commit failed for stage state" >&2
    fi
    echo "Task $NOTEBOOK stage $STAGE_CURRENT complete. Use init --continue to start next stage."
    exit 0
fi

echo "[GIT] Merging $TASK_BRANCH into $MAIN_BRANCH..."

# 4. Execute actual git merge
git checkout "$MAIN_BRANCH" || { echo "[ERROR] Failed to checkout $MAIN_BRANCH"; exit 1; }
git merge "$TASK_BRANCH" --no-ff -m "Merge task/$NOTEBOOK into $MAIN_BRANCH" || {
    echo "[ERROR] Merge conflict detected. Please resolve manually."
    # D3: git merge --abort with error handling
    git merge --abort 2>&1 || echo "[WARN] merge --abort failed" >&2
    git checkout "$TASK_BRANCH" 2>&1 || true
    exit 1
}

# 5. Return to task branch (keep it for reference)
# D3: git checkout with error handling
if ! git checkout "$TASK_BRANCH" 2>&1; then
    echo "[WARN] Failed to checkout task branch $TASK_BRANCH" >&2
fi

# 6. Update status to complete
# D3: complete transition with error handling
if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status complete 2>&1; then
    echo "[WARN] Failed to update status to complete" >&2
fi

# 7. Release lock
rm -f "$WORK_DIR/.lock"

# 8. Write .auto-signal (D1: consistent with SKILL.md)
# D3: .auto-signal write with error handling
if ! cat > "$WORK_DIR/.auto-signal" <<'EOF'
{"step":"merge","result":"success","next":"highlight","checkpoint":"","timestamp":""}
EOF
then
    echo "[WARN] Failed to write .auto-signal" >&2
fi

# 9. Git commit task state (D1: per SKILL.md)
cd "$WORK_DIR" || true
if ! git add .status.json .auto-signal 2>&1; then
    echo "[WARN] git add failed for task state" >&2
fi
if ! git commit -m "task-ai($NOTEBOOK):merge task completed" 2>&1; then
    echo "[WARN] git commit failed for task state" >&2
fi

echo "Task $NOTEBOOK successfully merged into $MAIN_BRANCH. Branch '$TASK_BRANCH' retained."
