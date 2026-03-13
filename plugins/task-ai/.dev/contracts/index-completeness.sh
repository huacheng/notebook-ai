#!/usr/bin/env bash
# L2: Verify REFERENCE-INDEX.md lists all files in references/ directories
source "$(dirname "$0")/lib.sh"

REF_INDEX="$TASK_AI_ROOT/REFERENCE-INDEX.md"

if [[ ! -f "$REF_INDEX" ]]; then
  emit_fail "REFERENCE-INDEX.md not found at root"
  summary; exit $?
fi

index_content=$(cat "$REF_INDEX")

# Check command-level references
while IFS= read -r ref_file; do
  rel_path=$(realpath --relative-to="$TASK_AI_ROOT" "$ref_file")
  filename=$(basename "$ref_file")

  if echo "$index_content" | grep -qF "$filename"; then
    emit_pass "index: lists $rel_path"
  elif echo "$index_content" | grep -qF "$rel_path"; then
    emit_pass "index: lists $rel_path (full path)"
  else
    emit_fail "index: MISSING $rel_path"
  fi
done < <(find_references)

# Check skill-level references
while IFS= read -r ref_file; do
  rel_path=$(realpath --relative-to="$TASK_AI_ROOT" "$ref_file")
  filename=$(basename "$ref_file")

  # Skip .summary.md and .index.md files (internal indexes)
  [[ "$filename" == ".summary.md" || "$filename" == ".index.md" ]] && continue

  if echo "$index_content" | grep -qF "$filename"; then
    emit_pass "index: lists $rel_path"
  elif echo "$index_content" | grep -qF "$rel_path"; then
    emit_pass "index: lists $rel_path (full path)"
  else
    emit_fail "index: MISSING $rel_path"
  fi
done < <(find_skill_references)

# Check SKILL.md files are listed
while IFS= read -r skill_file; do
  skill_name=$(basename "$(dirname "$skill_file")")

  if echo "$index_content" | grep -qF "$skill_name"; then
    emit_pass "index: lists skill '$skill_name'"
  else
    emit_fail "index: MISSING skill '$skill_name'"
  fi
done < <(find_skills)

summary
