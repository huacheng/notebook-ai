#!/usr/bin/env bash
# Library Maintain Script
# Usage: maintain.sh [--mode quick|audit] [--rebuild-index] [--rebuild-relations] [--compact] [--evolve]

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
    --mode)
      MODE="${2:-audit}"
      shift 2
      case "$MODE" in
        quick)
          # Quick mode: process only entries since .last-maintained
          CHANGELOG="$LIB_PATH/.changelog"
          LAST_MAINTAINED="$LIB_PATH/.last-maintained"

          # Get last maintained timestamp (default to 0 if not exists)
          if [[ -f "$LAST_MAINTAINED" ]]; then
              LAST_TS=$(cat "$LAST_MAINTAINED")
          else
              LAST_TS=0
          fi

          # If no changelog, nothing to do
          if [[ ! -f "$CHANGELOG" ]]; then
              echo "[maintain:quick] No .changelog found, nothing to process"
              # Update timestamp anyway
              date +%s%3N > "$LAST_MAINTAINED"
              continue
          fi

          # Extract entries with ts > LAST_TS
          # Changelog format: - [type] file.md | action | ts=<timestamp>
          NEW_FILES=()
          while IFS= read -r line; do
              if [[ "$line" =~ ts=([0-9]+) ]]; then
                  ENTRY_TS="${BASH_REMATCH[1]}"
                  if [[ "$ENTRY_TS" -gt "$LAST_TS" ]]; then
                      # Extract filename from line: - [type] filename.md | ...
                      if [[ "$line" =~ \[.*\]\ ([^|]+)\ \| ]]; then
                          FILENAME="${BASH_REMATCH[1]}"
                          FILENAME="${FILENAME## }"  # trim leading space
                          FILENAME="${FILENAME%% }"  # trim trailing space
                          NEW_FILES+=("$FILENAME")
                      fi
                  fi
              fi
          done < "$CHANGELOG"

          if [[ ${#NEW_FILES[@]} -eq 0 ]]; then
              echo "[maintain:quick] No new entries since last maintain"
          else
              echo "[maintain:quick] Processing ${#NEW_FILES[@]} new file(s)"
              for f in "${NEW_FILES[@]}"; do
                  echo "  - $f"
              done
              # TODO: Add dedup check against existing files here
          fi

          # Update .last-maintained timestamp
          date +%s%3N > "$LAST_MAINTAINED"
          echo "[maintain:quick] Updated .last-maintained"
          ;;
        audit)
          echo "[maintain:audit] Running full library audit..."
          # Full audit mode - run all maintenance tasks
          bash "$0" --rebuild-index --rebuild-relations --compact
          ;;
        *)
          echo "Unknown mode: $MODE" >&2
          exit 1
          ;;
      esac
      continue
      ;;
    --rebuild-index)
      # D3: python3 call with error handling
      if ! python3 "$REBUILD_INDEX_PY" 2>&1; then
          echo "[WARN] rebuild-index.py failed" >&2
      fi
      shift ;;
    --rebuild-relations)
      # D3: python3 call with error handling
      if ! python3 "$REBUILD_RELATIONS_PY" 2>&1; then
          echo "[WARN] rebuild-relations.py failed" >&2
      fi
      shift ;;
    --evolve)
      EVOLVE_SCRIPT="$SCRIPT_DIR/evolve-rules.sh"
      if [[ -f "$EVOLVE_SCRIPT" ]]; then
          # D3: evolve-rules execution with error handling
          if ! bash "$EVOLVE_SCRIPT" --domain "${2:-all}" --mode auto 2>&1; then
              echo "[WARN] evolve-rules.sh failed" >&2
          fi
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
          # D3: mkdir with error handling
          if ! mkdir -p "$ARCHIVE_DIR" 2>&1; then
              echo "[ERROR] Failed to create archive directory" >&2
              exit 1
          fi
          DATE_STR=$(date +%Y-%m)
          ARCHIVE_FILE="$ARCHIVE_DIR/$DATE_STR.md"
          # H-MAINTAIN-1: Append to existing archive instead of overwriting
          if [[ -f "$ARCHIVE_FILE" ]]; then
              # D3: cat append with error handling
              if ! cat "$CHANGELOG" >> "$ARCHIVE_FILE" 2>&1; then
                  echo "[WARN] Failed to append changelog to archive" >&2
              else
                  echo "Changelog appended to existing $ARCHIVE_FILE"
              fi
          else
              # D3: mv with error handling
              if ! mv "$CHANGELOG" "$ARCHIVE_FILE" 2>&1; then
                  echo "[WARN] Failed to move changelog to archive" >&2
              else
                  echo "Changelog compacted to $ARCHIVE_FILE"
              fi
          fi
          touch "$CHANGELOG"
      fi
      shift ;;

    # ─────────────────────────────────────────────────────────────────────────
    # promote-skill: Unified skill promotion command (T1→T2→T3→T4)
    # Usage: maintain.sh --promote-skill <skill-name> [--auto]
    # ─────────────────────────────────────────────────────────────────────────
    --promote-skill)
      SKILL_NAME="${2:-}"
      AUTO_MODE=0
      shift 2 2>/dev/null || shift

      # Check for --auto flag
      if [[ "${1:-}" == "--auto" ]]; then
          AUTO_MODE=1
          shift
      fi

      if [[ -z "$SKILL_NAME" ]]; then
          echo "[ERROR] Usage: maintain.sh --promote-skill <skill-name> [--auto]" >&2
          exit 1
      fi

      CANDIDATES_DIR="$LIB_PATH/.skills/.candidates"
      DRAFTS_DIR="$LIB_PATH/.skills/.drafts"
      ACTIVE_DIR="$LIB_PATH/.skills/.active"
      CHECK_SCRIPT="$SCRIPT_DIR/../../check/scripts/check.sh"

      echo "=== Skill Promotion Pipeline: $SKILL_NAME ==="

      # Find skill location
      SKILL_FILE=""
      CURRENT_TIER=""
      if [[ -f "$CANDIDATES_DIR/$SKILL_NAME/SKILL.md" ]]; then
          SKILL_FILE="$CANDIDATES_DIR/$SKILL_NAME/SKILL.md"
          CURRENT_TIER="T1/T2"
          echo "Found in .candidates/ (T1/T2)"
      elif [[ -f "$DRAFTS_DIR/$SKILL_NAME/SKILL.md" ]]; then
          SKILL_FILE="$DRAFTS_DIR/$SKILL_NAME/SKILL.md"
          CURRENT_TIER="T3"
          echo "Found in .drafts/ (T3)"
      elif [[ -f "$ACTIVE_DIR/$SKILL_NAME/SKILL.md" ]]; then
          SKILL_FILE="$ACTIVE_DIR/$SKILL_NAME/SKILL.md"
          CURRENT_TIER="T4"
          echo "Already at T4 (active)"
          exit 0
      else
          echo "[ERROR] Skill '$SKILL_NAME' not found in .candidates/, .drafts/, or .skills/" >&2
          exit 1
      fi

      # Determine next promotion step
      case "$CURRENT_TIER" in
          "T1/T2")
              echo ""
              echo "--- Step 1: L2 Six-Dimension Review (skill-review) ---"
              if [[ -f "$CHECK_SCRIPT" ]]; then
                  bash "$CHECK_SCRIPT" _ --checkpoint skill-review --target "$SKILL_FILE"
              else
                  echo "[ERROR] check.sh not found" >&2
                  exit 1
              fi

              # Check if skill moved to drafts
              if [[ -f "$DRAFTS_DIR/$SKILL_NAME/SKILL.md" ]]; then
                  echo ""
                  echo "[SUCCESS] Promoted to T3 (.drafts/)"
                  SKILL_FILE="$DRAFTS_DIR/$SKILL_NAME/SKILL.md"
                  CURRENT_TIER="T3"

                  if [[ "$AUTO_MODE" -eq 1 ]]; then
                      echo "--- Continuing to L3 (--auto mode) ---"
                  else
                      echo "Next: maintain.sh --promote-skill $SKILL_NAME (for L3 review)"
                      exit 0
                  fi
              else
                  echo "[INFO] Score < 0.70, skill remains in .candidates/"
                  exit 0
              fi
              ;;
      esac

      # If T3, run L3 deep review
      if [[ "$CURRENT_TIER" == "T3" ]]; then
          echo ""
          echo "--- Step 2: L3 LLM Deep Semantic Review (skill-deep-review) ---"
          if [[ -f "$CHECK_SCRIPT" ]]; then
              bash "$CHECK_SCRIPT" _ --checkpoint skill-deep-review --target "$SKILL_FILE"
          fi

          # Check if skill moved to active
          if [[ -f "$ACTIVE_DIR/$SKILL_NAME/SKILL.md" ]]; then
              echo ""
              echo "[SUCCESS] Promoted to T4 (.skills/.active/$SKILL_NAME/)"
              echo "Skill is now ACTIVE and available for hot-reload"
          else
              echo "[INFO] Score < 0.85, skill remains in .drafts/"
          fi
      fi

      echo ""
      echo "=== Promotion Complete ==="
      ;;

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
# D3: git add with error handling
if ! git add . 2>&1; then
    echo "[WARN] git add failed" >&2
fi

if ! git diff --cached --quiet; then
    # D3: git commit with error handling
    if ! git commit -m "task-ai(library):maintain sync files and indices" 2>&1; then
        echo "[WARN] git commit failed" >&2
    else
        echo "Library files and indices synced and committed."
    fi
fi
