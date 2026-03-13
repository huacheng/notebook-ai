#!/usr/bin/env bash
# task-ai framework contract validator
# Usage: validate.sh [--level 1|2|3|all] [--json] [--regression <file>] [--snapshot <file>] [--self-check] [--check-phase <N>]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACTS="$SCRIPT_DIR/contracts"

L1_SCRIPTS=(
  step-numbering.sh
  sub-step-numbering.sh
  script-reachability.sh
  deleted-files.sh
  find-result-validation.sh
  dedup-paragraphs.sh
  test-hygiene.sh
  shared-workdir.sh
  variable-defaults.sh
  publish-sync.sh
  cross-refs.sh
  signal-whitelist.sh
  naming-conventions.sh
  state-matrix.py
  frontmatter-validation.sh
  git-commit-conventions.sh
  stage-defaults.py
  stage-docs-security.py
  stage-done-skills.py
  stage-expected-completeness.py
  stage-matrix-consistency.py
  stage-metadata.py
  stage-r2-consistency.py
  stage-r2-misc.py
  stage-review-fixes.py
  stage-spec-hardening.py
  stage-target-highlight.py
)

L2_SCRIPTS=(
  terminology.sh
  data-flow.py
  seed-completeness.sh
  lock-coverage.sh
  phase-state-machine.py
  index-completeness.sh
  library-index-completeness.sh
  library-health-audit.sh
  library-regression-fixes.sh
  init-functional.sh
  research-functional.sh
  plan-functional.sh
  verify-functional.sh
  check-functional.sh
  exec-functional.sh
  merge-functional.sh
  auto-functional.sh
  read-functional.sh
  security-functional.sh
  target-functional.sh
  vfp-applicability.sh
  annotate-functional.sh
  signal-field-names.py
  injection-category-count.sh
  plugin-slot-consistency.py
  test-strategy-consistency.py
  audit-round2-fixes.py
  audit-round3-fixes.py
  audit-round4-fixes.py
  audit-round5-fixes.py
  init-stage-field.sh
  state-stage-done.py
  audit-round7-fixes.py
  audit-round8-fixes.py
)

L3_SCRIPTS=(
  state-machine-graph.py
  protocol-compliance.py
  library-relation-routing.py
  signal-routing.py
)

META_SCRIPTS=(
  self-check.sh
)

# --- Argument parsing ---
LEVEL="all"
JSON_MODE=0
REGRESSION_FILE=""
SNAPSHOT_FILE=""
SELF_CHECK=0
CHECK_PHASE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --level)    LEVEL="$2"; shift 2 ;;
    --json)     JSON_MODE=1; shift ;;
    --regression) REGRESSION_FILE="$2"; shift 2 ;;
    --snapshot) SNAPSHOT_FILE="$2"; JSON_MODE=1; shift 2 ;;
    --self-check) SELF_CHECK=1; shift ;;
    --check-phase) CHECK_PHASE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

declare -a SCRIPTS_TO_RUN=()
add_level() {
  local level_name="$1"
  shift
  local scripts=("$@")
  for s in "${scripts[@]}"; do SCRIPTS_TO_RUN+=("$level_name:$s"); done
}

case "$LEVEL" in
  1)   add_level "L1" "${L1_SCRIPTS[@]}" ;;
  2)   add_level "L2" "${L2_SCRIPTS[@]}" ;;
  3)   add_level "L3" "${L3_SCRIPTS[@]}" ;;
  all)
    add_level "L1" "${L1_SCRIPTS[@]}"
    add_level "L2" "${L2_SCRIPTS[@]}"
    add_level "L3" "${L3_SCRIPTS[@]}"
    ;;
  *) echo "Invalid level: $LEVEL" >&2; exit 1 ;;
esac

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_WARN=0
FAILED_SCRIPTS=0

run_script() {
  local label="$1"
  local script="${label#*:}"
  local level="${label%%:*}"
  local script_path="$CONTRACTS/$script"
  [[ ! -f "$script_path" ]] && return

  local output
  local exit_code=0
  if [[ "$script" == *.py ]]; then
    output=$(python3 "$script_path" 2>&1) || exit_code=$?
  else
    output=$(bash "$script_path" 2>&1) || exit_code=$?
  fi

  local pass_count fail_count warn_count
  pass_count=$(echo "$output" | grep -c '^\[PASS\]' || true)
  fail_count=$(echo "$output" | grep -c '^\[FAIL\]' || true)
  warn_count=$(echo "$output" | grep -c '^\[WARN\]' || true)

  TOTAL_PASS=$((TOTAL_PASS + pass_count))
  TOTAL_FAIL=$((TOTAL_FAIL + fail_count))
  TOTAL_WARN=$((TOTAL_WARN + warn_count))
  [[ $exit_code -ne 0 ]] && FAILED_SCRIPTS=$((FAILED_SCRIPTS + 1))

  if [[ $JSON_MODE -eq 0 ]]; then
    echo "=== $level: $script ==="
    echo "$output"
    echo ""
  fi
}

for label in "${SCRIPTS_TO_RUN[@]}"; do run_script "$label"; done

echo "======================================="
echo "  TOTAL: $TOTAL_PASS passed, $TOTAL_FAIL failed, $TOTAL_WARN warnings"
echo "  Failed scripts: $FAILED_SCRIPTS"
echo "======================================="

exit $FAILED_SCRIPTS
