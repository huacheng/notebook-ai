#!/usr/bin/env bash
# L1: Verify no lettered sub-steps (a. b. c.) exist in Execution Steps sections
source "$(dirname "$0")/lib.sh"

while IFS= read -r skill_file; do
  skill_name=$(basename "$(dirname "$skill_file")")
  steps_content=$(extract_steps "$skill_file")
  [[ -z "$steps_content" ]] && continue

  # Detect lettered sub-steps: lines starting with optional spaces + a letter + . + space
  lettered=$(echo "$steps_content" | grep -nE '^\s+[a-z]\.\s' || true)
  if [[ -n "$lettered" ]]; then
    count=$(echo "$lettered" | wc -l)
    emit_fail "$skill_name: found $count lettered sub-step(s) — convert to N.M numeric format"
  else
    emit_pass "$skill_name: no lettered sub-steps"
  fi
done < <(find_skills)

# Also check references that contain procedural steps
for ref_file in \
  "$TASK_AI_ROOT/skills/auto/references/backend-api.md" \
  "$TASK_AI_ROOT/skills/library/references/write-protocol.md"; do
  [[ ! -f "$ref_file" ]] && continue
  rel=$(realpath --relative-to="$TASK_AI_ROOT" "$ref_file")
  content=$(strip_code_blocks < "$ref_file")
  lettered=$(echo "$content" | grep -nE '^\s+[a-z]\.\s' || true)
  if [[ -n "$lettered" ]]; then
    count=$(echo "$lettered" | wc -l)
    emit_fail "$rel: found $count lettered sub-step(s)"
  else
    emit_pass "$rel: no lettered sub-steps"
  fi
done

summary
