#!/usr/bin/env bash
# L1: Verify scripts validate find() results before using them
source "$(dirname "$0")/lib.sh"

# All scripts that use find to locate notebook directories
SCRIPTS_WITH_FIND=(
  "$TASK_AI_ROOT/skills/auto/scripts/auto.sh"
  "$TASK_AI_ROOT/skills/check/scripts/check.sh"
  "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"
  "$TASK_AI_ROOT/skills/merge/scripts/merge.sh"
  "$TASK_AI_ROOT/skills/plan/scripts/plan.sh"
  "$TASK_AI_ROOT/skills/report/scripts/report.sh"
  "$TASK_AI_ROOT/skills/research/scripts/research.sh"
  "$TASK_AI_ROOT/skills/security/scripts/security.sh"
  "$TASK_AI_ROOT/skills/verify/scripts/verify.sh"
)

for script in "${SCRIPTS_WITH_FIND[@]}"; do
  [[ ! -f "$script" ]] && continue
  rel=$(realpath --relative-to="$TASK_AI_ROOT" "$script")

  # Find lines with pattern: $(find ... | head -n 1)/
  # This appends a path suffix to find output without checking if find returned empty
  unsafe=$(grep -nE '\$\(find .* \| head -n 1\)/' "$script" || true)
  if [[ -n "$unsafe" ]]; then
    count=$(echo "$unsafe" | wc -l)
    emit_fail "$rel: $count unvalidated find() result(s) — empty find becomes root path"
  else
    emit_pass "$rel: find() results are validated"
  fi
done

summary
