#!/usr/bin/env bash
# /task-ai:init implementation
# Usage: init.sh <project_name> <notebook_name> [--title "Title"] [--tags "t1,t2"] [--worktree]

set -euo pipefail

# Load core library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

# Ensure library exists before creating notebook (A pattern)
ensure_library

PROJECT_NAME="${1:-}"
NOTEBOOK_NAME="${2:-}"
TITLE="$NOTEBOOK_NAME"
TAGS="[]"
USE_WORKTREE=0

if [[ -z "$PROJECT_NAME" || -z "$NOTEBOOK_NAME" ]]; then
    echo "[ERROR] Project and Notebook names are required." >&2
    exit 1
fi

# Parse optional arguments
shift 2 || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)
      if [[ $# -lt 2 ]]; then echo "[ERROR] --title requires a value" >&2; exit 1; fi
      TITLE="$2"; shift 2 ;;
    --tags)
      if [[ $# -lt 2 ]]; then echo "[ERROR] --tags requires a value" >&2; exit 1; fi
      # D1: Sanitize tags and guard against empty result
      SANITIZED=$(printf '%s' "$2" | sed 's/[^a-zA-Z0-9_,-]//g')
      if [[ -z "$SANITIZED" ]]; then
        TAGS="[]"
      else
        TAGS=$(printf '%s' "$SANITIZED" | sed 's/,/","/g' | sed 's/.*$/["&"]/')
      fi
      shift 2 ;;
    --worktree) USE_WORKTREE=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

NB_ROOT="${NB_WORKSPACES_ROOT:-$(pwd)}"
TARGET_DIR="$NB_ROOT/$PROJECT_NAME/$NOTEBOOK_NAME"
BRANCH_NAME="task/$NOTEBOOK_NAME"

# 1. Validation
if [[ ! "$PROJECT_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then echo "[ERROR] Invalid project name." >&2; exit 1; fi
if [[ ! "$NOTEBOOK_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then echo "[ERROR] Invalid notebook name." >&2; exit 1; fi

# 2. Collision Checks
if [[ -d "$TARGET_DIR" ]]; then
    echo "[ERROR] Directory already exists: $TARGET_DIR" >&2
    exit 1
fi

if git branch --list "$BRANCH_NAME" | grep -qF "$BRANCH_NAME"; then
    echo "[ERROR] Git branch already exists: $BRANCH_NAME" >&2
    exit 1
fi

# 3. Clean working tree check (SKILL.md Step 6)
# D3: Only block on tracked file modifications; untracked/gitignored files are allowed
DIRTY_TRACKED=$(git status --porcelain 2>/dev/null | grep -v '^??' | head -1 || true)
if [[ -n "$DIRTY_TRACKED" ]]; then
    echo "[ERROR] Uncommitted changes to tracked files detected. Please commit or stash first." >&2
    exit 1
fi

# Cleanup function for rollback on failure
CLEANUP_BRANCH=""
CLEANUP_WORKTREE=""
CLEANUP_DIR=""
cleanup() {
    if [[ -n "$CLEANUP_WORKTREE" && -d "$CLEANUP_WORKTREE" ]]; then
        git worktree remove "$CLEANUP_WORKTREE" 2>/dev/null || true
    fi
    if [[ -n "$CLEANUP_BRANCH" ]]; then
        git checkout - 2>/dev/null || true
        git branch -d "$CLEANUP_BRANCH" 2>/dev/null || true
    fi
    if [[ -n "$CLEANUP_DIR" && -d "$CLEANUP_DIR" ]]; then
        rm -rf "$CLEANUP_DIR"
    fi
}
trap cleanup ERR INT TERM

# 4. Git Operations
git branch "$BRANCH_NAME" || { echo "[ERROR] Failed to create branch $BRANCH_NAME" >&2; exit 1; }
CLEANUP_BRANCH="$BRANCH_NAME"

if [[ $USE_WORKTREE -eq 1 ]]; then
    WORKTREE_PATH="$(pwd)/.worktrees/task-$NOTEBOOK_NAME"
    git worktree add "$WORKTREE_PATH" "$BRANCH_NAME" || { echo "[ERROR] Failed to create worktree" >&2; exit 1; }
    CLEANUP_WORKTREE="$WORKTREE_PATH"
else
    git checkout "$BRANCH_NAME" || { echo "[ERROR] Failed to checkout $BRANCH_NAME" >&2; exit 1; }
fi
WORKING_DIR="$TARGET_DIR/.working"
CLEANUP_DIR="$TARGET_DIR"

# 4b. Ensure root .gitignore has task-ai entries (idempotent, SKILL.md Step 2)
# D3: placed after checkout/worktree so tracked .gitignore edits don't block branch switch
_ROOT_GI="$NB_ROOT/.gitignore"
_GI_ENTRIES=(
  ".worktrees/"
  "**/.working/.auto-signal"
  "**/.working/.auto-signal.tmp"
  "**/.working/.auto-stop"
  "**/.working/.lock"
  "**/.working/.library-state.json"
  ".library/.changelog"
  ".library/.changelog-archive/.lock"
  ".library/.memory/.thinking/raw/"
  ".library/.memory/.thinking/patterns/.lock"
  ".library/.inconsistency.log"
  ".library/.ioc.md"
  "**/.lock"
  "**/.lock.stale.*"
)
_GI_CHANGED=0
if [[ ! -f "$_ROOT_GI" ]]; then
  printf '%s\n' "${_GI_ENTRIES[@]}" > "$_ROOT_GI"
  _GI_CHANGED=1
else
  for _entry in "${_GI_ENTRIES[@]}"; do
    if ! grep -qxF "$_entry" "$_ROOT_GI"; then
      printf '%s\n' "$_entry" >> "$_ROOT_GI"
      _GI_CHANGED=1
    fi
  done
fi

# 5. Project directory creation (SKILL.md Step 3)
PROJECT_DIR="$NB_ROOT/$PROJECT_NAME"
if [[ ! -d "$PROJECT_DIR" ]]; then
    mkdir -p "$PROJECT_DIR"
fi
if [[ ! -f "$PROJECT_DIR/.status.json" ]]; then
    cat > "$PROJECT_DIR/.status.json" <<PROJEOF
{
  "name": "$PROJECT_NAME",
  "created": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
PROJEOF
fi

# 6. Directory Creation
mkdir -p "$WORKING_DIR"

# 7. Metadata Creation (.status.json)
# Sanitize TITLE: strip all control characters and ANSI escape residue, then escape for JSON
TITLE=$(printf '%s' "$TITLE" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | tr -d '[:cntrl:]')
SAFE_TITLE="${TITLE//\\/\\\\}"
SAFE_TITLE="${SAFE_TITLE//\"/\\\"}"
# D3: single timestamp to avoid inconsistency across second boundary
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$WORKING_DIR/.status.json" <<EOF
{
  "title": "$SAFE_TITLE",
  "type": "",
  "status": "draft",
  "phase": "",
  "completed_steps": 0,
  "created": "$NOW",
  "updated": "$NOW",
  "depends_on": [],
  "tags": $TAGS,
  "branch": "$BRANCH_NAME",
  "worktree": "$( [[ $USE_WORKTREE -eq 1 ]] && echo ".worktrees/task-$NOTEBOOK_NAME" || echo "" )",
  "stage": {
    "current": 1,
    "total": 1,
    "completed": []
  }
}
EOF

# 8. Template Creation (.target.md)
cat > "$WORKING_DIR/.target.md" <<EOF
# Task Target: $SAFE_TITLE

## Objective
<!-- Describe the goal of this task -->

## Requirements
<!-- List specific requirements -->

## Constraints
<!-- Any constraints or limitations -->
EOF

# 9. Git Commit
# D1: in worktree mode, git operations must target the worktree directory
if [[ $USE_WORKTREE -eq 1 ]]; then
    GIT_CMD=(git -C "$WORKTREE_PATH")
else
    GIT_CMD=(git)
fi
# D3: git with error handling — stage all created files
GIT_ADD_FILES=("$WORKING_DIR/.status.json" "$WORKING_DIR/.target.md")
[[ -f "$PROJECT_DIR/.status.json" ]] && GIT_ADD_FILES+=("$PROJECT_DIR/.status.json")
[[ "$_GI_CHANGED" -eq 1 && -f "$_ROOT_GI" ]] && GIT_ADD_FILES+=("$_ROOT_GI")
if ! "${GIT_CMD[@]}" add "${GIT_ADD_FILES[@]}" 2>&1; then
    echo "[ERROR] git add failed" >&2
    exit 1
fi
if ! "${GIT_CMD[@]}" commit -m "task-ai($NOTEBOOK_NAME):init initialize notebook" 2>&1; then
    echo "[WARN] git commit failed (may be no changes)" >&2
fi

# Success - disable cleanup trap
trap - ERR INT TERM
CLEANUP_BRANCH=""
CLEANUP_WORKTREE=""
CLEANUP_DIR=""

echo "Initialized $NOTEBOOK_NAME under $PROJECT_NAME."
