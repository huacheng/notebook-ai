#!/usr/bin/env bash
# Library Search Script (Graph-Enhanced)
# Delegates to search.py for scored graph search with:
#   - Keyword matching (base score)
#   - used-by count weighting
#   - Freshness bonus
#   - Multi-hop graph traversal recommendations
#
# Usage: search.sh "<query>" [--type <type>] [--limit 10] [--no-recommend]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEARCH_PY="${SEARCH_PY:-$SCRIPT_DIR/search.py}"

# Validate search.py exists
if [[ ! -f "$SEARCH_PY" ]]; then
    echo "[ERROR] search.py not found at $SEARCH_PY" >&2
    exit 1
fi

# Pass all arguments to Python search engine
exec python3 "$SEARCH_PY" "$@"
