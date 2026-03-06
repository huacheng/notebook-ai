#!/usr/bin/env bash
# Library Maintain Script
# Usage: maintain.sh [--mode quick|audit] [--rebuild-index] [--rebuild-relations]
#        [--compact] [--check-staleness] [--all] [--evolve] [--promote-skill <name>]
#        [--scheduled [--force]] [--install-cron] [--uninstall-cron]

set -euo pipefail

# Dynamically resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Allow overriding script paths via environment variables
REBUILD_INDEX_PY="${REBUILD_INDEX_PY:-$SCRIPT_DIR/rebuild-index.py}"
REBUILD_RELATIONS_PY="${REBUILD_RELATIONS_PY:-$SCRIPT_DIR/rebuild-relations.py}"

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
export NB_WORKSPACES_LIBRARY="$LIB_PATH"

# ─────────────────────────────────────────────────────────────────────────────
# Shared function: T3→T4 production validation for a single skill
# Args: $1 = skill name, $2 = SKILL.md path
# Returns: 0 if promoted, 1 if not eligible
# ─────────────────────────────────────────────────────────────────────────────
_validate_t3_to_t4() {
    local skill_name="$1"
    local skill_file="$2"
    local changelog="$LIB_PATH/.changelog"

    if [[ ! -f "$changelog" ]]; then
        echo "[INFO] No changelog found, cannot validate usage"
        return 1
    fi

    # Count post-activation referenced entries (exact skill directory match)
    local skill_pattern="| referenced | .*/${skill_name}/SKILL.md"
    local usage_count
    usage_count=$(grep -c "$skill_pattern" "$changelog" 2>/dev/null || echo 0)
    echo "Usage count (referenced): $usage_count"

    if [[ "$usage_count" -lt 3 ]]; then
        echo "[INFO] Not enough usage (need >= 3, have $usage_count), remains T3"
        return 1
    fi

    # Check for REPLAN failures
    local failure_count=0
    local ref_notebooks
    ref_notebooks=$(grep "$skill_pattern" "$changelog" | \
        sed 's/.*notebook:\([a-zA-Z0-9_-]*\).*/\1/' | sort -u)

    local nb
    for nb in $ref_notebooks; do
        if grep -q "replan:true.*notebook:${nb}\(,\|$\)\|invalidated.*notebook:${nb}\(,\|$\)" "$changelog" 2>/dev/null; then
            failure_count=$((failure_count + 1))
            echo "[WARN] Notebook '$nb' had REPLAN after referencing this skill"
        fi
    done

    echo "Failure count: $failure_count"

    if [[ "$failure_count" -gt 0 ]]; then
        echo "[INFO] REPLAN failures detected ($failure_count), remains T3"
        return 1
    fi

    # All checks passed — promote
    sed -i 's/trust_tier: T3/trust_tier: T4/' "$skill_file"
    echo "[PROMOTION] T3→T4: Promoted to production-validated"
    return 0
}

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
              # D2: Validate numeric only to prevent arithmetic injection
              if ! [[ "$LAST_TS" =~ ^[0-9]+$ ]]; then
                  echo "[WARN] Invalid .last-maintained content, resetting to 0" >&2
                  LAST_TS=0
              fi
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
          # Changelog format: <ISO8601Z> | <type> | <subpath> | <tags>
          # Quick mode looks for ts=<epoch_ms> in tags (appended by writers)
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
          # D3: Use resolved script path for recursive invocation (CWD may change)
          bash "$SCRIPT_DIR/maintain.sh" --rebuild-index --rebuild-relations --compact --check-staleness
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
      if ! python3 "$REBUILD_INDEX_PY"; then
          echo "[WARN] rebuild-index.py failed" >&2
      fi
      shift ;;
    --rebuild-relations)
      # D3: python3 call with error handling
      if ! python3 "$REBUILD_RELATIONS_PY"; then
          echo "[WARN] rebuild-relations.py failed" >&2
      fi
      shift ;;
    --evolve)
      EVOLVE_SCRIPT="$SCRIPT_DIR/evolve-rules.sh"
      if [[ -f "$EVOLVE_SCRIPT" ]]; then
          EVOLVE_DOMAIN="${2:-all}"
          # D3: evolve-rules execution with error handling
          if ! bash "$EVOLVE_SCRIPT" --domain "$EVOLVE_DOMAIN" --mode auto; then
              echo "[WARN] evolve-rules.sh failed" >&2
          fi
          # D3: Shift safely — consume domain arg only if it was present
          if [[ $# -ge 2 && "${2:-}" != --* ]]; then
              shift 2
          else
              shift
          fi
      else
          echo "[ERROR] evolve-rules.sh not found" >&2
          exit 1
      fi
      ;;
    --compact)
      CHANGELOG="$LIB_PATH/.changelog"
      if [[ -f "$CHANGELOG" ]] && [[ $(wc -l < "$CHANGELOG") -gt 0 ]]; then
          ARCHIVE_DIR="$LIB_PATH/.changelog-archive"
          # D3: mkdir with error handling
          if ! mkdir -p "$ARCHIVE_DIR"; then
              echo "[ERROR] Failed to create archive directory" >&2
              exit 1
          fi
          # D1: Archive only entries older than 90 days (per SKILL.md spec)
          CUTOFF_DATE=$(date -u -d "90 days ago" +%Y-%m-%dT%H:%M 2>/dev/null || date -u -v-90d +%Y-%m-%dT%H:%M 2>/dev/null || { echo "[WARN] Cannot compute 90-day cutoff; no entries will be archived" >&2; date -u +%Y-%m-%dT%H:%M; })
          DATE_STR=$(date +%Y-%m)
          ARCHIVE_FILE="$ARCHIVE_DIR/$DATE_STR.md"
          # Separate old entries (to archive) from recent entries (to keep)
          AGED_LINES=0
          # D3: Truncate temp files to prevent data mixing from interrupted prior runs
          : > "${CHANGELOG}.recent"
          : > "${CHANGELOG}.aged"
          while IFS= read -r line; do
              # Extract ISO8601 timestamp from line start
              line_ts="${line%% |*}"
              line_ts="${line_ts## }"
              if [[ "$line_ts" < "$CUTOFF_DATE" && "$line_ts" =~ ^[0-9]{4}-[0-9]{2} ]]; then
                  echo "$line" >> "${CHANGELOG}.aged"
                  ((AGED_LINES++)) || true
              else
                  echo "$line" >> "${CHANGELOG}.recent"
              fi
          done < "$CHANGELOG"
          if [[ $AGED_LINES -gt 0 ]]; then
              # D3: Append aged entries to archive, then replace changelog with recent + marker
              if ! cat "${CHANGELOG}.aged" >> "$ARCHIVE_FILE"; then
                  echo "[WARN] Failed to append aged entries to archive" >&2
                  rm -f "${CHANGELOG}.recent" "${CHANGELOG}.aged"
              else
                  # D1: Write compaction marker as first line (per SKILL.md spec)
                  MARKER="# COMPACT $(date -u +%Y-%m-%d): archived $AGED_LINES lines -> .changelog-archive/$DATE_STR.md"
                  { echo "$MARKER"; cat "${CHANGELOG}.recent"; } > "${CHANGELOG}.new"
                  mv "${CHANGELOG}.new" "$CHANGELOG"
                  rm -f "${CHANGELOG}.recent" "${CHANGELOG}.aged"
                  echo "Changelog compacted: $AGED_LINES lines archived to $ARCHIVE_FILE"
              fi
          else
              rm -f "${CHANGELOG}.recent" "${CHANGELOG}.aged"
              echo "[maintain:compact] No entries older than 90 days to archive"
          fi
      else
          echo "[maintain:compact] Changelog is empty, skipping"
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

      # D2: Validate skill name to prevent path traversal
      if [[ ! "$SKILL_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
          echo "[ERROR] Invalid skill name: '$SKILL_NAME'. Use only letters, digits, hyphens, underscores." >&2
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
          CURRENT_TIER="T1"
          echo "Found in .candidates/ (T1)"
      elif [[ -f "$DRAFTS_DIR/$SKILL_NAME/SKILL.md" ]]; then
          SKILL_FILE="$DRAFTS_DIR/$SKILL_NAME/SKILL.md"
          CURRENT_TIER="T2"
          echo "Found in .drafts/ (T2)"
      elif [[ -f "$ACTIVE_DIR/$SKILL_NAME/SKILL.md" ]]; then
          SKILL_FILE="$ACTIVE_DIR/$SKILL_NAME/SKILL.md"
          # Determine if T3 or T4 from frontmatter
          CURRENT_TRUST=$(grep 'trust_tier:' "$SKILL_FILE" 2>/dev/null | head -1 | sed 's/.*trust_tier:\s*//' | tr -d ' ')
          if [[ "$CURRENT_TRUST" == "T4" ]]; then
              CURRENT_TIER="T4"
              echo "Already at T4 (production-validated)"
              exit 0
          else
              CURRENT_TIER="T3"
              echo "Found in .active/ (T3) — checking production validation"
          fi
      else
          echo "[ERROR] Skill '$SKILL_NAME' not found in .skills/.candidates/, .skills/.drafts/, or .skills/.active/" >&2
          exit 1
      fi

      # Determine next promotion step
      case "$CURRENT_TIER" in
          "T1")
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
                  echo "[SUCCESS] Promoted to T2 (.drafts/)"
                  SKILL_FILE="$DRAFTS_DIR/$SKILL_NAME/SKILL.md"
                  CURRENT_TIER="T2"

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

      # If T2, run L3 deep review
      if [[ "$CURRENT_TIER" == "T2" ]]; then
          echo ""
          echo "--- Step 2: L3 LLM Deep Semantic Review (skill-deep-review) ---"
          if [[ -f "$CHECK_SCRIPT" ]]; then
              bash "$CHECK_SCRIPT" _ --checkpoint skill-deep-review --target "$SKILL_FILE"
          fi

          # Check if skill moved to active
          if [[ -f "$ACTIVE_DIR/$SKILL_NAME/SKILL.md" ]]; then
              echo ""
              echo "[SUCCESS] Promoted to T3 (.skills/.active/$SKILL_NAME/)"
              echo "Skill is now ACTIVE and available for hot-reload"
              CURRENT_TIER="T3"
              SKILL_FILE="$ACTIVE_DIR/$SKILL_NAME/SKILL.md"
          else
              echo "[INFO] Score < 0.85, skill remains in .drafts/"
          fi
      fi

      # T3→T4 Production Validation (changelog-driven)
      if [[ "$CURRENT_TIER" == "T3" ]]; then
          echo ""
          echo "--- Production Validation (T3→T4) ---"
          if _validate_t3_to_t4 "$SKILL_NAME" "$ACTIVE_DIR/$SKILL_NAME/SKILL.md"; then
              echo "trust_tier updated to T4 in $ACTIVE_DIR/$SKILL_NAME/SKILL.md"
          fi
      fi

      echo ""
      echo "=== Promotion Complete ==="
      ;;

    --check-staleness)
      # D1: Check staleness as documented in SKILL.md
      AUDIT_PY="${AUDIT_PY:-$SCRIPT_DIR/audit-library.py}"
      if [[ -f "$AUDIT_PY" ]]; then
          echo "[maintain:check-staleness] Running staleness check..."
          python3 "$AUDIT_PY" 2>&1 | grep -E '^\[STALE\]' || echo "[maintain:check-staleness] No stale entries found."
      else
          echo "[ERROR] audit-library.py not found" >&2
          exit 1
      fi
      shift ;;

    --all)
      # D1: Run rebuild-index → rebuild-relations → compact → check-staleness in sequence
      echo "[maintain:all] Running full maintenance pipeline..."
      # Sweep stale locks first
      echo "[maintain:all] Sweeping stale locks..."
      while IFS= read -r lockfile; do
          [[ -z "$lockfile" ]] && continue
          if [[ -f "$lockfile" ]]; then
              lock_pid=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['pid'])" "$lockfile" 2>/dev/null || echo "")
              if [[ -n "$lock_pid" ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
                  echo "[maintain:all] Recovering stale lock: $lockfile (pid $lock_pid dead)"
                  # D2: Use rename-based recovery per write-protocol.md to avoid TOCTOU
                  stale_name="${lockfile}.stale.$$"
                  if mv "$lockfile" "$stale_name" 2>/dev/null; then
                      rm -f "$stale_name"
                  fi
              fi
          fi
      done < <(find "$LIB_PATH" -maxdepth 4 -name ".lock" 2>/dev/null)
      # D3: Use resolved script path for recursive invocation (CWD may change)
      bash "$SCRIPT_DIR/maintain.sh" --rebuild-index --rebuild-relations --compact --check-staleness
      shift ;;

    # ─────────────────────────────────────────────────────────────────────────
    # --scheduled: periodic auto-maintenance (cron-friendly, timestamp-gated)
    # Runs: staleness check, T3→T4 validation, changelog compact check
    # Usage: maintain.sh --scheduled [--force]
    # ─────────────────────────────────────────────────────────────────────────
    --scheduled)
      FORCE_RUN=0
      shift
      if [[ "${1:-}" == "--force" ]]; then
          FORCE_RUN=1
          shift
      fi

      SCHEDULED_TS_FILE="$LIB_PATH/.last-scheduled"
      INTERVAL_SECONDS=86400  # 24 hours

      # Check if maintenance is due
      if [[ "$FORCE_RUN" -eq 0 ]] && [[ -f "$SCHEDULED_TS_FILE" ]]; then
          LAST_RUN=$(cat "$SCHEDULED_TS_FILE" 2>/dev/null || echo "0")
          # D2: validate numeric
          if ! [[ "$LAST_RUN" =~ ^[0-9]+$ ]]; then
              LAST_RUN=0
          fi
          NOW=$(date +%s)
          ELAPSED_SINCE=$((NOW - LAST_RUN))
          if [[ "$ELAPSED_SINCE" -lt "$INTERVAL_SECONDS" ]]; then
              HOURS_AGO=$((ELAPSED_SINCE / 3600))
              echo "[scheduled] Up to date — last run ${HOURS_AGO}h ago (interval: 24h). Skipping."
              break
          fi
      fi

      echo "=== Scheduled Maintenance ==="

      # 1. Staleness check (references)
      echo ""
      echo "--- [1/3] Staleness Check ---"
      REF_DIR="$LIB_PATH/.memory/.references"
      STALE_COUNT=0
      if [[ -d "$REF_DIR" ]]; then
          STALENESS_DAYS=30
          NOW_EPOCH=$(date +%s)
          while IFS= read -r -d '' ref_file; do
              FILE_EPOCH=$(stat -c %Y "$ref_file" 2>/dev/null || echo "$NOW_EPOCH")
              AGE_DAYS=$(( (NOW_EPOCH - FILE_EPOCH) / 86400 ))
              if [[ "$AGE_DAYS" -gt "$STALENESS_DAYS" ]]; then
                  STALE_COUNT=$((STALE_COUNT + 1))
                  echo "  [STALE] $(basename "$ref_file") — ${AGE_DAYS} days old"
              fi
          done < <(find "$REF_DIR" -maxdepth 1 -name "*.md" ! -name ".index.md" ! -name ".summary.md" -print0 2>/dev/null)
      fi
      if [[ "$STALE_COUNT" -eq 0 ]]; then
          echo "  No stale references found"
      else
          echo "  $STALE_COUNT stale reference(s) — consider running: library research --scope gap"
      fi

      # 2. T3→T4 production validation for all active skills
      echo ""
      echo "--- [2/3] T3→T4 Production Validation ---"
      ACTIVE_DIR="$LIB_PATH/.skills/.active"
      T3_PROMOTED=0
      if [[ -d "$ACTIVE_DIR" ]]; then
          for skill_dir in "$ACTIVE_DIR"/*/; do
              [[ -d "$skill_dir" ]] || continue
              SKILL_NAME=$(basename "$skill_dir")
              SKILL_FILE="$skill_dir/SKILL.md"
              [[ -f "$SKILL_FILE" ]] || continue

              CURRENT_TRUST=$(grep 'trust_tier:' "$SKILL_FILE" 2>/dev/null | head -1 | sed 's/.*trust_tier:\s*//' | tr -d ' ')
              [[ "$CURRENT_TRUST" == "T3" ]] || continue

              if _validate_t3_to_t4 "$SKILL_NAME" "$SKILL_FILE"; then
                  T3_PROMOTED=$((T3_PROMOTED + 1))
              fi
          done
      fi
      if [[ "$T3_PROMOTED" -eq 0 ]]; then
          echo "  No T3 skills eligible for T4 promotion"
      fi

      # 3. Changelog size check
      echo ""
      echo "--- [3/3] Changelog Size Check ---"
      CHANGELOG="$LIB_PATH/.changelog"
      if [[ -f "$CHANGELOG" ]]; then
          LINE_COUNT=$(wc -l < "$CHANGELOG")
          echo "  Changelog: $LINE_COUNT lines"
          if [[ "$LINE_COUNT" -gt 2000 ]]; then
              echo "  [WARN] Exceeds 2000-line threshold — run: library maintain --compact"
          else
              echo "  Within threshold"
          fi
      else
          echo "  No changelog found"
      fi

      # Update timestamp
      date +%s > "$SCHEDULED_TS_FILE"

      echo ""
      echo "=== Scheduled Maintenance Complete ==="
      break
      ;;

    # --install-cron: add maintain.sh --scheduled to user's crontab
    --install-cron)
      CMD="--install-cron"
      CRON_TAG="# task-ai:scheduled"
      # Use version-independent path: dynamically resolve latest plugin version at cron runtime
      PLUGIN_BASE="${HOME}/.claude/plugins/cache/moonview/task-ai"
      CRON_CMD="0 3 * * * NB_WORKSPACES_ROOT=\"$NB_WORKSPACES_ROOT\" NB_WORKSPACES_LIBRARY=\"$LIB_PATH\" bash -c 'MDIR=\$(ls -d \"$PLUGIN_BASE\"/*/skills/library/scripts/maintain.sh 2>/dev/null | sort -V | tail -1) && [ -n \"\$MDIR\" ] && bash \"\$MDIR\" --scheduled' $CRON_TAG"

      # Check if already installed (idempotent)
      EXISTING=$(crontab -l 2>/dev/null || true)
      if echo "$EXISTING" | grep -q "task-ai:scheduled"; then
          echo "[INFO] Cron entry already installed, skipping"
      else
          # Append new entry, preserving existing crontab (filter empty lines from empty crontab)
          if [[ -n "$EXISTING" ]]; then
              (echo "$EXISTING"; echo "$CRON_CMD") | crontab -
          else
              echo "$CRON_CMD" | crontab -
          fi
          echo "[OK] Installed cron entry for maintain.sh --scheduled"
      fi
      break
      ;;

    # --uninstall-cron: remove maintain.sh --scheduled from user's crontab
    --uninstall-cron)
      CMD="--uninstall-cron"
      EXISTING=$(crontab -l 2>/dev/null || true)
      if echo "$EXISTING" | grep -q "task-ai:scheduled"; then
          echo "$EXISTING" | grep -v "task-ai:scheduled" | crontab -
          echo "[OK] Removed cron entry for maintain.sh --scheduled"
      else
          echo "[INFO] No task-ai:scheduled entry found, nothing to remove"
      fi
      break
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
# D3: git add with error handling (only if .git exists)
if [[ -d "$LIB_PATH/.git" ]]; then
    if ! git add .; then
        echo "[WARN] git add failed" >&2
    fi

    if ! git diff --cached --quiet; then
        if ! git commit -m "task-ai(library):maintain sync files and indices"; then
            echo "[WARN] git commit failed" >&2
        else
            echo "Library files and indices synced and committed."
        fi
    fi
fi
