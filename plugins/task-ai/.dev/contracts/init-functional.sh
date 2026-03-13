#!/usr/bin/env bash
# L2: Functional test for init sub-command
# Verifies directory creation, branch safety, and metadata integrity.
# Creates a temporary workspace with a test project (git repo).

source "$(dirname "$0")/lib.sh"

INIT_SH="$TASK_AI_ROOT/skills/init/scripts/init.sh"
TEST_PROJECT="test-project"
TEST_NB="functional-test-$(date +%s)"

# Create temporary workspace root
TEST_WS="/tmp/nb-init-func-ws-$$"
mkdir -p "$TEST_WS"

# Create test project as a git repository
TEST_PROJECT_DIR="$TEST_WS/$TEST_PROJECT"
mkdir -p "$TEST_PROJECT_DIR"
git -C "$TEST_PROJECT_DIR" init --initial-branch=master > /dev/null 2>&1
git -C "$TEST_PROJECT_DIR" config user.email "test@test.com"
git -C "$TEST_PROJECT_DIR" config user.name "Test"
# Create initial commit so branch operations work
echo "# Test Project" > "$TEST_PROJECT_DIR/README.md"
git -C "$TEST_PROJECT_DIR" add README.md
git -C "$TEST_PROJECT_DIR" commit -m "initial commit" > /dev/null 2>&1

export NB_WORKSPACES_ROOT="$TEST_WS"
trap 'rm -rf "$TEST_WS"' EXIT

# --- Test 1: Successful Initialization ---
"$INIT_SH" "$TEST_PROJECT" "$TEST_NB" --title "Functional Test" --tags "test,qa" > /dev/null 2>&1

if [[ -f "$TEST_PROJECT_DIR/.worktrees/task-$TEST_NB/.working/.status.json" ]]; then
    emit_pass "init: successfully created metadata and directory"
else
    emit_fail "init: failed to create metadata"
fi

# Check branch creation
if git -C "$TEST_PROJECT_DIR" branch --list "task/$TEST_NB" | grep -q "$TEST_NB"; then
    emit_pass "init: successfully created git branch"
else
    emit_fail "init: failed to create git branch"
fi

# --- Test 2: Negative Test - Directory Collision ---
OUTPUT=$("$INIT_SH" "$TEST_PROJECT" "$TEST_NB" 2>&1)
if echo "$OUTPUT" | grep -q "Directory already exists"; then
    emit_pass "init: correctly blocked directory collision"
else
    emit_fail "init: failed to block directory collision"
fi

# --- Test 3: Negative Test - Branch Collision ---
DUPLICATE_BRANCH="task/branch-clash"
git -C "$TEST_PROJECT_DIR" branch "$DUPLICATE_BRANCH" > /dev/null 2>&1

OUTPUT=$("$INIT_SH" "$TEST_PROJECT" "branch-clash" 2>&1)
if echo "$OUTPUT" | grep -q "Git branch already exists"; then
    emit_pass "init: correctly blocked branch collision"
else
    emit_fail "init: failed to block branch collision"
fi

# --- Test 4: Negative Test - Invalid Project (no .git) ---
mkdir -p "$TEST_WS/not-a-repo"
OUTPUT=$("$INIT_SH" "not-a-repo" "some-notebook" 2>&1)
if echo "$OUTPUT" | grep -q "not a git repository"; then
    emit_pass "init: correctly rejected non-git project"
else
    emit_fail "init: failed to reject non-git project"
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

summary
