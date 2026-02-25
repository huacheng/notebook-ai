#!/usr/bin/env bash
# L2: Functional test for init sub-command
# Verifies directory creation, branch safety, and metadata integrity.

source "$(dirname "$0")/lib.sh"

INIT_SH="$TASK_AI_ROOT/skills/init/scripts/init.sh"
TEST_PROJECT="test-project"
TEST_NB="functional-test-$(date +%s)"
CURRENT_BRANCH=$(git branch --show-current)

# --- Test 1: Successful Initialization ---
export NB_WORKSPACES_ROOT="/tmp/task-ai-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT"

"$INIT_SH" "$TEST_PROJECT" "$TEST_NB" --title "Functional Test" --tags "test,qa" > /dev/null

if [[ -f "$NB_WORKSPACES_ROOT/$TEST_PROJECT/$TEST_NB/.working/.index.json" ]]; then
    emit_pass "init: successfully created metadata and directory"
else
    emit_fail "init: failed to create metadata"
fi

# Check branch creation
if git branch --list "task/$TEST_NB" | grep -q "$TEST_NB"; then
    emit_pass "init: successfully created git branch"
else
    emit_fail "init: failed to create git branch"
fi

# --- Test 2: Negative Test - Directory Collision ---
# Try to init the same name again
OUTPUT=$("$INIT_SH" "$TEST_PROJECT" "$TEST_NB" 2>&1)
if echo "$OUTPUT" | grep -q "Directory already exists"; then
    emit_pass "init: correctly blocked directory collision"
else
    emit_fail "init: failed to block directory collision"
fi

# --- Test 3: Negative Test - Branch Collision ---
# Try to init with a name that has an existing branch but no directory
git checkout "$CURRENT_BRANCH" > /dev/null 2>&1
DUPLICATE_BRANCH="task/branch-clash"
git branch "$DUPLICATE_BRANCH" > /dev/null 2>&1

OUTPUT=$("$INIT_SH" "$TEST_PROJECT" "branch-clash" 2>&1)
if echo "$OUTPUT" | grep -q "Git branch already exists"; then
    emit_pass "init: correctly blocked branch collision"
else
    emit_fail "init: failed to block branch collision"
fi

# --- Test: init.sh builds tags JSON safely (no unquoted variable expansion) ---
INIT_SCRIPT="$TASK_AI_ROOT/skills/init/scripts/init.sh"
if grep -n 'echo \$2\|echo $2' "$INIT_SCRIPT" | grep -qv '^#'; then
  emit_fail "init: unquoted \$2 in tags construction — JSON injection risk"
else
  emit_pass "init: tags argument is properly quoted"
fi

# Cleanup
git checkout "$CURRENT_BRANCH" > /dev/null 2>&1
git branch -D "task/$TEST_NB" > /dev/null 2>&1
git branch -D "$DUPLICATE_BRANCH" > /dev/null 2>&1
rm -rf "$NB_WORKSPACES_ROOT"

summary
