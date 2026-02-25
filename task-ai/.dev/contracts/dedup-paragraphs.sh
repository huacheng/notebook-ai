#!/usr/bin/env bash
# L1: Detect duplicated multi-line paragraphs across SKILL.md files
source "$(dirname "$0")/lib.sh"

# Known pairs to check for duplication
# Format: file1|file2|pattern (pattern identifies the paragraph start)
KNOWN_PAIRS=(
  "skills/plan/SKILL.md|skills/exec/SKILL.md|Context management"
)

for pair in "${KNOWN_PAIRS[@]}"; do
  IFS='|' read -r file1 file2 pattern <<< "$pair"
  f1="$TASK_AI_ROOT/$file1"
  f2="$TASK_AI_ROOT/$file2"

  [[ ! -f "$f1" || ! -f "$f2" ]] && continue

  # Extract the paragraph starting with the pattern (up to next blank line or heading)
  para1=$(sed -n "/^\\*\\*${pattern}/,/^$/p" "$f1" | head -5)
  para2=$(sed -n "/^\\*\\*${pattern}/,/^$/p" "$f2" | head -5)

  if [[ -n "$para1" && "$para1" == "$para2" ]]; then
    emit_fail "dedup: identical '$pattern' paragraph in $file1 and $file2 — extract to shared reference"
  elif [[ -n "$para1" && -n "$para2" ]]; then
    emit_pass "dedup: '$pattern' paragraphs differ between $file1 and $file2"
  else
    emit_pass "dedup: '$pattern' not found in both files (ok)"
  fi
done

summary
