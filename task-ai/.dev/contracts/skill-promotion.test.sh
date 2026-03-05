#!/usr/bin/env bash
# Test: Skill promotion pipeline T1→T2→T3→T4
# Verifies complete promotion flow implementation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

pass() { echo "✓ $1"; }
fail() { echo "✗ $1" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# Test 1: check.sh has T2→T3 move logic (candidates → drafts)
# ─────────────────────────────────────────────────────────────────────────────
test_check_has_t2_t3_move() {
    if grep -qE 'mv.*candidates.*drafts|move_to_drafts|MOVE_TO_DRAFTS' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "check.sh has T2→T3 move logic"
    else
        fail "check.sh missing T2→T3 move logic (candidates → drafts)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 2: check.sh supports skill-deep-review checkpoint (L3)
# ─────────────────────────────────────────────────────────────────────────────
test_check_has_skill_deep_review() {
    if grep -qE 'skill-deep-review|CHECKPOINT.*skill-deep' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "check.sh supports skill-deep-review checkpoint"
    else
        fail "check.sh missing skill-deep-review checkpoint (L3)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 3: check.sh has T3→T4 move logic (drafts → skills/<name>)
# ─────────────────────────────────────────────────────────────────────────────
test_check_has_t3_t4_move() {
    if grep -qE 'mv.*drafts.*skills/|move_to_active|MOVE_TO_ACTIVE' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "check.sh has T3→T4 move logic"
    else
        fail "check.sh missing T3→T4 move logic (drafts → skills/<name>)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 4: library maintain.sh has promote-skill command
# ─────────────────────────────────────────────────────────────────────────────
test_library_has_promote_skill() {
    if grep -qE 'promote-skill|--promote' \
        "$TASK_AI_ROOT/skills/library/scripts/maintain.sh"; then
        pass "maintain.sh has promote-skill command"
    else
        fail "maintain.sh missing promote-skill command"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 5: promote.sh has D2 security check
# ─────────────────────────────────────────────────────────────────────────────
test_promote_has_d2_security() {
    if grep -qE 'D2.*[Ss]ecurity|security.*check|SECURITY_SCORE' \
        "$TASK_AI_ROOT/skills/highlight/scripts/promote.sh"; then
        pass "promote.sh has D2 security check"
    else
        fail "promote.sh missing D2 security check"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 6: promote.sh has D1/D3/D5 self-review
# ─────────────────────────────────────────────────────────────────────────────
test_promote_has_semantic_review() {
    if grep -qE 'D1.*[Cc]orrect|D3.*[Rr]eliab|D5.*[Aa]rchitect|SEMANTIC_SCORE' \
        "$TASK_AI_ROOT/skills/highlight/scripts/promote.sh"; then
        pass "promote.sh has D1/D3/D5 semantic review"
    else
        fail "promote.sh missing D1/D3/D5 semantic review"
    fi
}

# Run tests
echo "=== Skill Promotion Pipeline Tests ==="
test_check_has_t2_t3_move
test_check_has_skill_deep_review
test_check_has_t3_t4_move
test_library_has_promote_skill
test_promote_has_d2_security
test_promote_has_semantic_review
echo ""
echo "All tests passed."
