#!/usr/bin/env bash
# library-write.sh — Atomic library write with full 8-step protocol
#
# Usage: library-write.sh <dest_path> [--content <content>] [--content-file <file>] [--notebook <name>]
#
# This script implements the complete write-protocol:
#   1. mkdir -p target directory
#   2. Acquire directory lock
#   3. Write file atomically (.tmp + rename)
#   4. Append to .changelog
#   5. Update .index.md + .master-index.md
#   6. Update .relations.jsonl
#   7. Release lock
#   8. Git commit
#
# The lock is acquired BEFORE writing, ensuring complete concurrency protection.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load environment
LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"

# Parse arguments
DEST_PATH=""
CONTENT=""
CONTENT_FILE=""
NOTEBOOK=""
NO_COMMIT=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --content)
            if [[ $# -lt 2 ]]; then echo "[ERROR] --content requires a value" >&2; exit 1; fi
            CONTENT="$2"; shift 2 ;;
        --content-file)
            if [[ $# -lt 2 ]]; then echo "[ERROR] --content-file requires a value" >&2; exit 1; fi
            CONTENT_FILE="$2"; shift 2 ;;
        --notebook)
            if [[ $# -lt 2 ]]; then echo "[ERROR] --notebook requires a value" >&2; exit 1; fi
            NOTEBOOK="$2"; shift 2 ;;
        --no-commit)
            NO_COMMIT=true; shift ;;
        -*)
            echo "[ERROR] Unknown option: $1" >&2; exit 1 ;;
        *)
            if [[ -z "$DEST_PATH" ]]; then
                DEST_PATH="$1"
            else
                echo "[ERROR] Unexpected argument: $1" >&2; exit 1
            fi
            shift ;;
    esac
done

if [[ -z "$DEST_PATH" ]]; then
    echo "[ERROR] Destination path required" >&2
    echo "Usage: library-write.sh <dest_path> [--content <content>] [--content-file <file>] [--notebook <name>]" >&2
    exit 1
fi

# Resolve full path
if [[ "$DEST_PATH" != /* ]]; then
    FULL_PATH="$LIB_PATH/$DEST_PATH"
else
    FULL_PATH="$DEST_PATH"
fi

# Compute relative path for storage
REL_PATH="${FULL_PATH#$LIB_PATH/}"

# Get content
if [[ -n "$CONTENT_FILE" ]]; then
    if [[ ! -f "$CONTENT_FILE" ]]; then
        echo "[ERROR] Content file not found: $CONTENT_FILE" >&2
        exit 1
    fi
    CONTENT=$(cat "$CONTENT_FILE")
elif [[ -z "$CONTENT" ]]; then
    # Read from stdin with timeout (5 seconds)
    if ! CONTENT=$(timeout 5 cat 2>/dev/null); then
        echo "[ERROR] stdin read timeout or empty input" >&2
        exit 1
    fi
fi

if [[ -z "$CONTENT" ]]; then
    echo "[ERROR] No content provided" >&2
    exit 1
fi

# Determine directory and lock file
DIR_PATH=$(dirname "$FULL_PATH")
LOCK_FILE="$DIR_PATH/.lock"

# Step 1: mkdir -p
mkdir -p "$DIR_PATH"

# Step 2: Acquire lock
acquire_lock() {
    local lock_path="$1"
    local max_attempts=30
    local attempt=0

    while [[ $attempt -lt $max_attempts ]]; do
        if mkdir "$lock_path" 2>/dev/null; then
            # Lock acquired, write metadata
            echo "{\"pid\": $$, \"session\": \"$(hostname)-$$\", \"timestamp\": $(date +%s)}" > "$lock_path/meta.json"
            return 0
        fi

        # Check for stale lock
        if [[ -f "$lock_path/meta.json" ]]; then
            local lock_pid=$(grep -o '"pid":[[:space:]]*[0-9]*' "$lock_path/meta.json" 2>/dev/null | grep -o '[0-9]*' || true)
            if [[ -n "$lock_pid" ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
                echo "[WARN] Stale lock from PID $lock_pid, reclaiming" >&2
                rm -rf "$lock_path"
                continue
            fi
        fi

        ((attempt++))
        sleep 0.1
    done

    echo "[ERROR] Failed to acquire lock after $max_attempts attempts: $lock_path" >&2
    exit 1
}

release_lock() {
    local lock_path="$1"
    rm -rf "$lock_path" 2>/dev/null || true
}

# Cleanup on exit
cleanup() {
    release_lock "$LOCK_FILE"
}
trap cleanup EXIT INT TERM

# Acquire lock
acquire_lock "$LOCK_FILE"
echo "[library-write] Lock acquired: $LOCK_FILE"

# Step 3: Write file atomically
TMP_FILE="$FULL_PATH.tmp.$$"
echo "$CONTENT" > "$TMP_FILE"
mv -f "$TMP_FILE" "$FULL_PATH"
echo "[library-write] File written: $REL_PATH"

# Step 4: Append to .changelog
CHANGELOG_PATH="$LIB_PATH/.changelog"
CHANGELOG_LOCK="$LIB_PATH/.changelog.lock"

# Determine action (add vs update)
ACTION="add"
if git -C "$LIB_PATH" ls-files --error-unmatch "$REL_PATH" &>/dev/null 2>&1; then
    ACTION="update"
fi

# Extract topic from filename or frontmatter
TOPIC=$(basename "$REL_PATH" .md | sed 's/-v[0-9]*$//')

# Changelog entry format: ts | action | category | topic | file | notebook
TIMESTAMP=$(date +%s)
CATEGORY=$(echo "$REL_PATH" | cut -d'/' -f2)  # e.g., .references, .experiences
CHANGELOG_ENTRY="$TIMESTAMP | $ACTION | $CATEGORY | $TOPIC | $REL_PATH | ${NOTEBOOK:-}"

# Acquire changelog lock and append
(
    flock -w 5 200 || { echo "[WARN] Failed to acquire changelog lock" >&2; exit 0; }
    echo "$CHANGELOG_ENTRY" >> "$CHANGELOG_PATH"
) 200>"$CHANGELOG_LOCK"
echo "[library-write] Changelog appended: $ACTION $TOPIC"

# Step 5: Update index
# Find the appropriate .index.md
INDEX_PATH="$DIR_PATH/.index.md"
MASTER_INDEX_PATH="$LIB_PATH/.master-index.md"

# Extract frontmatter for index entry
extract_frontmatter_field() {
    local field="$1"
    echo "$CONTENT" | grep -E "^${field}:" | head -1 | sed "s/^${field}:[[:space:]]*//" | sed 's/^"//;s/"$//'
}

FM_TOPIC=$(extract_frontmatter_field "topic")
FM_TYPE=$(extract_frontmatter_field "type")
FM_KEYWORDS=$(extract_frontmatter_field "keywords")
FM_SOURCE=$(extract_frontmatter_field "source")

[[ -z "$FM_TOPIC" ]] && FM_TOPIC="$TOPIC"

# Append to directory index if not already present
if [[ -f "$INDEX_PATH" ]]; then
    if ! grep -q "$REL_PATH" "$INDEX_PATH" 2>/dev/null; then
        echo "| $FM_TOPIC | $FM_TYPE | $FM_KEYWORDS | $REL_PATH |" >> "$INDEX_PATH"
        echo "[library-write] Index updated: $INDEX_PATH"
    fi
else
    # Create index with header
    cat > "$INDEX_PATH" << 'EOF'
# Index

| Topic | Type | Keywords | Path |
|-------|------|----------|------|
EOF
    echo "| $FM_TOPIC | $FM_TYPE | $FM_KEYWORDS | $REL_PATH |" >> "$INDEX_PATH"
    echo "[library-write] Index created: $INDEX_PATH"
fi

# Append to master index
if [[ -f "$MASTER_INDEX_PATH" ]]; then
    if ! grep -q "$REL_PATH" "$MASTER_INDEX_PATH" 2>/dev/null; then
        echo "| $FM_TOPIC | $FM_TYPE | $FM_KEYWORDS | $REL_PATH | ${FM_SOURCE:-} |" >> "$MASTER_INDEX_PATH"
        echo "[library-write] Master index updated"
    fi
fi

# Step 6: Update relations
RELATIONS_SCRIPT="$SCRIPT_DIR/append-relations.py"
if [[ -f "$RELATIONS_SCRIPT" ]] && command -v python3 &>/dev/null; then
    NOTEBOOK_ARG=""
    [[ -n "$NOTEBOOK" ]] && NOTEBOOK_ARG="--notebook $NOTEBOOK"
    if ! python3 "$RELATIONS_SCRIPT" "$REL_PATH" $NOTEBOOK_ARG 2>/dev/null; then
        echo "[WARN] Relations update failed, continuing" >&2
    fi
elif [[ -f "$RELATIONS_SCRIPT" ]]; then
    echo "[WARN] python3 not available, skipping relations update" >&2
fi

# Step 7: Release lock (done by trap)
echo "[library-write] Lock released"

# Step 8: Git commit (unless --no-commit)
if [[ "$NO_COMMIT" != "true" ]] && [[ -d "$LIB_PATH/.git" ]]; then
    # Sanitize variables for commit message (remove shell metacharacters)
    SAFE_CATEGORY=$(echo "$CATEGORY" | tr -cd 'a-zA-Z0-9._-')
    SAFE_ACTION=$(echo "$ACTION" | tr -cd 'a-zA-Z0-9._-')
    SAFE_TOPIC=$(echo "$TOPIC" | tr -cd 'a-zA-Z0-9._-')
    (
        cd "$LIB_PATH"
        git add "$REL_PATH" ".changelog" "$INDEX_PATH" ".master-index.md" ".relations.jsonl" 2>/dev/null || true
        git commit -m "library($SAFE_CATEGORY): $SAFE_ACTION $SAFE_TOPIC" --allow-empty 2>/dev/null || true
    )
    echo "[library-write] Git committed"
fi

echo "[library-write] Complete: $REL_PATH"
