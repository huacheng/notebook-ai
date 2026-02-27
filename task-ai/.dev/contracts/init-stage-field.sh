#!/usr/bin/env bash
# L2: Verify init creates .index.json with stage field (progressive target v1)
#
# Tests:
#   1. .index.json has "stage" key after init
#   2. stage.current == 1
#   3. stage.total == 1
#   4. stage.completed == []
#   5. stage has no highlight_file in completed entries

source "$(dirname "$0")/lib.sh"

INIT_SH="$TASK_AI_ROOT/skills/init/scripts/init.sh"
TEST_PROJECT="test-stage"
TEST_NB="stage-init-$(date +%s)"
CURRENT_BRANCH=$(git branch --show-current)

export NB_WORKSPACES_ROOT="/tmp/task-ai-stage-test"
trap 'git checkout "$CURRENT_BRANCH" 2>/dev/null; git branch -D "task/$TEST_NB" 2>/dev/null; rm -rf "$NB_WORKSPACES_ROOT"' EXIT
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$NB_WORKSPACES_ROOT"

# Run init
"$INIT_SH" "$TEST_PROJECT" "$TEST_NB" --title "Stage Test" > /dev/null 2>&1

INDEX_FILE="$NB_WORKSPACES_ROOT/$TEST_PROJECT/$TEST_NB/.working/.index.json"

if [[ ! -f "$INDEX_FILE" ]]; then
    emit_fail "init: .index.json not created"
    summary
    exit $?
fi

# --- Test 1: stage key exists ---
if python3 -c "
import json, sys
data = json.load(open('$INDEX_FILE'))
sys.exit(0 if 'stage' in data else 1)
"; then
    emit_pass "init: .index.json has 'stage' field"
else
    emit_fail "init: .index.json missing 'stage' field"
fi

# --- Test 2: stage.current == 1 ---
if python3 -c "
import json, sys
data = json.load(open('$INDEX_FILE'))
sys.exit(0 if data.get('stage', {}).get('current') == 1 else 1)
"; then
    emit_pass "init: stage.current == 1"
else
    emit_fail "init: stage.current != 1"
fi

# --- Test 3: stage.total == 1 ---
if python3 -c "
import json, sys
data = json.load(open('$INDEX_FILE'))
sys.exit(0 if data.get('stage', {}).get('total') == 1 else 1)
"; then
    emit_pass "init: stage.total == 1"
else
    emit_fail "init: stage.total != 1"
fi

# --- Test 4: stage.completed == [] ---
if python3 -c "
import json, sys
data = json.load(open('$INDEX_FILE'))
sys.exit(0 if data.get('stage', {}).get('completed') == [] else 1)
"; then
    emit_pass "init: stage.completed == []"
else
    emit_fail "init: stage.completed != []"
fi

# --- Test 5: no highlight_file anywhere in stage ---
if python3 -c "
import json, sys
data = json.load(open('$INDEX_FILE'))
text = json.dumps(data.get('stage', {}))
sys.exit(1 if 'highlight_file' in text else 0)
"; then
    emit_pass "init: stage has no highlight_file field"
else
    emit_fail "init: stage unexpectedly contains highlight_file"
fi

# Cleanup
git checkout "$CURRENT_BRANCH" > /dev/null 2>&1
git branch -D "task/$TEST_NB" > /dev/null 2>&1

summary
