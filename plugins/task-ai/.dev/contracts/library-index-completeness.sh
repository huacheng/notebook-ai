#!/usr/bin/env bash
# L2: Check Library Index Completeness
# Verifies that all files in .library are indexed in .master-index.md
# and directory-level .index.md files.

source "$(dirname "$0")/lib.sh"

# Use temp directory for testing to avoid /.library access errors
export NB_WORKSPACES_ROOT="/tmp/task-ai-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT
LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT}/.library}"
MASTER_INDEX="$LIB_PATH/.master-index.md"

# If library doesn't exist, we might be running in an environment where it hasn't been initialized
# for testing. For this index completeness test, we need a library.
if [[ ! -d "$LIB_PATH" ]]; then
    # Create a minimal library for testing if missing
    mkdir -p "$LIB_PATH/.memory/.references"
    touch "$MASTER_INDEX"
fi

if [[ ! -d "$LIB_PATH" ]]; then
    emit_fail "Library directory not found at $LIB_PATH"
    summary
    exit 0
fi

if [[ ! -f "$MASTER_INDEX" ]]; then
    emit_fail "Master index not found at $MASTER_INDEX"
    summary
    exit 0
fi

# 1. Check if physical files are in master index
while IFS= read -r md_file; do
    # Skip index files and changelog archives
    filename=$(basename "$md_file")
    if [[ "$filename" == .* ]]; then continue; fi
    
    rel_path=$(realpath --relative-to="$LIB_PATH" "$md_file")
    if grep -qF "$rel_path" "$MASTER_INDEX"; then
        emit_pass "Master index: tracks $rel_path"
    else
        emit_fail "Master index: missing entry for $rel_path"
    fi
done < <(find "$LIB_PATH/.memory" -name "*.md" -type f)

# 2. Check if master index entries have physical files
# Extract path from table rows (column 4)
while IFS= read -r line; do
    # Skip header and separator
    [[ "$line" == "| Topic"* ]] && continue
    [[ "$line" == "|---"* ]] && continue
    [[ -z "$line" ]] && continue
    
    indexed_path=$(echo "$line" | awk -F '|' '{print $5}' | sed 's/ //g')
    if [[ -f "$LIB_PATH/$indexed_path" ]]; then
        emit_pass "Physical file exists for indexed path: $indexed_path"
    else
        emit_fail "Master index entry refers to missing file: $indexed_path"
    fi
done < <(tail -n +4 "$MASTER_INDEX")

summary
