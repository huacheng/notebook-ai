#!/usr/bin/env bash
# L1: Verify scripts use shared lib.sh function for notebook workdir resolution
# instead of inline find+append patterns
source "$(dirname "$0")/lib.sh"

# Scripts that resolve notebook working directory
WORKDIR_SCRIPTS=(
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

for script in "${WORKDIR_SCRIPTS[@]}"; do
  [[ ! -f "$script" ]] && continue
  rel=$(realpath --relative-to="$TASK_AI_ROOT" "$script")

  # Count inline find+workdir patterns (should be 0 if using shared function)
  inline_count=$(grep -cE 'WORK_DIR=\$\(find|NB_DIR=\$\(find' "$script" || true)
  if [[ "$inline_count" -gt 0 ]]; then
    emit_fail "$rel: $inline_count inline find+workdir pattern(s) — should use resolve_workdir from lib.sh"
  else
    emit_pass "$rel: uses shared workdir resolution"
  fi
done

# Verify lib.sh has the shared function
if grep -q 'resolve_workdir\|resolve_nb_workdir' "$DEV_ROOT/contracts/lib.sh"; then
  emit_pass "lib.sh: exports resolve_workdir function"
else
  emit_fail "lib.sh: missing resolve_workdir shared function"
fi

summary
