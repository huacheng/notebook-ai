#!/usr/bin/env bash
# L1: Verify step numbering is sequential within ## Execution Steps
source "$(dirname "$0")/lib.sh"

while IFS= read -r skill_file; do
  skill_name=$(basename "$(dirname "$skill_file")")

  # Extract step numbers from Execution Steps section
  numbers=()
  while IFS= read -r line; do
    # Match lines starting with a number followed by . (e.g., "1.", "12.")
    if [[ "$line" =~ ^([0-9]+)\.[[:space:]] ]]; then
      numbers+=("${BASH_REMATCH[1]}")
    fi
  done < <(extract_steps "$skill_file")

  if [[ ${#numbers[@]} -eq 0 ]]; then
    emit_warn "$skill_name: no numbered steps found in Execution Steps"
    continue
  fi

  # Check sequential numbering
  local_fail=0
  prev=0
  seen=()
  for num in "${numbers[@]}"; do
    # Check for duplicates
    for s in "${seen[@]}"; do
      if [[ "$s" == "$num" ]]; then
        emit_fail "$skill_name: duplicate step $num"
        local_fail=1
      fi
    done
    seen+=("$num")

    # Check sequence (should be prev+1, allowing for subsections)
    expected=$((prev + 1))
    if [[ $prev -gt 0 && $num -ne $expected && $num -ne $prev ]]; then
      # Allow gaps only if stepping by 1 from reset
      emit_fail "$skill_name: expected step $expected but found step $num (after step $prev)"
      local_fail=1
    fi
    if [[ $num -ne $prev ]]; then
      prev=$num
    fi
  done

  if [[ $local_fail -eq 0 ]]; then
    emit_pass "$skill_name: ${#numbers[@]} steps, sequential"
  fi
done < <(find_skills)

summary
