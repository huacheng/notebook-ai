#!/usr/bin/env bash
# /task-ai:light implementation
# Usage: light.sh <project> <objective> | --finish | --promote | --status

set -uo pipefail

ARG1="${1:-}"
ARG2="${2:-}"

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../.dev/contracts/lib.sh"

# Helper: Check complexity
check_complexity() {
    local count
    count=$(git diff --name-only master...HEAD | wc -l)
    if [[ $count -gt 3 ]]; then
        echo "[WARNING] Complexity warning: $count files modified. This task may be too complex for 'light' mode. Consider using --promote."
    fi
}

# 1. Finish Mode
if [[ "$ARG1" == "--finish" ]]; then
    if ! find_nb_context; then
        echo "[ERROR] Not in a notebook context." >&2
        exit 1
    fi

    INDEX_JSON="$NB_WORKING/.index.json"
    STATE_PY="$SCRIPT_DIR/../../../core/state.py"
    
    OBJECTIVE=$(python3 "$STATE_PY" get "$INDEX_JSON" title)
    NB_DIR=$(dirname "$NB_WORKING")
    PROJECT_DIR=$(dirname "$NB_DIR")
    PROJECT_NAME=$(basename "$PROJECT_DIR")

    echo "Finishing shadow task: $OBJECTIVE"
    
    git add .
    if ! git diff --cached --quiet; then
        git commit -m "task-ai(light): intermediate work" > /dev/null
    fi

    CURRENT_BRANCH=$(git branch --show-current)
    git checkout master > /dev/null
    git merge --squash "$CURRENT_BRANCH" > /dev/null
    git commit -m "task-ai($PROJECT_NAME):light $OBJECTIVE" > /dev/null
    
    git branch -D "$CURRENT_BRANCH" > /dev/null
    NB_DIR=$(dirname "$NB_WORKING")
    rm -rf "$NB_DIR"
    
    echo "Task merged, shadow branch and transient notebook directory cleaned up."
    exit 0
fi

# 2. Promote Mode
if [[ "$ARG1" == "--promote" ]]; then
    if ! find_nb_context; then
        echo "[ERROR] Not in a light task context." >&2
        exit 1
    fi

    INDEX_JSON="$NB_WORKING/.index.json"
    STATE_PY="$SCRIPT_DIR/../../../core/state.py"
    
    MODE=$(python3 "$STATE_PY" get "$INDEX_JSON" mode)
    if [[ "$MODE" != "light" ]]; then
        echo "[ERROR] This notebook is not in light mode." >&2
        exit 1
    fi

    echo "Promoting light task to standard notebook..."
    python3 "$STATE_PY" transition "$INDEX_JSON" --status planning
    python3 "$STATE_PY" set "$INDEX_JSON" mode "" 
    
    CURRENT_BRANCH=$(git branch --show-current)
    NEW_BRANCH="task/${NB_NOTEBOOK}"
    
    if git branch --list "$NEW_BRANCH" | grep -q "$NB_NOTEBOOK"; then
        git branch -D "$NEW_BRANCH" > /dev/null
    fi
    
    git branch -m "$NEW_BRANCH"
    python3 "$STATE_PY" set "$INDEX_JSON" branch "$NEW_BRANCH"
    
    git add "$INDEX_JSON"
    git commit -m "task-ai($NB_NOTEBOOK):promote upgrade to standard task" > /dev/null

    echo "Promotion successful. Task is now a standard notebook on branch $NEW_BRANCH."
    exit 0
fi

# 3. Status Mode (includes complexity check)
if [[ "$ARG1" == "--status" ]]; then
    if ! find_nb_context; then
        echo "[ERROR] Not in a task context." >&2
        exit 1
    fi
    INDEX_JSON="$NB_WORKING/.index.json"
    STATE_PY="$SCRIPT_DIR/../../../core/state.py"
    TITLE=$(python3 "$STATE_PY" get "$INDEX_JSON" title)
    echo "--- Light Task Status ---"
    echo "Objective: $TITLE"
    check_complexity
    exit 0
fi

# 4. Start Mode
if [[ -n "$ARG1" && -n "$ARG2" ]]; then
    PROJECT_NAME="$ARG1"
    OBJECTIVE="$ARG2"
    
    SLUG=$(echo "$OBJECTIVE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g' | sed -E 's/^-+|-+$//g' | cut -c 1-20)
    TIMESTAMP=$(date +%s)
    NOTEBOOK_NAME="light-${SLUG}-${TIMESTAMP}"
    
    echo "Starting light task notebook: $NOTEBOOK_NAME"
    INIT_SH="$SCRIPT_DIR/../../init/scripts/init.sh"
    "$INIT_SH" "$PROJECT_NAME" "$NOTEBOOK_NAME" --title "$OBJECTIVE" > /dev/null
    
    NB_ROOT="${NB_WORKSPACES_ROOT:-$(pwd)}"
    WORK_DIR="$NB_ROOT/$PROJECT_NAME/$NOTEBOOK_NAME/.working"
    INDEX_JSON="$WORK_DIR/.index.json"
    STATE_PY="$SCRIPT_DIR/../../../core/state.py"
    
    python3 "$STATE_PY" set "$INDEX_JSON" mode "light"
    
    SHADOW_BRANCH="light/${NOTEBOOK_NAME}"
    git checkout -b "$SHADOW_BRANCH" > /dev/null
    
    echo "Light task initialized. Shadow branch: $SHADOW_BRANCH"
    exit 0
fi

echo "[ERROR] Invalid arguments. Usage: light <project> <objective> | --finish | --promote | --status" >&2
exit 1
