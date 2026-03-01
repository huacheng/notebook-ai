#!/usr/bin/env bash
# Library Search Script
# Usage: search.sh "<query>" [--type <type>] [--limit 10]

set -uo pipefail

QUERY="${1:-}"
LIMIT=10
TYPE_FILTER=""

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)  TYPE_FILTER="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
MASTER_INDEX="$LIB_PATH/.master-index.md"
RELATIONS_JSONL="$LIB_PATH/.relations.jsonl"

# Constants: column index in .master-index.md
# Format: | Topic | Type | Keywords | File Path | Source |
COL_PATH=5

START_TIME=$(date +%s%3N)

echo "--- Layer 1: Keyword Match ---"
# Use -F (Fixed strings) for security to prevent regex injection from user input
# Use -i for case-insensitive matching
MATCHES=$(grep -Fi "$QUERY" "$MASTER_INDEX" || true)

# Apply --type filter on the Type column (column 2) if specified
if [[ -n "$TYPE_FILTER" && -n "$MATCHES" ]]; then
    MATCHES=$(echo "$MATCHES" | awk -F '|' -v t="$TYPE_FILTER" 'tolower($3) ~ tolower(t)' || true)
fi

# Apply limit
MATCHES=$(echo "$MATCHES" | head -n "$LIMIT")

if [[ -z "$MATCHES" ]]; then
    echo "No direct matches found."
else
    echo "$MATCHES"
    
    # Extract paths using robust awk column indexing
    HIT_PATHS=$(echo "$MATCHES" | awk -F '|' -v col="$COL_PATH" '{print $col}' | sed 's/ //g')
    
    if [[ -f "$RELATIONS_JSONL" ]] && [[ -n "$HIT_PATHS" ]]; then
        echo -e "\n--- Layer 1.5: Relational Association ---"
        while read -r path; do
            [[ -z "$path" ]] && continue
            # Exact match for the source field in JSONL
            # Still using -F for safety
            ASSOCIATIONS=$(grep -F "\"s\": \"$path\"" "$RELATIONS_JSONL" | head -n 5 || true)
            if [[ -n "$ASSOCIATIONS" ]]; then
                echo "Associations for $path:"
                echo "$ASSOCIATIONS"
            fi
        done <<< "$HIT_PATHS"
    fi
fi

END_TIME=$(date +%s%3N)
ELAPSED=$((END_TIME - START_TIME))
echo -e "\n[PERF] search took ${ELAPSED}ms"
