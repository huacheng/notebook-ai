#!/usr/bin/env bash
# L2: Verify VFP applicability includes type-profile Verification Cycle check
source "$(dirname "$0")/lib.sh"

VFP_REF="$TASK_AI_ROOT/commands/references/verification-first-protocol.md"

# Canonical applicability rule from VFP spec
if [[ ! -f "$VFP_REF" ]]; then
  emit_fail "verification-first-protocol.md not found"
  summary; exit $?
fi

# Check exec/SKILL.md
EXEC_SKILL="$TASK_AI_ROOT/skills/exec/SKILL.md"
EXEC_CONTENT=$(cat "$EXEC_SKILL")
if echo "$EXEC_CONTENT" | grep -q "Verification Cycle"; then
  emit_pass "exec: VFP section references type-profile Verification Cycle"
else
  emit_fail "exec: VFP applicability should check type-profile for '## Verification Cycle' — currently hardcodes 'software' only"
fi

# Check check/SKILL.md
CHECK_SKILL="$TASK_AI_ROOT/skills/check/SKILL.md"
CHECK_CONTENT=$(cat "$CHECK_SKILL")
if echo "$CHECK_CONTENT" | grep -q "Verification Cycle"; then
  emit_pass "check: VFP section references type-profile Verification Cycle"
else
  emit_fail "check: VFP applicability should check type-profile for '## Verification Cycle'"
fi

summary
