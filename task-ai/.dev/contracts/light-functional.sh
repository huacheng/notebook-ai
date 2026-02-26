#!/usr/bin/env bash
# L2: Functional test for light sub-command (refactored — inline operation on current branch)
# Verifies: commit helper, context discovery, no shadow branch, no light-exec state.

source "$(dirname "$0")/lib.sh"

LIGHT_SH="$TASK_AI_ROOT/skills/light/scripts/light.sh"
STATE_PY="$TASK_AI_ROOT/core/state.py"
LIGHT_SKILL="$TASK_AI_ROOT/skills/light/SKILL.md"
EXPECTED_STATES="$DEV_ROOT/fixtures/expected-states.json"

export NB_WORKSPACES_ROOT="/tmp/task-ai-light-test-$$"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT

# --- Setup: Git repo with a notebook context ---
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT/test-project/my-notebook/.working"
cd "$NB_WORKSPACES_ROOT/test-project" || exit 1
git init > /dev/null 2>&1
git config user.email "test@example.com"
git config user.name "Test User"
echo '{}' > my-notebook/.working/.index.json
git add -A && git commit -m "Initial commit" > /dev/null 2>&1

# ============================================================
# Test 1: Commit in notebook context — correct message format
# ============================================================
cd "$NB_WORKSPACES_ROOT/test-project/my-notebook" || exit 1
echo "hello" > README.md
git add README.md

"$LIGHT_SH" --commit "fix typo in README" > /dev/null 2>&1
COMMIT_MSG=$(git log -1 --format=%s)
EXPECTED="task-ai(my-notebook):light fix typo in README"
if [[ "$COMMIT_MSG" == "$EXPECTED" ]]; then
    emit_pass "light --commit: correct message format in notebook context"
else
    emit_fail "light --commit: expected '$EXPECTED', got '$COMMIT_MSG'"
fi

# ============================================================
# Test 2: Commit at git root (no notebook context) — fallback scope
# ============================================================
cd "$NB_WORKSPACES_ROOT/test-project" || exit 1
echo "world" > file.txt
git add file.txt

"$LIGHT_SH" --commit "add file" > /dev/null 2>&1
COMMIT_MSG=$(git log -1 --format=%s)
EXPECTED="task-ai(test-project):light add file"
if [[ "$COMMIT_MSG" == "$EXPECTED" ]]; then
    emit_pass "light --commit: correct fallback scope at git root"
else
    emit_fail "light --commit: expected '$EXPECTED', got '$COMMIT_MSG'"
fi

# ============================================================
# Test 3: --commit with nothing staged — should fail gracefully
# ============================================================
OUTPUT=$("$LIGHT_SH" --commit "empty commit" 2>&1)
RC=$?
if [[ $RC -ne 0 ]]; then
    emit_pass "light --commit: exits non-zero when nothing to commit"
else
    emit_fail "light --commit: should fail when nothing staged"
fi

# ============================================================
# Test 4: SKILL.md does NOT contain old shadow-task concepts
# ============================================================
OLD_CONCEPTS=("shadow branch" "shadow task" "\\-\\-finish" "\\-\\-promote" "\\-\\-status" "light-exec" "squash merge" ".light-tasks.jsonl")
for concept in "${OLD_CONCEPTS[@]}"; do
    if grep -qi -- "$concept" "$LIGHT_SKILL"; then
        emit_fail "SKILL.md: still contains old concept '${concept//\\/}'"
    else
        emit_pass "SKILL.md: no reference to '${concept//\\/}'"
    fi
done

# ============================================================
# Test 5: SKILL.md contains new expected concepts
# ============================================================
NEW_CONCEPTS=("current branch" "\\-\\-commit" "description")
for concept in "${NEW_CONCEPTS[@]}"; do
    if grep -qi -- "$concept" "$LIGHT_SKILL"; then
        emit_pass "SKILL.md: contains expected concept '${concept//\\/}'"
    else
        emit_fail "SKILL.md: missing expected concept '${concept//\\/}'"
    fi
done

# ============================================================
# Test 6: light-exec NOT in state.py VALID_STATUSES
# ============================================================
if grep -q 'light-exec' "$STATE_PY"; then
    emit_fail "state.py: still contains light-exec"
else
    emit_pass "state.py: light-exec removed"
fi

# ============================================================
# Test 7: light-exec NOT in expected-states.json
# ============================================================
if grep -q 'light-exec' "$EXPECTED_STATES"; then
    emit_fail "expected-states.json: still contains light-exec"
else
    emit_pass "expected-states.json: light-exec removed"
fi

# ============================================================
# Test 8: No light-exec anywhere in task-ai/
# ============================================================
RESIDUAL=$(grep -r 'light-exec' "$TASK_AI_ROOT" --include="*.py" --include="*.json" --include="*.sh" --include="*.md" -l 2>/dev/null | grep -v '.dev/contracts/light-functional.sh' || true)
if [[ -z "$RESIDUAL" ]]; then
    emit_pass "no light-exec residual in task-ai/"
else
    emit_fail "light-exec residual found in: $RESIDUAL"
fi

# ============================================================
# Test 9: light.sh accepts --commit with description
# ============================================================
cd "$NB_WORKSPACES_ROOT/test-project/my-notebook" || exit 1
echo "more content" >> README.md
git add README.md

"$LIGHT_SH" --commit "update readme" > /dev/null 2>&1
RC=$?
if [[ $RC -eq 0 ]]; then
    emit_pass "light.sh: --commit exits 0 on success"
else
    emit_fail "light.sh: --commit exited $RC on valid staged files"
fi

summary
