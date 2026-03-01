#!/usr/bin/env bash
# /task-ai:check implementation
# Usage: check.sh <notebook> [--checkpoint post-plan|mid-exec|post-exec]

set -uo pipefail
trap 'rm -f "${LOCK_FILE:-}" "${TMP_FILE:-}"' EXIT INT TERM
# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"


NOTEBOOK="${1:-}"
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

CHECKPOINT=""
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --checkpoint) CHECKPOINT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
INDEX_JSON="$WORK_DIR/.index.json"

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

ANALYSIS_DIR="$WORK_DIR/../.analysis"
mkdir -p "$ANALYSIS_DIR"

STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"

# 1. Decision Logic (Simulated for plumbing)
# In real AI agent run, this would be a reasoned verdict.
VERDICT="PASS"
[[ "$CHECKPOINT" == "post-exec" ]] && VERDICT="ACCEPT"

echo "Checking $NOTEBOOK at $CHECKPOINT... Verdict: $VERDICT"

# 2. State Transitions
case "$VERDICT" in
  PASS)
    python3 "$STATE_PY" transition "$INDEX_JSON" --status review
    ;;
  ACCEPT)
    # ACCEPT keeps 'executing' status but signals 'merge'
    ;;
  REPLAN)
    python3 "$STATE_PY" transition "$INDEX_JSON" --status re-planning --phase needs-plan
    ;;
  BLOCKED)
    python3 "$STATE_PY" transition "$INDEX_JSON" --status blocked
    ;;
esac

# 3. Output Analysis File
DATE=$(date +%Y-%m-%d)
ANALYSIS_FILE="$ANALYSIS_DIR/$DATE-$CHECKPOINT-${VERDICT,,}.md"
cat > "$ANALYSIS_FILE" <<EOF
# Evaluation: $CHECKPOINT · $DATE
- Verdict: $VERDICT
- Rationale: Simulated plumbing pass.
EOF

echo "Check completed. Analysis written to $ANALYSIS_FILE."
