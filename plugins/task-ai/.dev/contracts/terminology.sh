#!/usr/bin/env bash
# L2: Check that old terminology does not appear in .md files (excluding code blocks and this file)
source "$(dirname "$0")/lib.sh"

BLOCKLIST="$FIXTURES/terminology-blocklist.txt"
if [[ ! -f "$BLOCKLIST" ]]; then
  emit_fail "terminology-blocklist.txt fixture missing"
  summary; exit $?
fi

# Load blocklist (skip comments and empty lines)
declare -a OLD_TERMS=()
declare -a NEW_TERMS=()
while IFS=$'\t' read -r old new; do
  [[ "$old" =~ ^# ]] && continue
  [[ -z "$old" ]] && continue
  OLD_TERMS+=("$old")
  NEW_TERMS+=("$new")
done < "$BLOCKLIST"

# Scan all .md files
while IFS= read -r md_file; do
  rel_path=$(realpath --relative-to="$TASK_AI_ROOT" "$md_file")

  # Skip the terminology blocklist fixture itself
  [[ "$md_file" == *".dev/"* ]] && continue

  # Skip the refactoring design doc
  [[ "$md_file" == *"重构方案"* ]] && continue

  # Skip VFP protocol — its Terminology table legitimately defines old→new mappings
  [[ "$md_file" == *"verification-first-protocol.md" ]] && continue

  # Strip code blocks
  content=$(strip_code_blocks < "$md_file")

  for i in "${!OLD_TERMS[@]}"; do
    old="${OLD_TERMS[$i]}"
    new="${NEW_TERMS[$i]}"

    # Check for old term occurrence
    count=$(echo "$content" | grep -cF "$old" || true)
    if [[ $count -gt 0 ]]; then
      emit_fail "$rel_path: found old term '$old' ($count occurrences) — should be '$new'"
    fi
  done
done < <(find_all_md)

# If no failures, note overall pass
if [[ $FAIL -eq 0 ]]; then
  emit_pass "terminology: no old terms found across all .md files"
fi

summary
