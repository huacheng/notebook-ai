#!/usr/bin/env bash
# L1: Verify scripts with optional flags initialize variables with defaults
# Without defaults, set -u causes unbound-variable crash when flags are omitted.
source "$(dirname "$0")/lib.sh"

# Format: script_path|VAR1,VAR2,...
SCRIPTS_WITH_FLAGS=(
  "skills/verify/scripts/verify.sh|CHECKPOINT"
  "skills/check/scripts/check.sh|CHECKPOINT"
  "skills/research/scripts/research.sh|CALLER,PHASE,SCOPE"
  "skills/report/scripts/report.sh|FORMAT"
)

for entry in "${SCRIPTS_WITH_FLAGS[@]}"; do
  IFS='|' read -r script vars <<< "$entry"
  script_path="$TASK_AI_ROOT/$script"
  [[ ! -f "$script_path" ]] && continue
  rel="$script"

  IFS=',' read -ra var_list <<< "$vars"
  for var in "${var_list[@]}"; do
    # Check if variable has a default assignment before the while-loop parser
    # Match patterns like: VARNAME="" or VARNAME='' or VARNAME=value (at start of line or indented)
    if grep -qE "^[[:space:]]*${var}=" "$script_path"; then
      emit_pass "$rel: \$$var has default value"
    else
      emit_fail "$rel: \$$var has no default — set -u crash if --flag not passed"
    fi
  done
done

summary
