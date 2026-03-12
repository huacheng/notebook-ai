#!/usr/bin/env bash
# /task-ai:report implementation
# Usage: report.sh <notebook> [--format full|summary]

set -euo pipefail
# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

NOTEBOOK="${1:-}"
resolve_nb_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

FORMAT=""
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --format)
      if [[ -z "${2:-}" ]]; then
        echo "[ERROR] --format requires a value (full|summary)" >&2; exit 1
      fi
      FORMAT="$2"; shift 2 ;;
    *) echo "[ERROR] Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$TASKAI_WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found for $NOTEBOOK." >&2
    exit 1
fi

echo "Generating report for $NOTEBOOK..."
STATE_PY="$TASK_AI_ROOT/core/state.py"
STATUS_JSON="$TASKAI_WORK_DIR/.status.json"

# D3: Check state.py existence before calling
if [[ ! -f "$STATE_PY" ]]; then
    echo "[ERROR] state.py not found: $STATE_PY" >&2
    exit 1
fi

# D3: Concurrency — acquire .lock before proceeding (with stale lock recovery)
LOCK_FILE="$TASKAI_WORK_DIR/.lock"
_LOCK_ACQUIRED=false
cleanup_lock() { if $_LOCK_ACQUIRED; then rm -f "$LOCK_FILE"; fi; }
trap cleanup_lock EXIT INT TERM
if ! (set -o noclobber; echo $$ > "$LOCK_FILE") 2>/dev/null; then
    # D3: Stale lock recovery — check if holding PID is still alive
    existing_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
    if [[ -n "$existing_pid" ]] && ! kill -0 "$existing_pid" 2>/dev/null; then
        echo "[WARN] Removing stale .lock (PID $existing_pid is dead)" >&2
        rm -f "$LOCK_FILE"
        if ! (set -o noclobber; echo $$ > "$LOCK_FILE") 2>/dev/null; then
            echo "[ERROR] Another task-ai process holds .lock in $TASKAI_WORK_DIR" >&2
            exit 1
        fi
        _LOCK_ACQUIRED=true
    else
        echo "[ERROR] Another task-ai process holds .lock in $TASKAI_WORK_DIR" >&2
        exit 1
    fi
else
    _LOCK_ACQUIRED=true
fi

# 1. Gather Metadata (D3: python3 calls with error handling)
TITLE=$(python3 "$STATE_PY" get "$STATUS_JSON" title 2>/dev/null || echo "$NOTEBOOK")
STATUS=$(python3 "$STATE_PY" get "$STATUS_JSON" status 2>/dev/null || echo "unknown")
CREATED=$(python3 "$STATE_PY" get "$STATUS_JSON" created 2>/dev/null || echo "unknown")
# D1: Use actual completion timestamp from status.json if available, else fall back to now
COMPLETED=$(python3 "$STATE_PY" get "$STATUS_JSON" completed 2>/dev/null || true)
if [[ -z "$COMPLETED" || "$COMPLETED" == "None" ]]; then
    COMPLETED=$(python3 "$STATE_PY" get "$STATUS_JSON" updated 2>/dev/null || true)
fi
if [[ -z "$COMPLETED" || "$COMPLETED" == "None" ]]; then
    COMPLETED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
fi
TYPE=$(python3 "$STATE_PY" get "$STATUS_JSON" type 2>/dev/null || echo "")
TYPE=${TYPE:-generic}

# D1: Prerequisites — draft with no plan produces minimal notice
if [[ "$STATUS" == "draft" && ! -f "$TASKAI_WORK_DIR/.plan.md" ]]; then
    echo "No meaningful content to report — task is still in draft with no plan."
    # D3: release lock via trap
    exit 0
fi

# D2: Validate FORMAT parameter
if [[ -n "$FORMAT" && "$FORMAT" != "full" && "$FORMAT" != "summary" ]]; then
    echo "[WARN] Unknown format '$FORMAT', defaulting to 'full'" >&2
    FORMAT="full"
fi
FORMAT=${FORMAT:-full}

# D1: Resolve deliverables directory (report goes to project deliverables, not .working/)
if [[ -n "${NB_PROJECT_DELIVERABLES:-}" ]]; then
    DELIVERABLES_DIR="$NB_PROJECT_DELIVERABLES/$NOTEBOOK"
else
    NB_DIR="$(dirname "$TASKAI_WORK_DIR")"
    PROJECT_DIR="$(dirname "$NB_DIR")"
    DELIVERABLES_DIR="$PROJECT_DIR/.deliverables/$NOTEBOOK"
fi
if ! mkdir -p "$DELIVERABLES_DIR" 2>/dev/null; then
    echo "[ERROR] Failed to create deliverables directory: $DELIVERABLES_DIR" >&2
    exit 1
fi
REPORT_FILE="$DELIVERABLES_DIR/.report.md"

# --- Helper: read file content or fallback (D3: cat with error suppression, returns fallback on failure) ---
read_file_or() { cat "$1" 2>/dev/null || echo "${2:-N/A}"; }

# --- Helper: collect all files from a directory into markdown subsections ---
# Usage: collect_dir_files <dir> <glob_pattern> [fallback]
collect_dir_files() {
    local dir="$1" pattern="$2" fallback="${3:-N/A}"
    if [[ ! -d "$dir" ]]; then echo "$fallback"; return; fi
    local files
    files=$(find "$dir" -maxdepth 1 -name "$pattern" -print 2>/dev/null | sort)
    if [[ -z "$files" ]]; then echo "$fallback"; return; fi
    local result=""
    while IFS= read -r f; do
        result+="### $(basename "$f")
$(cat "$f" 2>/dev/null)

"
    done <<< "$files"
    echo "$result"
}

# --- Collect report sections ---

# 1b. Summary overview from .summary.md (D1: SKILL.md step 4)
SUMMARY_OVERVIEW=""
if [[ -f "$TASKAI_WORK_DIR/.summary.md" ]]; then
    SUMMARY_OVERVIEW=$(cat "$TASKAI_WORK_DIR/.summary.md" 2>/dev/null || true)
fi

# 2. Objective from .target.md
OBJECTIVE=$(read_file_or "$TASKAI_WORK_DIR/.target.md" "N/A")

# 3. Plan from .plan.md
if [[ -f "$TASKAI_WORK_DIR/.plan.md" ]]; then
    PLAN_CONTENT=$(cat "$TASKAI_WORK_DIR/.plan.md" 2>/dev/null || echo "N/A")
else
    PLAN_CONTENT="N/A"
fi

# 4. Duration calculation (D1: SKILL.md Full Format includes Duration)
DURATION="N/A"
if [[ "$CREATED" != "unknown" ]]; then
    created_epoch=$(date -d "$CREATED" +%s 2>/dev/null || echo "")
    completed_epoch=$(date -d "$COMPLETED" +%s 2>/dev/null || echo "")
    if [[ -n "$created_epoch" && -n "$completed_epoch" ]]; then
        diff_secs=$(( completed_epoch - created_epoch ))
        if (( diff_secs < 0 )); then diff_secs=0; fi
        if (( diff_secs >= 86400 )); then
            DURATION="$(( diff_secs / 86400 ))d $(( (diff_secs % 86400) / 3600 ))h"
        elif (( diff_secs >= 3600 )); then
            DURATION="$(( diff_secs / 3600 ))h $(( (diff_secs % 3600) / 60 ))m"
        else
            DURATION="$(( diff_secs / 60 ))m"
        fi
    fi
fi

# 5. Execution Timeline from .auto-timeline.md (verbatim if exists)
TIMELINE_SECTION=""
if [[ -f "$TASKAI_WORK_DIR/.auto-timeline.md" ]]; then
    TIMELINE_SECTION="## Execution Timeline
$(cat "$TASKAI_WORK_DIR/.auto-timeline.md" 2>/dev/null || echo "_Failed to read timeline._")
"
fi

# 6. Verification from .test/ (all .md files, sorted; then .jsonl files, sorted)
VERIFICATION_MD=$(collect_dir_files "$TASKAI_WORK_DIR/.test" '*.md' "")
VERIFICATION_JSONL=$(collect_dir_files "$TASKAI_WORK_DIR/.test" '*.jsonl' "")
VERIFICATION="${VERIFICATION_MD}${VERIFICATION_JSONL}"
VERIFICATION=${VERIFICATION:-N/A}

# 7. Analysis from .analysis/ (all files, sorted)
ANALYSIS=$(collect_dir_files "$TASKAI_WORK_DIR/.analysis" '*.md' "N/A")

# 8. Issues from .bugfix/ (all files, sorted)
ISSUES=$(collect_dir_files "$TASKAI_WORK_DIR/.bugfix" '*.md' "None")

# 9. Notes from .notes/ (all files, sorted)
NOTES=$(collect_dir_files "$TASKAI_WORK_DIR/.notes" '*.md' "N/A")

# 10. Git changes related to the task (D1: collect for all statuses if identifiable)
CHANGES="N/A"
git_log=$(git log --oneline --all --max-count=200 --fixed-strings --grep="task-ai($NOTEBOOK)" 2>/dev/null || true)
if [[ -n "$git_log" ]]; then
    CHANGES="$git_log"
fi

# 10b. Dependencies from .status.json (D1: SKILL.md Full Format includes Dependencies)
DEPENDENCIES="N/A"
deps_raw=$(python3 "$STATE_PY" get "$STATUS_JSON" depends_on 2>/dev/null || true)
if [[ -n "$deps_raw" && "$deps_raw" != "None" && "$deps_raw" != "null" && "$deps_raw" != "[]" ]]; then
    DEPENDENCIES="$deps_raw"
fi

# 11. Compose report in requested format
if [[ "$FORMAT" == "summary" ]]; then
    # Summary format: status, objective (1 line), key changes, verification result
    obj_line=$(grep -v -e '^#' -e '^$' "$TASKAI_WORK_DIR/.target.md" 2>/dev/null | head -n 1 || true)
    obj_line=${obj_line:-N/A}
    # D6: Format multi-line changes as code block for summary readability
    if [[ "$CHANGES" == "N/A" ]]; then
        changes_fmt="N/A"
    else
        changes_fmt=$(printf '\n```\n%s\n```' "$CHANGES")
    fi
    REPORT_CONTENT="# Task Report: $TITLE (Summary)

- **Status**: $STATUS
- **Type**: $TYPE
- **Created**: $CREATED
- **Completed**: $COMPLETED
- **Objective**: $obj_line
- **Key Changes**: $changes_fmt
- **Verification**: $(head -n 5 "$TASKAI_WORK_DIR/.test/.summary.md" 2>/dev/null || echo "N/A")
"
else
    # Full format: all sections per SKILL.md
    REPORT_CONTENT="# Task Report: $TITLE

## Summary
- **Status**: $STATUS
- **Created**: $CREATED
- **Completed**: $COMPLETED
- **Duration**: $DURATION
- **Type**: $TYPE
$(if [[ -n "$SUMMARY_OVERVIEW" ]]; then printf '\n## Overview\n%s\n' "$SUMMARY_OVERVIEW"; fi)

${TIMELINE_SECTION}## Objective
$OBJECTIVE

## Plan
$PLAN_CONTENT

## Changes Made
$CHANGES

## Verification
$VERIFICATION

## Analysis
$ANALYSIS

## Issues Encountered
$ISSUES

## Dependencies
$DEPENDENCIES

## Lessons Learned
$NOTES
"
fi

# 12. Write report (D3: atomic write via temp file)
REPORT_TMP="${REPORT_FILE}.tmp.$$"
if printf '%s' "$REPORT_CONTENT" > "$REPORT_TMP" 2>/dev/null && mv "$REPORT_TMP" "$REPORT_FILE" 2>/dev/null; then
    :
else
    rm -f "$REPORT_TMP"
    echo "[WARN] Failed to write report to $REPORT_FILE" >&2
fi

if [[ -f "$REPORT_FILE" ]]; then
    echo "Report written to $REPORT_FILE."
fi

# Note: Experience distillation moved to /task-ai:highlight skill
# This script only generates reports; use highlight for library writes

# 13. Git commit (D1: consistent with SKILL.md)
if ! git add "$REPORT_FILE" 2>/dev/null; then
    echo "[WARN] Failed to stage report file" >&2
elif ! git commit -m "task-ai($NOTEBOOK):report generate completion report" 2>/dev/null; then
    echo "[WARN] Failed to commit report (may be no changes)" >&2
fi

# 13b. Library maintain hook (rebuild index after report commit)
MAINTAIN_SH="$TASK_AI_ROOT/skills/library/scripts/maintain.sh"
if [[ -x "$MAINTAIN_SH" ]]; then
    if ! "$MAINTAIN_SH" --rebuild-index --rebuild-relations 2>/dev/null; then
        echo "[WARN] maintain.sh failed" >&2
    fi
fi

# 14. Print report to screen
if [[ -f "$REPORT_FILE" ]]; then
    cat "$REPORT_FILE"
else
    echo "[WARN] Report file not found, printing from memory" >&2
    printf '%s' "$REPORT_CONTENT"
fi

echo "Report completed."
