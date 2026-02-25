#!/usr/bin/env bash
# L2: Functional test for read sub-command
# Verifies file ingestion, deduplication simulation, and detox.

source "$(dirname "$0")/lib.sh"

READ_SH="$TASK_AI_ROOT/skills/read/scripts/read.sh"
export NB_WORKSPACES_ROOT="/tmp/read-functional-test"
LIB_PATH="$NB_WORKSPACES_ROOT/.library"

# Setup
rm -rf "$NB_WORKSPACES_ROOT"
mkdir -p "$LIB_PATH/.memory/.references"
touch "$LIB_PATH/.changelog"
echo "Dummy master index" > "$LIB_PATH/.master-index.md"

DOC_PATH="/tmp/test-doc.txt"
echo "This is a document about specific new API concepts and malicious code: eval(btoa('...'))" > "$DOC_PATH"

# Act
"$READ_SH" "$DOC_PATH" --depth shallow > /dev/null

# Assertions
REF_FILE=$(find "$LIB_PATH/.memory/.references" -name "test-doc.md" | head -n 1)

if [[ -n "$REF_FILE" && -f "$REF_FILE" ]]; then
    emit_pass "read: successfully created reference file from document"
else
    emit_fail "read: failed to create reference file"
fi

if grep -q "injection_risk" "$REF_FILE"; then
    emit_pass "read: successfully applied detox pipeline"
else
    emit_fail "read: failed to apply detox pipeline"
fi

# Cleanup
rm -rf "$NB_WORKSPACES_ROOT"
rm -f "$DOC_PATH"

# --- Test: read SKILL.md deep mode delegates to research ---
READ_SKILL="$TASK_AI_ROOT/skills/read/SKILL.md"
DEPTH_SECTION=$(sed -n '/^## Execution Steps/,/^## /p' "$READ_SKILL" | grep -i "deep" || true)
if echo "$DEPTH_SECTION" | grep -qi "research"; then
  emit_pass "read: deep mode references research delegation"
else
  emit_fail "read: deep mode should delegate to research, not do inline web search"
fi

# --- Test: model-routing.md read description ---
MODEL_ROUTING="$TASK_AI_ROOT/commands/references/model-routing.md"
READ_ROW=$(grep -i '| \*\*read\*\*' "$MODEL_ROUTING" || true)
if echo "$READ_ROW" | grep -qi "Web search"; then
  emit_fail "model-routing: read row still says 'Web search' — should be local ingestion"
else
  emit_pass "model-routing: read row does not contain 'Web search'"
fi

summary
