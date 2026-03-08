#!/usr/bin/env bash
# Test: rebuild-index.py scans .skills/ directories
# RED/GREEN TDD: skills in .candidates/, .drafts/, .active/ should appear in indexes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REBUILD_INDEX_PY="$TASK_AI_ROOT/skills/library/scripts/rebuild-index.py"

PASS=0
FAIL=0
pass() { echo "✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "✗ $1" >&2; FAIL=$((FAIL + 1)); }

# ─────────────────────────────────────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────────────────────────────────────
setup() {
    TEST_DIR=$(mktemp -d)
    export NB_WORKSPACES_LIBRARY="$TEST_DIR"

    # Create standard memory dirs
    mkdir -p "$TEST_DIR/.memory/.references"
    mkdir -p "$TEST_DIR/.memory/.experiences"

    # Create skills in all three tiers
    mkdir -p "$TEST_DIR/.skills/.candidates/skill-alpha"
    cat > "$TEST_DIR/.skills/.candidates/skill-alpha/SKILL.md" <<'EOF'
---
name: skill-alpha
trust_tier: T1
topic: Alpha Skill
type: utility
keywords: [alpha, test]
---
# /skill-alpha
A candidate skill.
EOF

    mkdir -p "$TEST_DIR/.skills/.drafts/skill-beta"
    cat > "$TEST_DIR/.skills/.drafts/skill-beta/SKILL.md" <<'EOF'
---
name: skill-beta
trust_tier: T2
topic: Beta Skill
type: automation
keywords: [beta, draft]
---
# /skill-beta
A draft skill.
EOF

    mkdir -p "$TEST_DIR/.skills/.active/skill-gamma"
    cat > "$TEST_DIR/.skills/.active/skill-gamma/SKILL.md" <<'EOF'
---
name: skill-gamma
trust_tier: T4
topic: Gamma Skill
type: workflow
keywords: [gamma, active]
---
# /skill-gamma
An active production-validated skill.
EOF
}

teardown() {
    rm -rf "$TEST_DIR"
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 1: Skills appear in master index
# ─────────────────────────────────────────────────────────────────────────────
test_skills_in_master_index() {
    setup

    python3 "$REBUILD_INDEX_PY" 2>&1

    MASTER="$TEST_DIR/.master-index.md"
    if [[ ! -f "$MASTER" ]]; then
        fail "Master index not created"
        teardown
        return
    fi

    local ok=true
    for name in skill-alpha skill-beta skill-gamma; do
        if ! grep -q "$name" "$MASTER"; then
            fail "Master index missing $name"
            ok=false
        fi
    done
    if [[ "$ok" == "true" ]]; then
        pass "All three skills appear in master index"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 2: .skills/ has its own .index.md
# ─────────────────────────────────────────────────────────────────────────────
test_skills_index_created() {
    setup

    python3 "$REBUILD_INDEX_PY" 2>&1

    INDEX="$TEST_DIR/.skills/.index.md"
    if [[ -f "$INDEX" ]]; then
        pass ".skills/.index.md created"
    else
        fail ".skills/.index.md not created"
        teardown
        return
    fi

    # Should contain all three skills
    local count
    count=$(grep -c "skill-" "$INDEX" || echo 0)
    if [[ "$count" -ge 3 ]]; then
        pass ".skills/.index.md contains all 3 skills"
    else
        fail ".skills/.index.md has only $count skill entries (expected >= 3)"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 3: Skill tier info appears in index
# ─────────────────────────────────────────────────────────────────────────────
test_skill_tier_in_index() {
    setup

    python3 "$REBUILD_INDEX_PY" 2>&1

    MASTER="$TEST_DIR/.master-index.md"
    if grep -q "\.candidates/" "$MASTER" && grep -q "\.active/" "$MASTER"; then
        pass "Master index includes tier directory paths"
    else
        fail "Master index missing tier directory paths"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 4: Existing memory indexes still work alongside skills
# ─────────────────────────────────────────────────────────────────────────────
test_memory_and_skills_coexist() {
    setup

    # Add a reference file
    cat > "$TEST_DIR/.memory/.references/api-docs.md" <<'EOF'
---
topic: API Documentation
type: reference
keywords: [api, docs]
---
# API Docs
EOF

    python3 "$REBUILD_INDEX_PY" 2>&1

    MASTER="$TEST_DIR/.master-index.md"
    if grep -q "api-docs" "$MASTER" && grep -q "skill-gamma" "$MASTER"; then
        pass "Master index contains both references and skills"
    else
        fail "Master index missing references or skills"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Run all tests
# ─────────────────────────────────────────────────────────────────────────────
echo "=== rebuild-index.py .skills/ Scan Tests ==="
test_skills_in_master_index
test_skills_index_created
test_skill_tier_in_index
test_memory_and_skills_coexist

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
