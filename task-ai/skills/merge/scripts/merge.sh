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

# D2: Re-validate notebook name (find_nb_context path skips lib.sh validation)
if [[ ! "$NOTEBOOK" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "[ERROR] Invalid notebook name: $NOTEBOOK" >&2
    exit 1
fi

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

# D1: Validate status is 'executing' (per SKILL.md prerequisite)
CURRENT_STATUS=$(python3 "$STATE_PY" get "$STATUS_JSON" status 2>/dev/null || echo "")
if [[ "$CURRENT_STATUS" != "executing" ]]; then
    echo "[ERROR] Task status is '$CURRENT_STATUS', expected 'executing'. Cannot merge." >&2
    exit 1
fi

# D3: Check for uncommitted changes that would block checkout
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo "[ERROR] Working tree has uncommitted changes. Commit or stash before merging." >&2
    exit 1
fi

echo "Merging task: $NOTEBOOK"

# 1. Resolve task branch
TASK_BRANCH=$(python3 "$STATE_PY" get "$STATUS_JSON" branch 2>/dev/null || echo "")

if [[ -z "$TASK_BRANCH" ]]; then
    TASK_BRANCH="task/$NOTEBOOK"
fi

# D2: Validate branch name (prevent flag injection via crafted .status.json)
if [[ "$TASK_BRANCH" == -* ]] || [[ ! "$TASK_BRANCH" =~ ^[a-zA-Z0-9_./-]+$ ]]; then
    echo "[ERROR] Invalid branch name in .status.json: $TASK_BRANCH" >&2
    exit 1
fi

# D3: Verify task branch exists
if ! git rev-parse --verify "$TASK_BRANCH" >/dev/null 2>&1; then
    echo "[ERROR] Task branch '$TASK_BRANCH' does not exist." >&2
    exit 1
fi

# 2. Dynamically detect main branch (not hardcoded to master)
MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

# D3: Verify main branch exists
if ! git rev-parse --verify "$MAIN_BRANCH" >/dev/null 2>&1; then
    echo "[ERROR] Main branch '$MAIN_BRANCH' does not exist." >&2
    exit 1
fi

# 3. Read multi-stage info (used after merge in Phase 4)
STAGE_CURRENT=$(python3 "$STATE_PY" get "$STATUS_JSON" stage.current 2>/dev/null || echo "1")
STAGE_TOTAL=$(python3 "$STATE_PY" get "$STATUS_JSON" stage.total 2>/dev/null || echo "1")

# D2: Validate STAGE numbers contain only digits
if [[ ! "$STAGE_CURRENT" =~ ^[0-9]+$ ]]; then
    STAGE_CURRENT=1
fi
if [[ ! "$STAGE_TOTAL" =~ ^[0-9]+$ ]]; then
    STAGE_TOTAL=1
fi

# D3: Handle stage.current > stage.total inconsistency (per SKILL.md Phase 4 step 2)
if [[ "$STAGE_CURRENT" -gt "$STAGE_TOTAL" ]]; then
    echo "[WARN] stage.current ($STAGE_CURRENT) > stage.total ($STAGE_TOTAL) — treating as final stage" >&2
fi

echo "[GIT] Merging $TASK_BRANCH into $MAIN_BRANCH..."

# 4. Phase 2: Execute actual git merge
if ! git checkout "$MAIN_BRANCH"; then
    echo "[ERROR] Failed to checkout $MAIN_BRANCH" >&2
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    cat > "$WORK_DIR/.auto-signal" <<EOF
{"step":"merge","result":"conflict","next":"(stop)","checkpoint":"","timestamp":"$TIMESTAMP"}
EOF
    exit 1
fi

MERGE_OK=0
git merge "$TASK_BRANCH" --no-ff -m "task-ai($NOTEBOOK):merge merge completed task" || MERGE_OK=1

if [[ "$MERGE_OK" -ne 0 ]]; then
    echo "[ERROR] Merge conflict detected. Please resolve manually."
    # D3: Abort merge and write conflict signal
    git merge --abort 2>/dev/null || echo "[WARN] merge --abort failed" >&2
    git checkout "$TASK_BRANCH" 2>/dev/null || true

    # D1: Write conflict .auto-signal (per SKILL.md)
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    cat > "$WORK_DIR/.auto-signal" <<EOF
{"step":"merge","result":"conflict","next":"(stop)","checkpoint":"","timestamp":"$TIMESTAMP"}
EOF
    exit 1
fi

# Merge succeeded — return to task branch for state updates
if ! git checkout "$TASK_BRANCH" 2>/dev/null; then
    echo "[WARN] Failed to checkout task branch $TASK_BRANCH after merge" >&2
fi

# 5. Phase 4: Post-merge finalization — branch on stage info
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [[ "$STAGE_CURRENT" -lt "$STAGE_TOTAL" ]]; then
    # --- Intermediate stage complete ---
    echo "[STAGE] Stage $STAGE_CURRENT/$STAGE_TOTAL complete. Advancing to next stage."

    # D1: Status transition (SKILL.md requires .summary.md/.target.md writes before this — handled by AI agent caller)
    if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status stage-done; then
        echo "[WARN] Failed to update status to stage-done" >&2
    fi

    # Write .auto-signal for stage-done
    cat > "$WORK_DIR/.auto-signal" <<EOF
{"step":"merge","result":"stage-done","next":"highlight","checkpoint":"","timestamp":"$TIMESTAMP"}
EOF

    # Git commit stage state
    cd "$WORK_DIR" || true
    git add .status.json .auto-signal 2>/dev/null || echo "[WARN] git add failed for stage state" >&2
    git commit -m "task-ai($NOTEBOOK):merge stage $STAGE_CURRENT completed" 2>/dev/null || echo "[WARN] git commit failed for stage state" >&2

    echo "Task $NOTEBOOK stage $STAGE_CURRENT complete. Use init --continue to start next stage."
else
    # --- Final stage or single-stage task ---
    # D1: Update status to complete (retain branch/worktree per SKILL.md)
    if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status complete; then
        echo "[WARN] Failed to update status to complete" >&2
    fi

    # Write .auto-signal for success
    cat > "$WORK_DIR/.auto-signal" <<EOF
{"step":"merge","result":"success","next":"highlight","checkpoint":"","timestamp":"$TIMESTAMP"}
EOF

    # Git commit task state
    cd "$WORK_DIR" || true
    git add .status.json .auto-signal 2>/dev/null || echo "[WARN] git add failed for task state" >&2
    git commit -m "task-ai($NOTEBOOK):merge task completed" 2>/dev/null || echo "[WARN] git commit failed for task state" >&2

    echo "Task $NOTEBOOK successfully merged into $MAIN_BRANCH. Branch '$TASK_BRANCH' retained."
fi
