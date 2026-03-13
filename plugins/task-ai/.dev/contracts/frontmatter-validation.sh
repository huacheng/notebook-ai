#!/usr/bin/env bash
# L1: Validate SKILL.md frontmatter has required fields with valid values
source "$(dirname "$0")/lib.sh"

REQUIRED_FIELDS=("name" "description" "model_tier" "auto_delegatable")
VALID_MODEL_TIERS=("heavy" "medium" "light")
VALID_DELEGATABLE=("true" "false")

# Load model-routing.md for cross-validation if available
MODEL_ROUTING="$TASK_AI_ROOT/commands/references/model-routing.md"

while IFS= read -r skill_file; do
  skill_name=$(basename "$(dirname "$skill_file")")

  # Extract frontmatter
  fm=$(extract_frontmatter "$skill_file")

  if [[ -z "$fm" ]]; then
    emit_fail "$skill_name: no frontmatter found"
    continue
  fi

  local_fail=0

  # Check required fields
  for field in "${REQUIRED_FIELDS[@]}"; do
    value=$(echo "$fm" | grep "^${field}:" | head -1 | sed "s/^${field}:[[:space:]]*//" | sed 's/[[:space:]]*$//')

    if [[ -z "$value" ]]; then
      emit_fail "$skill_name: missing required field '$field'"
      local_fail=1
      continue
    fi

    # Validate field values
    case "$field" in
      name)
        # Name should match the directory name
        if [[ "$value" != "$skill_name" ]]; then
          emit_warn "$skill_name: frontmatter name '$value' != directory name '$skill_name'"
        fi
        ;;
      model_tier)
        valid=0
        for tier in "${VALID_MODEL_TIERS[@]}"; do
          [[ "$value" == "$tier" ]] && valid=1
        done
        if [[ $valid -eq 0 ]]; then
          emit_fail "$skill_name: invalid model_tier '$value' (expected: heavy|medium|light)"
          local_fail=1
        fi
        ;;
      auto_delegatable)
        valid=0
        for d in "${VALID_DELEGATABLE[@]}"; do
          [[ "$value" == "$d" ]] && valid=1
        done
        if [[ $valid -eq 0 ]]; then
          emit_fail "$skill_name: invalid auto_delegatable '$value' (expected: true|false)"
          local_fail=1
        fi
        ;;
    esac
  done

  if [[ $local_fail -eq 0 ]]; then
    emit_pass "$skill_name: frontmatter valid"
  fi
done < <(find_skills)

# Cross-validate with model-routing.md if available
if [[ -f "$MODEL_ROUTING" ]]; then
  content=$(strip_code_blocks < "$MODEL_ROUTING")
  while IFS= read -r skill_file; do
    skill_name=$(basename "$(dirname "$skill_file")")
    fm_tier=$(extract_frontmatter "$skill_file" | grep "^model_tier:" | sed 's/^model_tier:[[:space:]]*//')

    if [[ -n "$fm_tier" ]]; then
      if grep -q "$skill_name" "$MODEL_ROUTING"; then
        emit_pass "$skill_name: found in model-routing.md"
      else
        emit_warn "$skill_name: not found in model-routing.md"
      fi
    fi
  done < <(find_skills)
fi

summary
