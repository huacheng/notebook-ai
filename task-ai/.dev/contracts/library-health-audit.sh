#!/usr/bin/env bash
# L2: Check Library Status/Audit Functionality
# Verifies that 'status' correctly identifies stale and orphan files.

source "$(dirname "$0")/lib.sh"

# Use temp directory for testing to avoid /.library access errors
export NB_WORKSPACES_ROOT="/tmp/task-ai-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT
LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT}/.library}"
STATUS_SH="$TASK_AI_ROOT/skills/library/scripts/status.sh"

if [[ ! -d "$LIB_PATH" ]]; then
    mkdir -p "$LIB_PATH/.memory/.references"
fi

if [[ ! -x "$STATUS_SH" ]]; then
    emit_fail "status.sh not executable or missing"
    summary
    exit 0
fi

# 1. Create a deliberate orphan file
ORPHAN_FILE="$LIB_PATH/.memory/.references/orphan-test.md"
# Create directory if missing
mkdir -p "$(dirname "$ORPHAN_FILE")"
cat > "$ORPHAN_FILE" <<EOF
---
topic: orphan-test
last_verified_at: 2020-01-01
---
# Orphan and Stale Test
EOF

# 2. Run status and capture output
OUTPUT=$("$STATUS_SH" 2>&1)

# 3. Check if ORPHAN was detected
if echo "$OUTPUT" | grep -q "orphan-test.md"; then
    emit_pass "status: correctly identified orphan file"
else
    emit_fail "status: failed to identify orphan file"
fi

# 4. Check if STALE was detected (since date is 2020)
if echo "$OUTPUT" | grep -q "\[STALE\]"; then
    emit_pass "status: correctly identified stale reference"
else
    emit_fail "status: failed to identify stale reference"
fi

# Cleanup
rm "$ORPHAN_FILE"

summary
