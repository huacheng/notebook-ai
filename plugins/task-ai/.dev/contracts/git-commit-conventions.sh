#!/usr/bin/env bash
# L1: Verify ## Git section commit types are in git-details.md whitelist
source "$(dirname "$0")/lib.sh"

GIT_DETAILS="$TASK_AI_ROOT/commands/references/git-details.md"

# Build commit type whitelist from git-details.md
COMMIT_TYPES=()
if [[ -f "$GIT_DETAILS" ]]; then
  # Extract commit types from table rows: | `type` | ... |
  while IFS= read -r line; do
    [[ "$line" =~ ^\| ]] || continue
    [[ "$line" =~ ^\|[[:space:]]*-+ ]] && continue

    # Extract backtick-quoted type from first column
    first_col=$(echo "$line" | awk -F'|' '{print $2}')
    if [[ "$first_col" =~ \`([a-z]+)\` ]]; then
      type="${BASH_REMATCH[1]}"
      COMMIT_TYPES+=("$type")
    fi
  done < <(strip_code_blocks < "$GIT_DETAILS")

  # Also extract from example lines: task-ai(module):type
  while IFS= read -r line; do
    if [[ "$line" =~ task-ai\([^\)]*\):([a-z]+) ]]; then
      COMMIT_TYPES+=("${BASH_REMATCH[1]}")
    fi
  done < <(strip_code_blocks < "$GIT_DETAILS")

  # Deduplicate
  COMMIT_TYPES=($(printf '%s\n' "${COMMIT_TYPES[@]}" | sort -u))

  if [[ ${#COMMIT_TYPES[@]} -eq 0 ]]; then
    # Fallback: known commit types from the design doc
    COMMIT_TYPES=(init plan check exec feat fix refactor merge report verify annotate research summarize cancel)
    emit_warn "git-details.md: could not extract commit types, using fallback"
  else
    emit_pass "git-details.md: found ${#COMMIT_TYPES[@]} commit types: ${COMMIT_TYPES[*]}"
  fi
else
  emit_warn "git-details.md not found, using default whitelist"
  COMMIT_TYPES=(init plan check exec feat fix refactor merge report verify annotate research summarize cancel)
fi

# Check each SKILL.md's ## Git section
while IFS= read -r skill_file; do
  skill_name=$(basename "$(dirname "$skill_file")")

  git_section=$(extract_section "$skill_file" "## Git")
  [[ -z "$git_section" ]] && continue

  # Extract commit type patterns from the section
  local_fail=0
  found_types=0

  while IFS= read -r line; do
    # Match patterns like: task-ai(<module>):type
    if [[ "$line" =~ task-ai\([^\)]*\):([a-z]+) ]]; then
      type="${BASH_REMATCH[1]}"
      found_types=1

      valid=0
      for ct in "${COMMIT_TYPES[@]}"; do
        [[ "$type" == "$ct" ]] && valid=1
      done

      if [[ $valid -eq 1 ]]; then
        emit_pass "$skill_name: commit type '$type' in whitelist"
      else
        emit_fail "$skill_name: commit type '$type' NOT in whitelist"
        local_fail=1
      fi
    fi
  done <<< "$git_section"

  if [[ $found_types -eq 0 ]]; then
    emit_warn "$skill_name: no commit type patterns found in ## Git section"
  fi
done < <(find_skills)

summary
