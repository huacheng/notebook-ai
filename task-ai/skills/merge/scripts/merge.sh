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

# D2: Re-validate notebook name (find_nb_context derives name from directory/branch without full sanitization)
if [[ ! "$NOTEBOOK" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "[ERROR] Invalid notebook name: $NOTEBOOK" >&2
    exit 1
fi

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

STATUS_JSON="$WORK_DIR/.status.json"
STATE_PY="$TASK_AI_ROOT/core/state.py"
SIGNAL_FILE="$WORK_DIR/.auto-signal"

# D3: Cleanup handler — remove temp files on exit
cleanup_merge() {
    rm -f "${SIGNAL_FILE}.tmp" 2>/dev/null || true
}
trap cleanup_merge EXIT INT TERM

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

# D1: Validate dependency gate (per SKILL.md step 2)
DEPENDS_ON=$(python3 "$STATE_PY" get "$STATUS_JSON" depends_on 2>/dev/null || echo "")
if [[ -n "$DEPENDS_ON" && "$DEPENDS_ON" != "None" && "$DEPENDS_ON" != "[]" ]]; then
    echo "[INFO] Dependency gate: depends_on present — validation delegated to AI agent caller" >&2
fi

# D6: Helper to write rejection signal and exit (reduces duplication)
reject_no_accept() {
    local msg="$1"
    echo "[ERROR] $msg" >&2
    local ts
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    # D3: Atomic write via .tmp + mv
    cat > "${SIGNAL_FILE}.tmp" <<EOSIG
{"step":"merge","result":"rejected","next":"(stop)","checkpoint":"no-accept","timestamp":"$ts"}
EOSIG
    mv "${SIGNAL_FILE}.tmp" "$SIGNAL_FILE"
    exit 1
}

# D1: Verify ACCEPT verdict exists (per SKILL.md step 3)
ANALYSIS_DIR="$WORK_DIR/.analysis"
if [[ ! -d "$ANALYSIS_DIR" ]]; then
    reject_no_accept "Analysis directory not found. Run 'check --checkpoint post-exec' first."
fi
# D2: Use find instead of ls glob to avoid issues with special-char filenames
# D6: Sort by filename (reverse alpha) — filenames are date-prefixed, consistent with exec.sh
LATEST_ANALYSIS=$(find "$ANALYSIS_DIR" -maxdepth 1 -type f -name '*.md' 2>/dev/null | sort -r | head -1)
if [[ -z "$LATEST_ANALYSIS" ]]; then
    reject_no_accept "No analysis files found in $ANALYSIS_DIR. Run 'check --checkpoint post-exec' first."
fi
# D1: Use extended regex; anchor "accept" after "verdict" to avoid matching "not-accept"
if ! grep -qiE "post-exec-accept|verdict[: ]+accept" "$LATEST_ANALYSIS" 2>/dev/null; then
    reject_no_accept "No ACCEPT verdict found in latest analysis file. Run 'check --checkpoint post-exec' first."
fi

# D3: Check for uncommitted changes that would block checkout
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo "[ERROR] Working tree has uncommitted changes. Commit or stash before merging." >&2
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    cat > "${SIGNAL_FILE}.tmp" <<EOF
{"step":"merge","result":"rejected","next":"(stop)","checkpoint":"checkout-failed","timestamp":"$TIMESTAMP"}
EOF
    mv "${SIGNAL_FILE}.tmp" "$SIGNAL_FILE"
    exit 1
fi

echo "Merging task: $NOTEBOOK"

# Resolve task branch from .status.json (default: task/<notebook>)
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
if ! git rev-parse --verify "refs/heads/$TASK_BRANCH" >/dev/null 2>&1; then
    echo "[ERROR] Task branch '$TASK_BRANCH' does not exist." >&2
    exit 1
fi

# Dynamically detect main branch (not hardcoded to master)
MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "")

# D3: Fallback chain — try "main", then "master"
# D3: Use refs/heads/ prefix to ensure we match local branches, not tags
if [[ -z "$MAIN_BRANCH" ]] || ! git rev-parse --verify "refs/heads/$MAIN_BRANCH" >/dev/null 2>&1; then
    if git rev-parse --verify "refs/heads/main" >/dev/null 2>&1; then
        MAIN_BRANCH="main"
    elif git rev-parse --verify "refs/heads/master" >/dev/null 2>&1; then
        MAIN_BRANCH="master"
    else
        echo "[ERROR] No main/master branch found." >&2
        exit 1
    fi
fi

# Read multi-stage info (used after merge in Phase 3)
STAGE_CURRENT=$(python3 "$STATE_PY" get "$STATUS_JSON" stage.current 2>/dev/null || echo "1")

# D2: Validate STAGE number contains only digits; D3: guard against zero/invalid values
if [[ ! "$STAGE_CURRENT" =~ ^[0-9]+$ ]] || [[ "$STAGE_CURRENT" -eq 0 ]]; then
    STAGE_CURRENT=1
fi

echo "[GIT] Merging $TASK_BRANCH into $MAIN_BRANCH..."

# Phase 1: Execute actual git merge
if ! git checkout "$MAIN_BRANCH"; then
    echo "[ERROR] Failed to checkout $MAIN_BRANCH" >&2
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    # D3: Atomic write via .tmp + mv
    cat > "${SIGNAL_FILE}.tmp" <<EOF
{"step":"merge","result":"rejected","next":"(stop)","checkpoint":"checkout-failed","timestamp":"$TIMESTAMP"}
EOF
    mv "${SIGNAL_FILE}.tmp" "$SIGNAL_FILE"
    exit 1
fi

# D6: Variable name reflects semantics — 0 = no failure, 1 = failure
MERGE_FAILED=0
git merge --no-ff -m "task-ai($NOTEBOOK):merge merge completed task" -- "$TASK_BRANCH" || MERGE_FAILED=1

if [[ "$MERGE_FAILED" -ne 0 ]]; then
    echo "[ERROR] Merge failed (likely conflict). Please resolve manually." >&2
    # D3: Abort merge and write conflict signal
    git merge --abort 2>/dev/null || echo "[WARN] merge --abort failed" >&2
    git checkout "$TASK_BRANCH" 2>/dev/null || true

    # D1: Write conflict .auto-signal (per SKILL.md)
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    # D3: Atomic write via .tmp + mv
    cat > "${SIGNAL_FILE}.tmp" <<EOF
{"step":"merge","result":"conflict","next":"(stop)","checkpoint":"","timestamp":"$TIMESTAMP"}
EOF
    mv "${SIGNAL_FILE}.tmp" "$SIGNAL_FILE"
    exit 1
fi

# Merge succeeded — stay on main branch for state update commits
# D1: State updates (.status.json, .auto-signal) must be committed on main so
# the merged codebase includes the final status. Checking out the task branch
# would leave main without the status transition.

# Phase 3: Post-merge finalization — unified evolving path (progressive evolution)
# D1: Always transition to evolving (no stage.total comparison — progressive evolution model)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[STAGE] Stage $STAGE_CURRENT completed. Status → evolving."
if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status evolving \
    --stage-history "{\"stage\":$STAGE_CURRENT,\"name\":\"stage-$STAGE_CURRENT\",\"completed_at\":\"$TIMESTAMP\"}"; then
    echo "[ERROR] Failed to update task state to evolving" >&2
    exit 1
fi

# Write .auto-signal for evolving (atomic)
cat > "${SIGNAL_FILE}.tmp" <<EOF
{"step":"merge","result":"evolving","next":"highlight","checkpoint":"","timestamp":"$TIMESTAMP"}
EOF
mv "${SIGNAL_FILE}.tmp" "$SIGNAL_FILE"

# Git commit stage state
cd "$WORK_DIR" || { echo "[ERROR] Cannot cd to $WORK_DIR" >&2; exit 1; }
git add .status.json .auto-signal 2>/dev/null || echo "[WARN] git add failed for stage state" >&2
git commit -m "task-ai($NOTEBOOK):merge stage $STAGE_CURRENT completed" 2>/dev/null || echo "[WARN] git commit failed for stage state" >&2

echo "Task $NOTEBOOK stage $STAGE_CURRENT complete. Use /task-ai:target to define next stage or --satisfy to mark satisfied."
