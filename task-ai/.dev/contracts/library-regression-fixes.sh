#!/usr/bin/env bash
# L2: Regression Tests for Library Fixes
# 1. Grep Injection Protection
# 2. Multi-line YAML List Parsing
# 3. Robust Keyword/Field Parsing

source "$(dirname "$0")/lib.sh"

# Use temp directory for testing to avoid /.library access errors
export NB_WORKSPACES_ROOT="/tmp/task-ai-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT
LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT}/.library}"
SEARCH_SH="$TASK_AI_ROOT/skills/library/scripts/search.sh"
REBUILD_REL_PY="$TASK_AI_ROOT/skills/library/scripts/rebuild-relations.py"
MAINTAIN_SH="$TASK_AI_ROOT/skills/library/scripts/maintain.sh"

# Ensure LIB_PATH exists
mkdir -p "$LIB_PATH/.memory/.references"
touch "$LIB_PATH/.relations.jsonl"
touch "$LIB_PATH/.master-index.md"

# --- Test 1: Grep Injection Protection ---
# If search.sh is insecure, query ".*" would match everything.
# If secure (grep -F), it matches nothing (unless literal ".*" exists).
INJECTION_QUERY=".*"
OUTPUT=$("$SEARCH_SH" "$INJECTION_QUERY" 2>&1)
if echo "$OUTPUT" | grep -q "| Topic |"; then
    # It matched the header row, which means it's treating .* as regex
    emit_fail "search: failed injection protection (matched header with '.*')"
else
    emit_pass "search: injection protection verified (treated '.*' as literal)"
fi

# --- Test 2: Multi-line YAML List Parsing ---
# Create a file with multi-line list
YAML_TEST_FILE="$LIB_PATH/.memory/.references/yaml-list-test.md"
cat > "$YAML_TEST_FILE" <<EOF
---
topic: yaml-list-test
related_references:
  - item-alpha
  - item-beta
---
# YAML List Test
EOF

# Run relations rebuild
python3 "$REBUILD_REL_PY" > /dev/null

# Check if both items are in relations.jsonl
if grep -q "item-alpha" "$LIB_PATH/.relations.jsonl" && grep -q "item-beta" "$LIB_PATH/.relations.jsonl"; then
    emit_pass "parsing: multi-line YAML list correctly extracted"
else
    emit_fail "parsing: failed to extract multi-line YAML list"
fi

# --- Test 3: Robust Keywords Parsing ---
# Create a file where keywords is a list
KEYWORD_TEST_FILE="$LIB_PATH/.memory/.references/keyword-test.md"
cat > "$KEYWORD_TEST_FILE" <<EOF
---
topic: keyword-test
keywords:
  - security
  - hardening
---
# Keyword Test
EOF

# Run maintain --rebuild-index
"$MAINTAIN_SH" --rebuild-index > /dev/null

# Verify keywords are flattened into master index
if grep -q "security, hardening" "$LIB_PATH/.master-index.md"; then
    emit_pass "parsing: robustly handled list-style keywords"
else
    emit_fail "parsing: failed to flatten list-style keywords in index"
fi

# Cleanup
rm "$YAML_TEST_FILE" "$KEYWORD_TEST_FILE"
# Re-run maintain to clean up indices
"$MAINTAIN_SH" --rebuild-index --rebuild-relations > /dev/null

summary
