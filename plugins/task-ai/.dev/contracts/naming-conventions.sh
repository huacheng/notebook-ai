#!/usr/bin/env bash
# L1: Check file naming patterns match conventions
# - Date patterns should be YYYY-MM-DD
# - File names should match [a-zA-Z0-9._-]+
# - Directory names should match [a-zA-Z0-9._-]+
source "$(dirname "$0")/lib.sh"

# Check all markdown files for valid naming
while IFS= read -r md_file; do
  filename=$(basename "$md_file")
  rel_path=$(realpath --relative-to="$TASK_AI_ROOT" "$md_file")

  # Check filename matches allowed pattern (allow leading dot for hidden files)
  if [[ "$filename" =~ ^\.?[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
    emit_pass "$rel_path: valid filename"
  else
    emit_fail "$rel_path: filename '$filename' violates naming convention"
  fi
done < <(find_all_md)

# Check directory naming within skills/
while IFS= read -r dir; do
  dirname_only=$(basename "$dir")
  if [[ "$dirname_only" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
    emit_pass "skills/$dirname_only: valid directory name"
  else
    emit_fail "skills/$dirname_only: directory name violates convention"
  fi
done < <(find "$TASK_AI_ROOT/skills" -mindepth 1 -maxdepth 1 -type d | sort)

# Check directory-convention.md mentions expected file patterns
dir_conv="$TASK_AI_ROOT/commands/references/directory-convention.md"
if [[ -f "$dir_conv" ]]; then
  # Verify key file patterns are documented
  for pattern in ".status.json" ".target.md" ".plan.md" ".summary.md" ".auto-signal" ".type-profile.md"; do
    if grep -qF "$pattern" "$dir_conv"; then
      emit_pass "directory-convention: documents $pattern"
    else
      emit_warn "directory-convention: missing documentation for $pattern"
    fi
  done
fi

summary
