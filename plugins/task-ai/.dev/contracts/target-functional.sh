#!/usr/bin/env bash
# L2: Functional test for target sub-command
# Verifies writing and reading task objectives in .target.md.

source "$(dirname "$0")/lib.sh"

TARGET_SH="$TASK_AI_ROOT/skills/target/scripts/target.sh"
INIT_SH="$TASK_AI_ROOT/skills/init/scripts/init.sh"
TEST_PROJECT="test-project"
TEST_NB="target-test-$(date +%s)"
export NB_WORKSPACES_ROOT="/tmp/task-ai-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT

# Setup: Create a notebook
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT/$TEST_PROJECT"
cd "$NB_WORKSPACES_ROOT/$TEST_PROJECT" || exit 1
git init > /dev/null
git config user.email "test@example.com"
git config user.name "Test User"
git commit --allow-empty -m "Initial commit" > /dev/null

"$INIT_SH" "$TEST_PROJECT" "$TEST_NB" --title "Initial Title" > /dev/null

# Move to the notebook directory for context
cd "$TEST_NB" || exit 1

# --- Test 1: Write Mode (Update Objective) ---
if [[ ! -f "$TARGET_SH" ]]; then
    emit_fail "target: target.sh script missing (Expected Red)"
else
    "$TARGET_SH" "New Objective Content" > /dev/null
    if grep -q "New Objective Content" ".working/.target.md"; then
        emit_pass "target: successfully updated .target.md"
    else
        emit_fail "target: failed to update .target.md"
    fi

    # Check for git commit
    if git log -n 1 --oneline | grep -q "target update objective"; then
        emit_pass "target: successfully committed changes"
    else
        emit_fail "target: missing git commit"
    fi
fi

# --- Test 2: Read Mode (Show Objective) ---
if [[ -f "$TARGET_SH" ]]; then
    OUTPUT=$("$TARGET_SH")
    if echo "$OUTPUT" | grep -q "New Objective Content"; then
        emit_pass "target: successfully read .target.md"
    else
        emit_fail "target: failed to read .target.md"
    fi
fi

# --- Test 3: Context Awareness (Sub-directory) ---
mkdir -p src
cd src || exit 1
if [[ -f "$TARGET_SH" ]]; then
    OUTPUT=$("$TARGET_SH")
    if echo "$OUTPUT" | grep -q "New Objective Content"; then
        emit_pass "target: correctly identified context from sub-directory"
    else
        emit_fail "target: failed context awareness in sub-directory"
    fi
fi

# --- Test: target.sh does not pass raw user input to awk -v ---
TARGET_SCRIPT="$TASK_AI_ROOT/skills/target/scripts/target.sh"
if grep -n 'awk.*-v.*\$OBJECTIVE\|awk.*-v.*"\$1"' "$TARGET_SCRIPT" | grep -qv '^#'; then
  emit_fail "target: passes raw user input to awk -v — backslash/newline injection risk"
else
  emit_pass "target: awk does not receive raw user input via -v"
fi

# Cleanup
git checkout master > /dev/null 2>&1
git branch -D "task/$TEST_NB" > /dev/null 2>&1
rm -rf "$NB_WORKSPACES_ROOT"

summary
