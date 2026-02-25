#!/usr/bin/env bash
# L1: Verify deleted files are not referenced anywhere
source "$(dirname "$0")/lib.sh"

# Files that should not exist and should not be referenced
DELETED_FILES=(
  "lifecycle-hooks.md"
)

for deleted in "${DELETED_FILES[@]}"; do
  # Check file doesn't exist
  found=$(find "$TASK_AI_ROOT" -name "$deleted" -not -path "*/.dev/*" -not -path "*/.git/*" | head -1)
  if [[ -n "$found" ]]; then
    emit_fail "deleted file '$deleted' still exists at: $found"
  else
    emit_pass "deleted file '$deleted' does not exist"
  fi

  # Check no references remain
  refs=$(grep -rl "$deleted" "$TASK_AI_ROOT" \
    --include="*.md" \
    --exclude-dir=".dev" \
    --exclude-dir=".git" \
    --exclude-dir="node_modules" \
    --exclude-dir="docs" 2>/dev/null || true)
  if [[ -n "$refs" ]]; then
    count=$(echo "$refs" | wc -l)
    emit_fail "'$deleted' still referenced in $count file(s): $(echo "$refs" | head -3 | tr '\n' ' ')"
  else
    emit_pass "'$deleted' has no remaining references"
  fi
done

summary
