#!/usr/bin/env bash
# L2: Functional test for annotate sub-command
source "$(dirname "$0")/lib.sh"

ANNOTATE_SKILL="$TASK_AI_ROOT/skills/annotate/SKILL.md"

# Test: SKILL.md documents JSONL annotation processing with all 4 types
if grep -q "JSONL" "$ANNOTATE_SKILL" && grep -q "Insert" "$ANNOTATE_SKILL" && grep -q "Delete" "$ANNOTATE_SKILL" && grep -q "Replace" "$ANNOTATE_SKILL" && grep -q "Comment" "$ANNOTATE_SKILL"; then
  emit_pass "annotate: documents JSONL processing with 4 annotation types"
else
  emit_fail "annotate: missing JSONL or annotation type documentation"
fi

summary
