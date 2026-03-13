#!/usr/bin/env bash
# L2: Verify injection category count is consistent across all files
# Counts actual ## Category N: headings in injection-rules.md,
# then verifies all other files referencing the count agree on the number.
source "$(dirname "$0")/lib.sh"

INJECTION_RULES="$TASK_AI_ROOT/skills/library/references/injection-rules.md"

if [[ ! -f "$INJECTION_RULES" ]]; then
  emit_fail "injection-rules.md not found"
  summary; exit $?
fi

# Count actual categories by heading pattern: ## Category N:
ACTUAL_COUNT=$(grep -cE '^## Category [0-9]+' "$INJECTION_RULES")

if [[ "$ACTUAL_COUNT" -eq 0 ]]; then
  emit_fail "injection-rules.md: no Category headings found"
  summary; exit $?
fi

emit_pass "injection-rules.md: $ACTUAL_COUNT categories defined"

# Verify category headings are sequential (1..N)
mapfile -t CATEGORY_NUMS < <(grep -oE '^## Category ([0-9]+)' "$INJECTION_RULES" | grep -oE '[0-9]+')
expected=1
for num in "${CATEGORY_NUMS[@]}"; do
  if [[ "$num" -ne "$expected" ]]; then
    emit_fail "injection-rules.md: expected Category $expected, found Category $num"
  fi
  ((expected++))
done
if [[ "${CATEGORY_NUMS[-1]}" -eq "$ACTUAL_COUNT" ]]; then
  emit_pass "injection-rules.md: categories 1-$ACTUAL_COUNT sequential"
fi

# Number-to-word mapping for common counts
declare -A NUM_WORDS=(
  [1]="one" [2]="two" [3]="three" [4]="four" [5]="five"
  [6]="six" [7]="seven" [8]="eight" [9]="nine" [10]="ten"
  [11]="eleven" [12]="twelve" [13]="thirteen" [14]="fourteen" [15]="fifteen"
)
EXPECTED_WORD="${NUM_WORDS[$ACTUAL_COUNT]:-}"

# Scan all .md files for references to category count
while IFS= read -r md_file; do
  rel_path=$(realpath --relative-to="$TASK_AI_ROOT" "$md_file")

  # Skip .dev/ files and design docs
  [[ "$md_file" == *".dev/"* ]] && continue
  [[ "$md_file" == *"重构方案"* ]] && continue
  [[ "$md_file" == *"总结"* ]] && continue

  content=$(strip_code_blocks < "$md_file")

  # Pattern 1: "N-category" or "N active...categor" (digit form)
  # Pattern 2: "all N categor" (digit form)
  # Pattern 3: word form "ten-category", "ten active...categor", "all ten categor"
  while IFS= read -r line; do
    # Match digit patterns: "N-category", "N active...categor", "all N categor"
    if [[ "$line" =~ ([0-9]+)-category ]]; then
      found_num="${BASH_REMATCH[1]}"
      if [[ "$found_num" -ne "$ACTUAL_COUNT" ]]; then
        emit_fail "$rel_path: references '${found_num}-category' but actual count is $ACTUAL_COUNT"
      else
        emit_pass "$rel_path: '${found_num}-category' matches actual count"
      fi
    fi

    if [[ "$line" =~ ([0-9]+)[[:space:]]+active.*categor ]]; then
      found_num="${BASH_REMATCH[1]}"
      if [[ "$found_num" -ne "$ACTUAL_COUNT" ]]; then
        emit_fail "$rel_path: references '$found_num active...categories' but actual count is $ACTUAL_COUNT"
      else
        emit_pass "$rel_path: '$found_num active...categories' matches actual count"
      fi
    fi

    if [[ "$line" =~ all[[:space:]]+([0-9]+)[[:space:]]+categor ]]; then
      found_num="${BASH_REMATCH[1]}"
      if [[ "$found_num" -ne "$ACTUAL_COUNT" ]]; then
        emit_fail "$rel_path: references 'all $found_num categories' but actual count is $ACTUAL_COUNT"
      else
        emit_pass "$rel_path: 'all $found_num categories' matches actual count"
      fi
    fi

    # Match word-form patterns (case-insensitive for first char)
    if [[ -n "$EXPECTED_WORD" ]]; then
      line_lower=$(echo "$line" | tr '[:upper:]' '[:lower:]')

      # word-category pattern
      for word_num in "${!NUM_WORDS[@]}"; do
        word="${NUM_WORDS[$word_num]}"
        if [[ "$line_lower" =~ ${word}-category ]]; then
          if [[ "$word_num" -ne "$ACTUAL_COUNT" ]]; then
            emit_fail "$rel_path: references '${word}-category' (=$word_num) but actual count is $ACTUAL_COUNT"
          else
            emit_pass "$rel_path: '${word}-category' matches actual count"
          fi
        fi

        # "word active...categor"
        if [[ "$line_lower" =~ ${word}[[:space:]]+active.*categor ]]; then
          if [[ "$word_num" -ne "$ACTUAL_COUNT" ]]; then
            emit_fail "$rel_path: references '${word} active...categories' (=$word_num) but actual count is $ACTUAL_COUNT"
          else
            emit_pass "$rel_path: '${word} active...categories' matches actual count"
          fi
        fi

        # "all word categor"
        if [[ "$line_lower" =~ all[[:space:]]+${word}[[:space:]]+categor ]]; then
          if [[ "$word_num" -ne "$ACTUAL_COUNT" ]]; then
            emit_fail "$rel_path: references 'all ${word} categories' (=$word_num) but actual count is $ACTUAL_COUNT"
          else
            emit_pass "$rel_path: 'all ${word} categories' matches actual count"
          fi
        fi
      done
    fi
  done <<< "$content"
done < <(find_all_md)

summary
