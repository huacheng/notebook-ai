#!/usr/bin/env bash
# Test: maintain.sh --scheduled (periodic auto-maintenance)
# RED/GREEN TDD: scheduled maintenance checks timestamps and runs due tasks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MAINTAIN_SH="$TASK_AI_ROOT/skills/library/scripts/maintain.sh"

PASS=0
FAIL=0
pass() { echo "✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "✗ $1" >&2; FAIL=$((FAIL + 1)); }

# ─────────────────────────────────────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────────────────────────────────────
setup() {
    TEST_DIR=$(mktemp -d)
    export NB_WORKSPACES_ROOT="$TEST_DIR"
    export NB_WORKSPACES_LIBRARY="$TEST_DIR/.library"

    mkdir -p "$NB_WORKSPACES_LIBRARY/.memory/.references"
    mkdir -p "$NB_WORKSPACES_LIBRARY/.memory/.experiences"
    mkdir -p "$NB_WORKSPACES_LIBRARY/.skills/.candidates"
    mkdir -p "$NB_WORKSPACES_LIBRARY/.skills/.drafts"
    mkdir -p "$NB_WORKSPACES_LIBRARY/.skills/.active"
    touch "$NB_WORKSPACES_LIBRARY/.changelog"
}

teardown() {
    rm -rf "$TEST_DIR"
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 1: --scheduled runs when no timestamp file exists (first run)
# ─────────────────────────────────────────────────────────────────────────────
test_scheduled_first_run() {
    setup

    OUTPUT=$(bash "$MAINTAIN_SH" --scheduled 2>&1 || true)

    if echo "$OUTPUT" | grep -qiE "scheduled maintenance|running.*maintenance|staleness|check"; then
        pass "--scheduled runs on first invocation (no timestamp)"
    else
        fail "--scheduled did not run on first invocation (output: $OUTPUT)"
    fi

    # Should create timestamp file
    if [[ -f "$NB_WORKSPACES_LIBRARY/.last-scheduled" ]]; then
        pass "Timestamp file .last-scheduled created"
    else
        fail "Timestamp file .last-scheduled not created"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 2: --scheduled skips when last run was recent (< 24h)
# ─────────────────────────────────────────────────────────────────────────────
test_scheduled_skips_recent() {
    setup

    # Set timestamp to now
    date +%s > "$NB_WORKSPACES_LIBRARY/.last-scheduled"

    OUTPUT=$(bash "$MAINTAIN_SH" --scheduled 2>&1 || true)

    if echo "$OUTPUT" | grep -qiE "skip|not due|recent|up.to.date"; then
        pass "--scheduled skips when last run is recent"
    else
        fail "--scheduled did not skip recent run (output: $OUTPUT)"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 3: --scheduled runs when last run was > 24h ago
# ─────────────────────────────────────────────────────────────────────────────
test_scheduled_runs_when_due() {
    setup

    # Set timestamp to 25 hours ago
    PAST=$(($(date +%s) - 90000))
    echo "$PAST" > "$NB_WORKSPACES_LIBRARY/.last-scheduled"

    OUTPUT=$(bash "$MAINTAIN_SH" --scheduled 2>&1 || true)

    if echo "$OUTPUT" | grep -qiE "scheduled maintenance|running.*maintenance|staleness|check"; then
        pass "--scheduled runs when > 24h since last run"
    else
        fail "--scheduled did not run when due (output: $OUTPUT)"
    fi

    # Timestamp should be updated
    NEW_TS=$(cat "$NB_WORKSPACES_LIBRARY/.last-scheduled" 2>/dev/null || echo "0")
    if [[ "$NEW_TS" -gt "$PAST" ]]; then
        pass "Timestamp updated after scheduled run"
    else
        fail "Timestamp not updated after scheduled run"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 4: --scheduled includes T3→T4 check for active skills
# ─────────────────────────────────────────────────────────────────────────────
test_scheduled_checks_t3_skills() {
    setup

    # Create a T3 skill
    mkdir -p "$NB_WORKSPACES_LIBRARY/.skills/.active/my-skill"
    cat > "$NB_WORKSPACES_LIBRARY/.skills/.active/my-skill/SKILL.md" <<'SKILL'
---
name: my-skill
trust_tier: T3
activated_at: 2026-03-01T10:00:00Z
---
# /my-skill
SKILL

    # Add 3 referenced entries
    cat > "$NB_WORKSPACES_LIBRARY/.changelog" <<'LOG'
2026-03-02T10:00Z | referenced | .skills/.active/my-skill/SKILL.md | caller:plan,notebook:task-a
2026-03-03T10:00Z | referenced | .skills/.active/my-skill/SKILL.md | caller:plan,notebook:task-b
2026-03-04T10:00Z | referenced | .skills/.active/my-skill/SKILL.md | caller:plan,notebook:task-c
LOG

    OUTPUT=$(bash "$MAINTAIN_SH" --scheduled 2>&1 || true)

    if echo "$OUTPUT" | grep -qE "T3.*T4|Promoted to T4|production.valid"; then
        pass "--scheduled promotes eligible T3 skills to T4"
    else
        fail "--scheduled did not check T3 skills (output: $OUTPUT)"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 5: --scheduled includes security rules evolution check
# ─────────────────────────────────────────────────────────────────────────────
test_scheduled_security_evolve() {
    setup

    OUTPUT=$(bash "$MAINTAIN_SH" --scheduled 2>&1 || true)

    if echo "$OUTPUT" | grep -qiE "security.*rules|core.*rules|evolv"; then
        pass "--scheduled includes security rules evolution check"
    else
        fail "--scheduled missing security rules evolution (output: $OUTPUT)"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 6: --scheduled --force bypasses timestamp check
# ─────────────────────────────────────────────────────────────────────────────
test_scheduled_force() {
    setup

    # Set timestamp to now (would normally skip)
    date +%s > "$NB_WORKSPACES_LIBRARY/.last-scheduled"

    OUTPUT=$(bash "$MAINTAIN_SH" --scheduled --force 2>&1 || true)

    if echo "$OUTPUT" | grep -qiE "scheduled maintenance|running.*maintenance|force"; then
        pass "--scheduled --force runs despite recent timestamp"
    else
        fail "--scheduled --force did not run (output: $OUTPUT)"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Run all tests
# ─────────────────────────────────────────────────────────────────────────────
echo "=== maintain.sh --scheduled Tests ==="
test_scheduled_first_run
test_scheduled_skips_recent
test_scheduled_runs_when_due
test_scheduled_checks_t3_skills
test_scheduled_security_evolve
test_scheduled_force

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
