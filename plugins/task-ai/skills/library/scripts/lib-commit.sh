#!/usr/bin/env bash
# Library Commit Helper
# Usage: lib-commit.sh <notebook> <type> <description> <file1> [file2...]

set -euo pipefail

if [[ $# -lt 4 ]]; then
    echo "Usage: $0 <notebook> <type> <description> <file...>"
    exit 1
fi

NOTEBOOK="$1"; shift
TYPE="$1"; shift
DESC="$1"; shift
FILES=("$@")

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"

if [[ ! -d "$LIB_PATH/.git" ]]; then
    echo "[ERROR] Library repository not found at $LIB_PATH" >&2
    exit 1
fi

cd "$LIB_PATH" || { echo "[ERROR] Cannot access library at $LIB_PATH" >&2; exit 1; }

# Stage only specified files
for f in "${FILES[@]}"; do
    if [[ -f "$f" ]]; then
        git add "$f"
    else
        echo "[WARN] File not found: $f" >&2
    fi
done

# Commit if there are staged changes
if ! git diff --cached --quiet; then
    git commit -m "task-ai($NOTEBOOK):$TYPE $DESC"
    echo "Library changes committed."
else
    echo "No changes to commit in Library."
fi
