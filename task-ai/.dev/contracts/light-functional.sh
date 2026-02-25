#!/usr/bin/env bash
# L2: Functional test for light sub-command (Notebook-bound)
# Verifies shadow task lifecycle with transient notebook directory.

source "$(dirname "$0")/lib.sh"

LIGHT_SH="$TASK_AI_ROOT/skills/light/scripts/light.sh"
STATE_PY="$TASK_AI_ROOT/core/state.py"
TEST_PROJECT="test-project"
TEST_OBJ="Fix spelling"
export NB_WORKSPACES_ROOT="/tmp/task-ai-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT

# Setup: Create a project
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT/$TEST_PROJECT"
cd "$NB_WORKSPACES_ROOT/$TEST_PROJECT" || exit 1
git init > /dev/null
git config user.email "test@example.com"
git config user.name "Test User"
git commit --allow-empty -m "Initial commit" > /dev/null

# --- Test 1: Start Mode (Notebook-bound Start) ---
"$LIGHT_SH" "$TEST_PROJECT" "$TEST_OBJ" > /dev/null

# 1. Check if notebook directory exists
NB_DIR=$(find . -name "light-fix-spelling-*" -type d)
if [[ -d "$NB_DIR/.working" ]]; then
    emit_pass "light: created notebook directory"
else
    emit_fail "light: failed to create notebook directory"
fi

# 2. Check for shadow branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" =~ ^light/light-fix-spelling- ]]; then
    emit_pass "light: successfully switched to shadow branch"
else
    emit_fail "light: failed to switch branch (Current: $CURRENT_BRANCH)"
fi

# Move to the notebook directory for context before finishing
cd "$NB_DIR" || exit 1

# --- Test 2: Finish Mode ---
echo "Fixed typo" > README.md
git add README.md

# Move back to project root before finishing because the notebook dir will be deleted
cd ..
"$LIGHT_SH" --finish > /dev/null

# 1. Check if on master branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" == "master" ]]; then
    emit_pass "light: successfully returned to master"
else
    emit_fail "light: failed to return to master"
fi

# 2. Check for squash commit
if git log -n 1 --oneline | grep -q "task-ai($TEST_PROJECT):light $TEST_OBJ"; then
    emit_pass "light: successfully squash-merged changes"
else
    emit_fail "light: missing squash commit on master"
fi

# 3. Check if notebook directory is deleted
if [[ -z $(find . -name "light-fix-spelling-*" -type d) ]]; then
    emit_pass "light: successfully deleted transient notebook directory"
else
    emit_fail "light: failed to delete notebook directory after finish"
fi

# --- Test 3: Promote Mode ---
# Setup a fresh light task to promote
cd "$NB_WORKSPACES_ROOT/$TEST_PROJECT" || exit 1
"$LIGHT_SH" "$TEST_PROJECT" "Complex Fix" > /dev/null
NB_DIR=$(find . -name "light-complex-fix-*" -type d)
cd "$NB_DIR" || exit 1

"$LIGHT_SH" "--promote" > /dev/null

# 1. Check if mode flag is removed
INDEX_JSON=".working/.index.json"
MODE=$(python3 "$STATE_PY" get "$INDEX_JSON" mode)
if [[ "$MODE" != "light" ]]; then
    emit_pass "light: successfully removed light mode flag during promotion"
else
    emit_fail "light: failed to remove light mode flag"
fi

# 2. Check if branch is renamed to task/
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" =~ ^task/light-complex-fix- ]]; then
    emit_pass "light: successfully renamed branch to task/ prefix"
else
    emit_fail "light: failed to rename branch (Current: $CURRENT_BRANCH)"
fi

# 3. Check if status is planning
STATUS=$(python3 "$STATE_PY" get "$INDEX_JSON" status)
if [[ "$STATUS" == "planning" ]]; then
    emit_pass "light: status set to planning after promotion"
else
    emit_fail "light: failed to set status to planning"
fi

# --- Test 4: Threshold Detection ---
# Setup a fresh light task
cd "$NB_WORKSPACES_ROOT/$TEST_PROJECT" || exit 1
"$LIGHT_SH" "$TEST_PROJECT" "Bulk Update" > /dev/null
# Modify 4 files
touch file1 file2 file3 file4
git add file1 file2 file3 file4

OUTPUT=$("$LIGHT_SH" --status 2>&1)
if echo "$OUTPUT" | grep -q "Complexity warning: 4 files modified"; then
    emit_pass "light: correctly detected file modification threshold"
else
    emit_fail "light: failed to detect complexity threshold (Output: $OUTPUT)"
fi

# Cleanup
rm -rf "$NB_WORKSPACES_ROOT"

# --- Test: SKILL.md description contradiction ---
LIGHT_SKILL="$TASK_AI_ROOT/skills/light/SKILL.md"
FRONTMATTER=$(extract_frontmatter "$LIGHT_SKILL")
if echo "$FRONTMATTER" | grep -qi "No physical directory creation"; then
  emit_fail "light: description still says 'No physical directory creation' — contradicts init call"
else
  emit_pass "light: description does not claim 'No physical directory creation'"
fi

# --- Test: init only under promote ---
STEPS=$(extract_steps "$LIGHT_SKILL")
# Check that init call appears only inside promote section, not in start section
START_SECTION=$(echo "$STEPS" | sed -n '/Start shadow session/,/Promotion\|Finish/p')
if echo "$START_SECTION" | grep -qi '/moonview:init\|Call.*init'; then
  emit_fail "light: init appears in start section — should only be in promote"
else
  emit_pass "light: init not called unconditionally in start section"
fi

summary
