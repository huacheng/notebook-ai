#!/usr/bin/env bash
# /task-ai:init implementation
# Usage: init.sh <project_name> <notebook_name> [--title "Title"] [--tags "t1,t2"] [--worktree]

set -uo pipefail

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
    --title) TITLE="$2"; shift 2 ;;
    --tags)  TAGS=$(printf '%s' "$2" | sed 's/[^a-zA-Z0-9_,-]//g' | sed 's/,/","/g' | sed 's/.*$/["&"]/'); shift 2 ;;
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

# 3. Git Operations
git branch "$BRANCH_NAME" || { echo "[ERROR] Failed to create branch $BRANCH_NAME" >&2; exit 1; }
if [[ $USE_WORKTREE -eq 1 ]]; then
    WORKTREE_PATH=".worktrees/task-$NOTEBOOK_NAME"
    git worktree add "$WORKTREE_PATH" "$BRANCH_NAME" || { echo "[ERROR] Failed to create worktree" >&2; git branch -d "$BRANCH_NAME"; exit 1; }
    WORKING_DIR="$WORKTREE_PATH/.working"
else
    git checkout "$BRANCH_NAME" || { echo "[ERROR] Failed to checkout $BRANCH_NAME" >&2; git branch -d "$BRANCH_NAME"; exit 1; }
    WORKING_DIR="$TARGET_DIR/.working"
fi

# 4. Directory Creation
mkdir -p "$WORKING_DIR"

# 5. Metadata Creation (.index.json)
# Sanitize TITLE: strip all control characters and ANSI escape residue, then escape for JSON
TITLE=$(printf '%s' "$TITLE" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | tr -d '[:cntrl:]')
SAFE_TITLE="${TITLE//\\/\\\\}"
SAFE_TITLE="${SAFE_TITLE//\"/\\\"}"
cat > "$WORKING_DIR/.index.json" <<EOF
{
  "title": "$SAFE_TITLE",
  "type": "",
  "status": "draft",
  "phase": "",
  "completed_steps": 0,
  "created": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "updated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "depends_on": [],
  "tags": $TAGS,
  "branch": "$BRANCH_NAME",
  "worktree": "$( [[ $USE_WORKTREE -eq 1 ]] && echo "$WORKTREE_PATH" || echo "" )",
  "stage": {
    "current": 1,
    "total": 1,
    "completed": []
  }
}
EOF

# 6. Template Creation (.target.md)
cat > "$WORKING_DIR/.target.md" <<EOF
# Task Target: $TITLE

## Objective
<!-- Describe the goal of this task -->

## Requirements
<!-- List specific requirements -->

## Constraints
<!-- Any constraints or limitations -->
EOF

# 7. Git Commit
git add "$WORKING_DIR/.index.json" "$WORKING_DIR/.target.md"
git commit -m "task-ai($NOTEBOOK_NAME):init initialize notebook"

echo "Initialized $NOTEBOOK_NAME under $PROJECT_NAME."
