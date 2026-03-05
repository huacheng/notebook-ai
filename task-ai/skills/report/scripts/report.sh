#!/usr/bin/env bash
# /task-ai:report implementation
# Usage: report.sh <notebook> [--format full|summary]

set -euo pipefail
# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

NOTEBOOK="${1:-}"
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

FORMAT=""
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --format) FORMAT="${2:-}"; shift 2 2>/dev/null || shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found for $NOTEBOOK." >&2
    exit 1
fi

echo "Generating report for $NOTEBOOK..."
STATE_PY="$TASK_AI_ROOT/core/state.py"
STATUS_JSON="$WORK_DIR/.status.json"

# D3: Check state.py existence before calling
if [[ ! -f "$STATE_PY" ]]; then
    echo "[ERROR] state.py not found: $STATE_PY" >&2
    exit 1
fi

# D3: Concurrency — acquire .lock before proceeding
LOCK_FILE="$WORK_DIR/.lock"
cleanup_lock() { rm -f "$LOCK_FILE"; }
trap cleanup_lock EXIT
if ! (set -o noclobber; echo $$ > "$LOCK_FILE") 2>/dev/null; then
    echo "[ERROR] Another task-ai process holds .lock in $WORK_DIR" >&2
    exit 1
fi

# 1. Gather Metadata (D3: python3 calls with error handling)
TITLE=$(python3 "$STATE_PY" get "$STATUS_JSON" title 2>/dev/null || echo "$NOTEBOOK")
STATUS=$(python3 "$STATE_PY" get "$STATUS_JSON" status 2>/dev/null || echo "unknown")
CREATED=$(python3 "$STATE_PY" get "$STATUS_JSON" created 2>/dev/null || echo "unknown")
COMPLETED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TYPE=$(python3 "$STATE_PY" get "$STATUS_JSON" type 2>/dev/null || echo "")
TYPE=${TYPE:-generic}

# D1: Prerequisites — draft with no plan produces minimal notice
if [[ "$STATUS" == "draft" && ! -f "$WORK_DIR/.plan.md" ]]; then
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
NB_DIR="$(dirname "$WORK_DIR")"
PROJECT_DIR="$(dirname "$NB_DIR")"
DELIVERABLES_DIR="$PROJECT_DIR/.deliverables/$NOTEBOOK"
if ! mkdir -p "$DELIVERABLES_DIR" 2>/dev/null; then
    echo "[ERROR] Failed to create deliverables directory: $DELIVERABLES_DIR" >&2
    exit 1
fi
REPORT_FILE="$DELIVERABLES_DIR/.report.md"

# --- Helper: read file content or fallback (D3: cat with 2>/dev/null) ---
read_file_or() { cat "$1" 2>/dev/null || echo "${2:-N/A}"; }

# --- Helper: collect all files from a directory into markdown subsections ---
# Usage: collect_dir_files <dir> <glob_pattern> [fallback]
collect_dir_files() {
    local dir="$1" pattern="$2" fallback="${3:-N/A}"
    if [[ ! -d "$dir" ]]; then echo "$fallback"; return; fi
    local files
    files=$(find "$dir" -name "$pattern" -print 2>/dev/null | sort)
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

# 2. Objective from .target.md
OBJECTIVE=$(read_file_or "$WORK_DIR/.target.md" "N/A")

# 3. Plan from .plan.md (first 30 lines for summary)
if [[ -f "$WORK_DIR/.plan.md" ]]; then
    PLAN_CONTENT=$(head -n 30 "$WORK_DIR/.plan.md")
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
if [[ -f "$WORK_DIR/.auto-timeline.md" ]]; then
    TIMELINE_SECTION="## Execution Timeline
$(cat "$WORK_DIR/.auto-timeline.md")
"
fi

# 6. Verification from .test/ (all files: .md and .jsonl, sorted)
VERIFICATION="N/A"
if [[ -d "$WORK_DIR/.test" ]]; then
    test_files=$(find "$WORK_DIR/.test" \( -name '*.md' -o -name '*.jsonl' \) -print 2>/dev/null | sort)
    if [[ -n "$test_files" ]]; then
        VERIFICATION=""
        while IFS= read -r f; do
            VERIFICATION+="### $(basename "$f")
$(cat "$f" 2>/dev/null)

"
        done <<< "$test_files"
    fi
fi

# 7. Analysis from .analysis/ (all files, sorted)
ANALYSIS=$(collect_dir_files "$WORK_DIR/.analysis" '*.md' "N/A")

# 8. Issues from .bugfix/ (all files, sorted)
ISSUES=$(collect_dir_files "$WORK_DIR/.bugfix" '*.md' "None")

# 9. Notes from .notes/ (all files, sorted)
NOTES=$(collect_dir_files "$WORK_DIR/.notes" '*.md' "N/A")

# 10. Git changes related to the task (D1: collect for all statuses if identifiable)
CHANGES="N/A"
git_log=$(git log --oneline --all --fixed-strings --grep="task-ai($NOTEBOOK)" 2>/dev/null || true)
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
    obj_line=$(grep -v -e '^#' -e '^$' "$WORK_DIR/.target.md" 2>/dev/null | head -n 1)
    obj_line=${obj_line:-N/A}
    REPORT_CONTENT="# Task Report: $TITLE (Summary)

- **Status**: $STATUS
- **Type**: $TYPE
- **Created**: $CREATED
- **Completed**: $COMPLETED
- **Objective**: $obj_line
- **Key Changes**: $CHANGES
- **Verification**: $(head -n 5 "$WORK_DIR/.test/.summary.md" 2>/dev/null || echo "N/A")
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

# 12. Write report (D3: error handling)
if ! printf '%s' "$REPORT_CONTENT" > "$REPORT_FILE" 2>&1; then
    echo "[WARN] Failed to write report to $REPORT_FILE" >&2
fi

echo "Report written to $REPORT_FILE."

# Note: Experience distillation moved to /task-ai:highlight skill
# This script only generates reports; use highlight for library writes

# 13. Git commit (D1: consistent with SKILL.md)
if ! git add "$REPORT_FILE" 2>&1; then
    echo "[WARN] Failed to stage report file" >&2
elif ! git commit -m "task-ai($NOTEBOOK):report generate completion report" 2>&1; then
    echo "[WARN] Failed to commit report (may be no changes)" >&2
fi

# 13b. Library maintain hook (rebuild index after report commit)
MAINTAIN_SH="$TASK_AI_ROOT/skills/library/scripts/maintain.sh"
if [[ -x "$MAINTAIN_SH" ]]; then
    if ! "$MAINTAIN_SH" --rebuild-index --rebuild-relations 2>&1; then
        echo "[WARN] maintain.sh failed" >&2
    fi
fi

# 14. Write .auto-signal (D1: consistent with SKILL.md, with actual timestamp)
SIGNAL_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if ! printf '{"step":"report","result":"(generated)","next":"(stop)","checkpoint":"","timestamp":"%s"}\n' "$SIGNAL_TS" > "$WORK_DIR/.auto-signal" 2>&1; then
    echo "[WARN] Failed to write .auto-signal" >&2
fi

# 15. Print report to screen
cat "$REPORT_FILE"

echo "Report completed."
