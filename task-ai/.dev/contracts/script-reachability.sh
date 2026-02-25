#!/usr/bin/env bash
# L1: Verify all script paths referenced in SKILL.md files exist on disk
source "$(dirname "$0")/lib.sh"

while IFS= read -r skill_file; do
  skill_name=$(basename "$(dirname "$skill_file")")
  skill_dir=$(dirname "$skill_file")

  # Extract code blocks and find script references
  # Match patterns like: scripts/foo.sh, scripts/foo.py, $TASK_AI_ROOT/skills/.../scripts/...
  while IFS= read -r line; do
    # Match relative script paths: scripts/*.sh or scripts/*.py
    if [[ "$line" =~ scripts/[a-zA-Z0-9_-]+\.(sh|py) ]]; then
      script_ref="${BASH_REMATCH[0]}"
      # Try relative to skill directory
      if [[ -f "$skill_dir/$script_ref" ]]; then
        emit_pass "$skill_name: script '$script_ref' exists"
      elif [[ -f "$TASK_AI_ROOT/skills/$skill_name/$script_ref" ]]; then
        emit_pass "$skill_name: script '$script_ref' exists (skill root)"
      else
        emit_fail "$skill_name: script '$script_ref' not found"
      fi
    fi
  done < "$skill_file"
done < <(find_skills)

summary
