#!/usr/bin/env bash
# L2: Functional test for init sub-command
# Verifies directory creation, branch safety, and metadata integrity.
# Runs init.sh inside a temporary git worktree to avoid checkout on the main working tree.

source "$(dirname "$0")/lib.sh"

INIT_SH="$TASK_AI_ROOT/skills/init/scripts/init.sh"
TEST_PROJECT="test-project"
TEST_NB="functional-test-$(date +%s)"

# Create a temporary worktree so init.sh's git checkout doesn't touch the main tree
TEST_WT="/tmp/nb-init-func-wt-$$"
git worktree add --detach "$TEST_WT" HEAD > /dev/null 2>&1

export NB_WORKSPACES_ROOT="$TEST_WT"
trap 'git worktree remove "$TEST_WT" --force 2>/dev/null; git branch -D "task/$TEST_NB" 2>/dev/null; git branch -D "task/branch-clash" 2>/dev/null' EXIT

# --- Test 1: Successful Initialization ---
(cd "$TEST_WT" && "$INIT_SH" "$TEST_PROJECT" "$TEST_NB" --title "Functional Test" --tags "test,qa") > /dev/null 2>&1

if [[ -f "$NB_WORKSPACES_ROOT/$TEST_PROJECT/.worktrees/task-$TEST_NB/.working/.status.json" ]]; then
    emit_pass "init: successfully created metadata and directory"
else
    emit_fail "init: failed to create metadata"
fi

# Check branch creation (branches are shared across worktrees)
if git branch --list "task/$TEST_NB" | grep -q "$TEST_NB"; then
    emit_pass "init: successfully created git branch"
else
    emit_fail "init: failed to create git branch"
fi

# --- Test 2: Negative Test - Directory Collision ---
OUTPUT=$( (cd "$TEST_WT" && "$INIT_SH" "$TEST_PROJECT" "$TEST_NB") 2>&1 )
if echo "$OUTPUT" | grep -q "Directory already exists"; then
    emit_pass "init: correctly blocked directory collision"
else
    emit_fail "init: failed to block directory collision"
fi

# --- Test 3: Negative Test - Branch Collision ---
DUPLICATE_BRANCH="task/branch-clash"
git branch "$DUPLICATE_BRANCH" > /dev/null 2>&1

OUTPUT=$( (cd "$TEST_WT" && "$INIT_SH" "$TEST_PROJECT" "branch-clash") 2>&1 )
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

# --- Test: init.sh escapes $TITLE before JSON injection ---
if grep -n '"title": "\$TITLE"' "$INIT_SH" | grep -qv '^#'; then
  emit_fail "init: raw \$TITLE in JSON heredoc — quotes/backslashes break JSON"
else
  emit_pass "init: \$TITLE is escaped or sanitized before JSON injection"
fi

# Cleanup (also covered by trap)
git worktree remove "$TEST_WT" --force 2>/dev/null
git branch -D "task/$TEST_NB" > /dev/null 2>&1
git branch -D "$DUPLICATE_BRANCH" > /dev/null 2>&1

summary
