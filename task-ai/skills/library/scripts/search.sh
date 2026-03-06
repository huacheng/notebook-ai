#!/usr/bin/env bash
# Library Search Script
# Usage: search.sh "<query>" [--type <type>] [--limit 10]

set -euo pipefail

QUERY="${1:-}"
if [[ -z "$QUERY" ]]; then
    echo "[ERROR] Search query is required." >&2
    exit 1
fi
LIMIT=10
TYPE_FILTER=""

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)
      if [[ $# -lt 2 ]]; then echo "[ERROR] --type requires a value" >&2; exit 1; fi
      TYPE_FILTER="$2"
      # D2: Validate type filter to prevent awk injection
      if [[ ! "$TYPE_FILTER" =~ ^[a-zA-Z0-9_-]+$ ]]; then
          echo "[ERROR] Invalid type filter: $TYPE_FILTER" >&2; exit 1
      fi
      shift 2 ;;
    --limit)
      if [[ $# -lt 2 ]]; then echo "[ERROR] --limit requires a value" >&2; exit 1; fi
      LIMIT="$2"; [[ "$LIMIT" =~ ^[0-9]+$ ]] || LIMIT=10; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
MASTER_INDEX="$LIB_PATH/.master-index.md"
RELATIONS_JSONL="$LIB_PATH/.relations.jsonl"

# D3: Verify master index exists before searching
if [[ ! -f "$MASTER_INDEX" ]]; then
    echo "[ERROR] Master index not found at $MASTER_INDEX. Run: library maintain --rebuild-index" >&2
    exit 1
fi

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
    MATCHES=$(echo "$MATCHES" | awk -F '|' -v t="$TYPE_FILTER" 'index(tolower($3), tolower(t))' || true)
fi

# D1: Apply limit only if we have matches (avoid empty-string edge case)
if [[ -n "$MATCHES" ]]; then
    MATCHES=$(echo "$MATCHES" | head -n "$LIMIT")
fi

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
