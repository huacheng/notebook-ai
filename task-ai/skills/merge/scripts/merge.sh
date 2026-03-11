#!/usr/bin/env bash
# /task-ai:merge implementation
# Copy <notebook>/.deliverables/ to main — does NOT do full git merge, delete branches or worktrees.
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
# D3: Cleanup handler — remove temp files on exit
MERGE_TMPDIR=""
cleanup_merge() {
    [[ -n "$MERGE_TMPDIR" ]] && rm -rf "$MERGE_TMPDIR" 2>/dev/null || true
}
trap cleanup_merge EXIT INT TERM

# D3: Check state.py existence before calling
if [[ ! -f "$STATE_PY" ]]; then
    echo "[ERROR] state.py not found: $STATE_PY" >&2
    exit 1
fi

# D1: Validate status is 'executing' or 'evolving' (per SKILL.md prerequisite)
CURRENT_STATUS=$(python3 "$STATE_PY" get "$STATUS_JSON" status 2>/dev/null || echo "")
if [[ "$CURRENT_STATUS" != "executing" && "$CURRENT_STATUS" != "evolving" ]]; then
    echo "[ERROR] Task status is '$CURRENT_STATUS', expected 'executing' or 'evolving'. Cannot merge." >&2
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

# v2: No stage info needed — merge is pure file copy, status handled by auto

echo "[GIT] Copying .deliverables/ from $TASK_BRANCH to $MAIN_BRANCH..."

# Resolve paths before branch switch (paths vanish after checkout master)
NB_DIR="$(dirname "$WORK_DIR")"
PROJECT_DIR="$(dirname "$NB_DIR")"
SRC_DELIVERABLES="$NB_DIR/.deliverables"
DELIVERABLES_TARGET="$PROJECT_DIR/.deliverables/$NOTEBOOK"

# D3: Save deliverables to temp dir before switching branches (cleaned up by cleanup_merge trap)
MERGE_TMPDIR=$(mktemp -d)
HAS_DELIVERABLES=0
if [[ -d "$SRC_DELIVERABLES" ]] && [[ -n "$(ls -A "$SRC_DELIVERABLES" 2>/dev/null)" ]]; then
    # D3: Explicit error handling — set -e exits on failure but won't write signal
    if ! cp -a "$SRC_DELIVERABLES/." "$MERGE_TMPDIR/"; then
        echo "[ERROR] Failed to copy deliverables to temp dir" >&2
        exit 1
    fi
    HAS_DELIVERABLES=1
else
    echo "[INFO] No .deliverables/ found on $TASK_BRANCH — nothing to copy."
fi

# Phase 1: Checkout master
if ! git checkout "$MAIN_BRANCH"; then
    echo "[ERROR] Failed to checkout $MAIN_BRANCH" >&2
    exit 1
fi

# Phase 1b: Copy deliverables from temp to project-level .deliverables/<notebook>/
MERGE_FAILED=0
if [[ "$HAS_DELIVERABLES" -eq 1 ]]; then
    # D3: Explicit error handling for mkdir/cp on master branch
    if ! mkdir -p "$DELIVERABLES_TARGET" || ! cp -a "$MERGE_TMPDIR/." "$DELIVERABLES_TARGET/"; then
        echo "[ERROR] Failed to write deliverables on $MAIN_BRANCH" >&2
        git checkout "$TASK_BRANCH" 2>/dev/null || true
        exit 1
    fi
    git add "$DELIVERABLES_TARGET/"
    if git diff --cached --quiet 2>/dev/null; then
        echo "[INFO] No deliverables changes to commit."
    else
        git commit -m "task-ai($NOTEBOOK):merge copy deliverables from $TASK_BRANCH" || MERGE_FAILED=1
    fi
fi
rm -rf "$MERGE_TMPDIR"
MERGE_TMPDIR=""

if [[ "$MERGE_FAILED" -ne 0 ]]; then
    echo "[ERROR] Failed to commit deliverables." >&2
    git checkout "$TASK_BRANCH" 2>/dev/null || true
    exit 1
fi

# Deliverables copied — checkout back to task branch
# D1: .status.json lives on task branch, not master
if ! git checkout "$TASK_BRANCH"; then
    echo "[ERROR] Failed to checkout back to $TASK_BRANCH" >&2
    exit 1
fi

# v2: merge is pure file copy — no status changes
# Status transitions (executing → evolving) are handled by auto after check post-exec ACCEPT
echo "Deliverables copied to .deliverables/$NOTEBOOK/ on $MAIN_BRANCH."
