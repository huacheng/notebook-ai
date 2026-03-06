#!/usr/bin/env bash
# Library Commit Helper
# Usage: lib-commit.sh <notebook> <type> <description> <file1> [file2...]
#        lib-commit.sh --system <type> <description> <file1> [file2...]

set -euo pipefail

if [[ $# -lt 3 ]]; then
    echo "Usage: $0 <notebook> <type> <description> <file...>"
    echo "       $0 --system <type> <description> <file...>"
    exit 1
fi

# Check for system-level commit (no notebook)
if [[ "$1" == "--system" ]]; then
    shift
    NOTEBOOK=""
    COMMIT_PREFIX="task-ai(library)"
else
    NOTEBOOK="$1"; shift
    # D2: Validate notebook name to prevent commit message injection
    if [[ ! "$NOTEBOOK" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        echo "[ERROR] Invalid notebook name: $NOTEBOOK" >&2
        exit 1
    fi
    COMMIT_PREFIX="task-ai($NOTEBOOK)"
fi

TYPE="$1"; shift
# D2: Sanitize type and description for commit message safety
if [[ ! "$TYPE" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "[ERROR] Invalid commit type: $TYPE" >&2
    exit 1
fi
DESC="$1"; shift
# D2: Sanitize description — strip control chars and limit length to prevent commit message abuse
DESC=$(printf '%s' "$DESC" | tr -d '\n\r' | cut -c1-200)
FILES=("$@")

# D3: Validate at least one file was specified
if [[ ${#FILES[@]} -eq 0 ]]; then
    echo "[ERROR] No files specified to commit" >&2
    exit 1
fi

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
    git commit -m "$COMMIT_PREFIX:$TYPE $DESC"
    echo "Library changes committed."
else
    echo "No changes to commit in Library."
fi
