#!/bin/bash
# Test: Skill hot-reload setup
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOTRELOAD_SH="$TASK_AI_ROOT/core/skill-hotreload.sh"
ALIASES_SH="$TASK_AI_ROOT/core/shell-aliases.sh"

FAILED=0

# Test 1: skill-hotreload.sh exists and is executable
if [[ ! -x "$HOTRELOAD_SH" ]]; then
    echo "FAIL: skill-hotreload.sh not executable"
    ((FAILED++)) || true
fi

# Test 2: shell-aliases.sh exists
if [[ ! -f "$ALIASES_SH" ]]; then
    echo "FAIL: shell-aliases.sh not found"
    ((FAILED++)) || true
fi

# Test 3: skill-hotreload.sh has required functions
required_functions=(
    "init_workspace_skills"
    "get_adddir_arg"
    "launch_with_hotreload"
    "list_workspace_skills"
    "create_workspace_skill"
    "promote_skill"
)

for func in "${required_functions[@]}"; do
    if ! grep -q "^${func}()" "$HOTRELOAD_SH"; then
        echo "FAIL: Missing function: $func"
        ((FAILED++)) || true
    fi
done

# Test 4: shell-aliases.sh defines task-ai-dev
if ! grep -q "task-ai-dev()" "$ALIASES_SH"; then
    echo "FAIL: task-ai-dev function not defined"
    ((FAILED++)) || true
fi

# Test 5: shell-aliases.sh references --add-dir
if ! grep -q '\-\-add-dir' "$ALIASES_SH"; then
    echo "FAIL: --add-dir not used in aliases"
    ((FAILED++)) || true
fi

# Test 6: Reference documentation exists
if [[ ! -f "$TASK_AI_ROOT/skills/library/references/skill-hotreload.md" ]]; then
    echo "FAIL: skill-hotreload.md reference not found"
    ((FAILED++)) || true
fi

# Test 7: init_workspace_skills creates correct structure (functional test)
TEST_TMP=$(mktemp -d)
trap "rm -rf $TEST_TMP" EXIT

export NB_WORKSPACES_LIBRARY="$TEST_TMP/.library"
export NB_WORKSPACES_ROOT="$TEST_TMP"

# Run init
bash "$HOTRELOAD_SH" init >/dev/null 2>&1

if [[ ! -d "$NB_WORKSPACES_LIBRARY/skills" ]]; then
    echo "FAIL: init did not create skills directory"
    ((FAILED++)) || true
fi

if [[ ! -d "$NB_WORKSPACES_LIBRARY/skills/.drafts" ]]; then
    echo "FAIL: init did not create .drafts directory"
    ((FAILED++)) || true
fi

if [[ ! -d "$NB_WORKSPACES_LIBRARY/skills/.candidates" ]]; then
    echo "FAIL: init did not create .candidates directory"
    ((FAILED++)) || true
fi

if [[ ! -f "$NB_WORKSPACES_LIBRARY/skills/README.md" ]]; then
    echo "FAIL: init did not create README.md"
    ((FAILED++)) || true
fi

# Test 8: create_workspace_skill creates valid structure
bash "$HOTRELOAD_SH" create test-skill "Test skill description" >/dev/null 2>&1

if [[ ! -f "$NB_WORKSPACES_LIBRARY/skills/test-skill/SKILL.md" ]]; then
    echo "FAIL: create did not create SKILL.md"
    ((FAILED++)) || true
fi

# Verify SKILL.md has valid frontmatter
if ! grep -q "^name: test-skill$" "$NB_WORKSPACES_LIBRARY/skills/test-skill/SKILL.md"; then
    echo "FAIL: SKILL.md missing name field"
    ((FAILED++)) || true
fi

if ! grep -q "^description: Test skill description$" "$NB_WORKSPACES_LIBRARY/skills/test-skill/SKILL.md"; then
    echo "FAIL: SKILL.md missing description field"
    ((FAILED++)) || true
fi

# Test 9: list_workspace_skills shows created skill
list_output=$(bash "$HOTRELOAD_SH" list 2>&1)
if ! echo "$list_output" | grep -q "test-skill"; then
    echo "FAIL: list does not show created skill"
    ((FAILED++)) || true
fi

# Test 10: adddir outputs correct format
adddir_output=$(bash "$HOTRELOAD_SH" adddir 2>&1)
if ! echo "$adddir_output" | grep -qE '\-\-add-dir.*skills'; then
    echo "FAIL: adddir output incorrect format"
    ((FAILED++)) || true
fi

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: All skill-hotreload tests passed"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
