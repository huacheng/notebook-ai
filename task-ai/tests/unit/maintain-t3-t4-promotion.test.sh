#!/usr/bin/env bash
# Test: maintain.sh --promote-skill T3→T4 production validation
# RED/GREEN TDD: T3 skills in .active/ should be promoted to T4
# when changelog shows usage_count >= 3 post-activation with zero failures

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MAINTAIN_SH="$TASK_AI_ROOT/skills/library/scripts/maintain.sh"

PASS=0
FAIL=0
pass() { echo "✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "✗ $1" >&2; FAIL=$((FAIL + 1)); }

# ─────────────────────────────────────────────────────────────────────────────
# Setup: create temp library with .active/ skill at T3 and a changelog
# ─────────────────────────────────────────────────────────────────────────────
setup() {
    TEST_DIR=$(mktemp -d)
    export NB_WORKSPACES_ROOT="$TEST_DIR"
    export NB_WORKSPACES_LIBRARY="$TEST_DIR/.library"

    mkdir -p "$NB_WORKSPACES_LIBRARY/.skills/.candidates"
    mkdir -p "$NB_WORKSPACES_LIBRARY/.skills/.drafts"
    mkdir -p "$NB_WORKSPACES_LIBRARY/.skills/.active/test-skill"

    # Create a T3 skill
    cat > "$NB_WORKSPACES_LIBRARY/.skills/.active/test-skill/SKILL.md" <<'SKILL'
---
name: test-skill
description: A test skill
trust_tier: T3
activated_at: 2026-03-01T10:00:00Z
---

# /test-skill
Test content
SKILL
}

teardown() {
    rm -rf "$TEST_DIR"
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 1: T3 skill with >= 3 references and zero failures → promote to T4
# ─────────────────────────────────────────────────────────────────────────────
test_t3_promoted_to_t4_on_sufficient_usage() {
    setup

    # Create changelog with 3 post-activation referenced entries, no REPLAN
    cat > "$NB_WORKSPACES_LIBRARY/.changelog" <<'LOG'
2026-03-02T10:00Z | referenced | .skills/.active/test-skill/SKILL.md | caller:plan,notebook:task-a
2026-03-03T10:00Z | referenced | .skills/.active/test-skill/SKILL.md | caller:exec,notebook:task-b
2026-03-04T10:00Z | referenced | .skills/.active/test-skill/SKILL.md | caller:plan,notebook:task-c
LOG

    OUTPUT=$(bash "$MAINTAIN_SH" --promote-skill test-skill 2>&1 || true)

    if echo "$OUTPUT" | grep -q "T3.*T4\|Promoted to T4\|trust_tier.*T4"; then
        pass "T3 skill promoted to T4 with 3 references and zero failures"
    else
        fail "T3 skill NOT promoted to T4 (output: $OUTPUT)"
    fi

    # Verify trust_tier in SKILL.md was actually changed
    if grep -q "trust_tier: T4" "$NB_WORKSPACES_LIBRARY/.skills/.active/test-skill/SKILL.md"; then
        pass "SKILL.md trust_tier updated to T4"
    else
        fail "SKILL.md trust_tier not updated ($(grep trust_tier "$NB_WORKSPACES_LIBRARY/.skills/.active/test-skill/SKILL.md" 2>/dev/null || echo 'not found'))"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 2: T3 skill with < 3 references → remain T3
# ─────────────────────────────────────────────────────────────────────────────
test_t3_stays_with_insufficient_usage() {
    setup

    # Only 2 references
    cat > "$NB_WORKSPACES_LIBRARY/.changelog" <<'LOG'
2026-03-02T10:00Z | referenced | .skills/.active/test-skill/SKILL.md | caller:plan,notebook:task-a
2026-03-03T10:00Z | referenced | .skills/.active/test-skill/SKILL.md | caller:exec,notebook:task-b
LOG

    OUTPUT=$(bash "$MAINTAIN_SH" --promote-skill test-skill 2>&1 || true)

    if echo "$OUTPUT" | grep -qE "usage_count.*2|remains.*T3|not enough"; then
        pass "T3 skill stays T3 with only 2 references"
    else
        fail "Unexpected output for insufficient usage (output: $OUTPUT)"
    fi

    # Verify trust_tier unchanged
    if grep -q "trust_tier: T3" "$NB_WORKSPACES_LIBRARY/.skills/.active/test-skill/SKILL.md"; then
        pass "SKILL.md trust_tier remains T3"
    else
        fail "SKILL.md trust_tier changed unexpectedly"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 3: T3 skill with >= 3 references but REPLAN failure → remain T3
# ─────────────────────────────────────────────────────────────────────────────
test_t3_stays_with_replan_failure() {
    setup

    # 3 references, but task-b had a REPLAN within 24h after referencing this skill
    cat > "$NB_WORKSPACES_LIBRARY/.changelog" <<'LOG'
2026-03-02T10:00Z | referenced | .skills/.active/test-skill/SKILL.md | caller:plan,notebook:task-a
2026-03-03T10:00Z | referenced | .skills/.active/test-skill/SKILL.md | caller:plan,notebook:task-b
2026-03-03T14:00Z | experience | .memory/.experiences/software/task-b-impl.md | quality_status:invalidated,replan:true,notebook:task-b
2026-03-04T10:00Z | referenced | .skills/.active/test-skill/SKILL.md | caller:plan,notebook:task-c
LOG

    OUTPUT=$(bash "$MAINTAIN_SH" --promote-skill test-skill 2>&1 || true)

    if echo "$OUTPUT" | grep -qE "failure|REPLAN|remains.*T3"; then
        pass "T3 skill stays T3 when REPLAN failure detected"
    else
        fail "Unexpected output for REPLAN failure case (output: $OUTPUT)"
    fi

    # Verify trust_tier unchanged
    if grep -q "trust_tier: T3" "$NB_WORKSPACES_LIBRARY/.skills/.active/test-skill/SKILL.md"; then
        pass "SKILL.md trust_tier remains T3 after REPLAN"
    else
        fail "SKILL.md trust_tier changed despite REPLAN"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 4: T4 skill → already at T4, no action
# ─────────────────────────────────────────────────────────────────────────────
test_t4_already_promoted() {
    setup

    # Set skill to T4
    sed -i 's/trust_tier: T3/trust_tier: T4/' "$NB_WORKSPACES_LIBRARY/.skills/.active/test-skill/SKILL.md"

    OUTPUT=$(bash "$MAINTAIN_SH" --promote-skill test-skill 2>&1 || true)

    if echo "$OUTPUT" | grep -qE "Already.*T4|already.*validated"; then
        pass "T4 skill correctly identified as already validated"
    else
        fail "T4 skill not recognized (output: $OUTPUT)"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Run all tests
# ─────────────────────────────────────────────────────────────────────────────
echo "=== maintain.sh T3→T4 Production Validation Tests ==="
test_t3_promoted_to_t4_on_sufficient_usage
test_t3_stays_with_insufficient_usage
test_t3_stays_with_replan_failure
test_t4_already_promoted

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
