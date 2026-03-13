#!/usr/bin/env bash
# L1: Verify cross-file references (See `file`, See file) resolve to existing files
source "$(dirname "$0")/lib.sh"

resolve_ref() {
  local ref="$1" file_dir="$2"

  # Try relative to the file's directory
  [[ -f "$file_dir/$ref" ]] && return 0
  # Try relative to task-ai root
  [[ -f "$TASK_AI_ROOT/$ref" ]] && return 0
  # Try in commands/references/
  [[ -f "$TASK_AI_ROOT/commands/references/$ref" ]] && return 0
  # Try in the skill's directory (e.g., from SKILL.md referencing references/foo.md)
  [[ -f "$file_dir/../$ref" ]] && return 0
  # Try prepending skills/ (e.g., "plan/references/type-profiling.md" -> "skills/plan/references/type-profiling.md")
  [[ -f "$TASK_AI_ROOT/skills/$ref" ]] && return 0
  # Try just the basename in commands/references/
  local base
  base=$(basename "$ref")
  [[ -f "$TASK_AI_ROOT/commands/references/$base" ]] && return 0
  # Try in any skill's references directory
  for skill_dir in "$TASK_AI_ROOT"/skills/*/references/; do
    [[ -f "$skill_dir/$base" ]] && return 0
    [[ -f "$skill_dir/$ref" ]] && return 0
  done
  # Handle template patterns like <type>.md — check if directory exists
  if [[ "$ref" == *"<"*">"* ]]; then
    local dir_part
    dir_part=$(dirname "$ref")
    [[ -d "$file_dir/$dir_part" ]] && return 0
    [[ -d "$TASK_AI_ROOT/$dir_part" ]] && return 0
    [[ -d "$TASK_AI_ROOT/skills/$dir_part" ]] && return 0
  fi

  return 1
}

while IFS= read -r md_file; do
  rel_path=$(realpath --relative-to="$TASK_AI_ROOT" "$md_file")
  file_dir=$(dirname "$md_file")

  # Strip code blocks to avoid false positives
  content=$(strip_code_blocks < "$md_file")

  # Find patterns like: See `filename.md`
  while IFS= read -r line; do
    # Match "See `...`" patterns pointing to .md files or SKILL.md
    re='[Ss]ee[[:space:]]+`([^`]+\.(md|json))`'
    while [[ "$line" =~ $re ]]; do
      ref="${BASH_REMATCH[1]}"
      line="${line#*"${BASH_REMATCH[0]}"}"

      if resolve_ref "$ref" "$file_dir"; then
        emit_pass "$rel_path: ref '$ref' exists"
      else
        emit_fail "$rel_path: ref '$ref' not found"
      fi
    done
  done <<< "$content"
done < <(find_all_md)

# Also check REFERENCE-INDEX.md entries point to existing files
ref_index="$TASK_AI_ROOT/REFERENCE-INDEX.md"
if [[ -f "$ref_index" ]]; then
  while IFS= read -r line; do
    # Match markdown links like [text](path)
    re='\[([^\]]*)\]\(([^\)]+\.md)\)'
    while [[ "$line" =~ $re ]]; do
      link_path="${BASH_REMATCH[2]}"
      line="${line#*"${BASH_REMATCH[0]}"}"

      if [[ -f "$TASK_AI_ROOT/$link_path" ]]; then
        emit_pass "REFERENCE-INDEX: link '$link_path' exists"
      else
        emit_fail "REFERENCE-INDEX: link '$link_path' not found"
      fi
    done
  done < <(strip_code_blocks < "$ref_index")
fi

summary
