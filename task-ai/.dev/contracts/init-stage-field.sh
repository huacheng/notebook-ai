#!/usr/bin/env bash
# L2: Verify init creates .status.json with stage field (progressive target v1)
# Runs init.sh inside a temporary git worktree to avoid checkout on the main working tree.
#
# Tests:
#   1. .status.json has "stage" key after init
#   2. stage.current == 1
#   3. stage has no 'total' field (progressive evolution)
#   4. stage.history == []
#   5. stage has no highlight_file in completed entries

source "$(dirname "$0")/lib.sh"

INIT_SH="$TASK_AI_ROOT/skills/init/scripts/init.sh"
TEST_PROJECT="test-stage"
TEST_NB="stage-init-$(date +%s)"

# Create a temporary worktree so init.sh's git checkout doesn't touch the main tree
TEST_WT="/tmp/nb-init-stage-wt-$$"
git worktree add --detach "$TEST_WT" HEAD > /dev/null 2>&1

export NB_WORKSPACES_ROOT="$TEST_WT"
trap 'git worktree remove "$TEST_WT" --force 2>/dev/null; git branch -D "task/$TEST_NB" 2>/dev/null' EXIT

# Run init inside the worktree
(cd "$TEST_WT" && "$INIT_SH" "$TEST_PROJECT" "$TEST_NB" --title "Stage Test") > /dev/null 2>&1

STATUS_FILE="$NB_WORKSPACES_ROOT/$TEST_PROJECT/$TEST_NB/.working/.status.json"

if [[ ! -f "$STATUS_FILE" ]]; then
    emit_fail "init: .status.json not created"
    summary
    exit $?
fi

# --- Test 1: stage key exists ---
if python3 -c "
import json, sys
data = json.load(open('$STATUS_FILE'))
sys.exit(0 if 'stage' in data else 1)
"; then
    emit_pass "init: .status.json has 'stage' field"
else
    emit_fail "init: .status.json missing 'stage' field"
fi

# --- Test 2: stage.current == 1 ---
if python3 -c "
import json, sys
data = json.load(open('$STATUS_FILE'))
sys.exit(0 if data.get('stage', {}).get('current') == 1 else 1)
"; then
    emit_pass "init: stage.current == 1"
else
    emit_fail "init: stage.current != 1"
fi

# --- Test 3: stage has no 'total' field (progressive evolution) ---
if python3 -c "
import json, sys
data = json.load(open('$STATUS_FILE'))
sys.exit(0 if 'total' not in data.get('stage', {}) else 1)
"; then
    emit_pass "init: stage has no total field"
else
    emit_fail "init: stage unexpectedly has total field"
fi

# --- Test 4: stage.history == [] ---
if python3 -c "
import json, sys
data = json.load(open('$STATUS_FILE'))
sys.exit(0 if data.get('stage', {}).get('history') == [] else 1)
"; then
    emit_pass "init: stage.history == []"
else
    emit_fail "init: stage.history != []"
fi

# --- Test 5: no highlight_file anywhere in stage ---
if python3 -c "
import json, sys
data = json.load(open('$STATUS_FILE'))
text = json.dumps(data.get('stage', {}))
sys.exit(1 if 'highlight_file' in text else 0)
"; then
    emit_pass "init: stage has no highlight_file field"
else
    emit_fail "init: stage unexpectedly contains highlight_file"
fi

# Cleanup (also covered by trap)
git worktree remove "$TEST_WT" --force 2>/dev/null
git branch -D "task/$TEST_NB" > /dev/null 2>&1

summary
