#!/usr/bin/env bash
# L2: Functional test for annotate sub-command
source "$(dirname "$0")/lib.sh"

ANNOTATE_SKILL="$TASK_AI_ROOT/skills/annotate/SKILL.md"

# Test: frontend integration TBD note exists
if grep -q "Frontend integration" "$ANNOTATE_SKILL" && grep -q "TBD" "$ANNOTATE_SKILL"; then
  emit_pass "annotate: contains frontend integration TBD note"
else
  emit_fail "annotate: missing frontend integration TBD note"
fi

summary
