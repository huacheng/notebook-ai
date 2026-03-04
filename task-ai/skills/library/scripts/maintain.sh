#!/usr/bin/env bash
# Library Maintain Script
# Usage: maintain.sh [--rebuild-index] [--rebuild-relations] [--compact]

set -euo pipefail

# Dynamically resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Allow overriding script paths via environment variables
REBUILD_INDEX_PY="${REBUILD_INDEX_PY:-$SCRIPT_DIR/rebuild-index.py}"
REBUILD_RELATIONS_PY="${REBUILD_RELATIONS_PY:-$SCRIPT_DIR/rebuild-relations.py}"

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
export NB_WORKSPACES_LIBRARY="$LIB_PATH"

while [[ $# -gt 0 ]]; do
  START_TIME=$(date +%s%3N)
  CMD="$1"
  case "$1" in
    --rebuild-index)
      python3 "$REBUILD_INDEX_PY"
      shift ;;
    --rebuild-relations)
      python3 "$REBUILD_RELATIONS_PY"
      shift ;;
    --evolve)
      EVOLVE_SCRIPT="$SCRIPT_DIR/evolve-rules.sh"
      if [[ -f "$EVOLVE_SCRIPT" ]]; then
          bash "$EVOLVE_SCRIPT" --domain "${2:-all}" --mode auto
          shift 2 2>/dev/null || shift
      else
          echo "[ERROR] evolve-rules.sh not found" >&2
          exit 1
      fi
      ;;
    --compact)
      CHANGELOG="$LIB_PATH/.changelog"
      if [[ -f "$CHANGELOG" ]] && [[ $(wc -l < "$CHANGELOG") -gt 2000 ]]; then
          ARCHIVE_DIR="$LIB_PATH/.changelog-archive"
          mkdir -p "$ARCHIVE_DIR"
          DATE_STR=$(date +%Y-%m)
          ARCHIVE_FILE="$ARCHIVE_DIR/$DATE_STR.md"
          # H-MAINTAIN-1: Append to existing archive instead of overwriting
          if [[ -f "$ARCHIVE_FILE" ]]; then
              cat "$CHANGELOG" >> "$ARCHIVE_FILE"
              echo "Changelog appended to existing $ARCHIVE_FILE"
          else
              mv "$CHANGELOG" "$ARCHIVE_FILE"
              echo "Changelog compacted to $ARCHIVE_FILE"
          fi
          touch "$CHANGELOG"
      fi
      shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  END_TIME=$(date +%s%3N)
  ELAPSED=$((END_TIME - START_TIME))
  echo "[PERF] $CMD took ${ELAPSED}ms"
done

# Git commit logic: sync all tracked files in library
cd "$LIB_PATH" || { echo "[ERROR] Cannot access library at $LIB_PATH" >&2; exit 1; }

# Using git add . with a proper .gitignore is the most robust strategy
# Ensures all .md and index files are tracked
git add . 

if ! git diff --cached --quiet; then
    git commit -m "task-ai(library):maintain sync files and indices"
    echo "Library files and indices synced and committed."
fi
