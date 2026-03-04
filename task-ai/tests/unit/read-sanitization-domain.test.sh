#!/bin/bash
# Test: read.sh loads rules from sanitization domain
# Red/Green TDD: read.sh should use .evolving-rules/sanitization/active/
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
READ_SH="$TASK_AI_ROOT/skills/read/scripts/read.sh"

FAILED=0
TEST_TMP=$(mktemp -d)
trap "rm -rf $TEST_TMP" EXIT

export NB_WORKSPACES_LIBRARY="$TEST_TMP/.library"
export NB_WORKSPACES_ROOT="$TEST_TMP"

echo "--- read.sh Sanitization Domain Tests ---"

# Test 1: read.sh references rule-loader.sh or sanitization domain
if grep -qE "rule-loader\.sh|evolving-rules/sanitization|load_rules_from_domain.*sanitization" "$READ_SH"; then
    echo "PASS: read.sh references sanitization domain"
else
    echo "FAIL: read.sh should reference sanitization domain or rule-loader.sh"
    ((FAILED++)) || true
fi

# Test 2: Dynamic sanitization rule is applied
mkdir -p "$NB_WORKSPACES_LIBRARY/.evolving-rules/sanitization/active"
mkdir -p "$NB_WORKSPACES_LIBRARY/.memory/.references"
cat > "$NB_WORKSPACES_LIBRARY/.evolving-rules/sanitization/active/custom-injection.yaml" <<'EOF'
id: CUSTOM-INJ-001
name: Custom injection pattern
pattern: "custom_evil_payload"
risk: high
enabled: true
EOF

# Create test file with custom injection pattern
TEST_FILE="$TEST_TMP/test-input.txt"
echo "This contains custom_evil_payload in the content" > "$TEST_FILE"

bash "$READ_SH" "$TEST_FILE" >/dev/null 2>&1 || true
REF_FILE="$NB_WORKSPACES_LIBRARY/.memory/.references/test-input.md"
if [[ -f "$REF_FILE" ]] && grep -q "injection_risk: high" "$REF_FILE"; then
    echo "PASS: Dynamic sanitization rule detected custom pattern"
else
    echo "FAIL: Dynamic sanitization rule should detect custom_evil_payload"
    ((FAILED++)) || true
fi

# Test 3: Hardcoded patterns still work (backward compatibility)
TEST_FILE2="$TEST_TMP/test-eval.txt"
echo 'eval("dangerous code")' > "$TEST_FILE2"

bash "$READ_SH" "$TEST_FILE2" >/dev/null 2>&1 || true
REF_FILE2="$NB_WORKSPACES_LIBRARY/.memory/.references/test-eval.md"
if [[ -f "$REF_FILE2" ]] && grep -q "injection_risk: high" "$REF_FILE2"; then
    echo "PASS: Hardcoded patterns still work"
else
    echo "FAIL: Hardcoded patterns should still detect eval()"
    ((FAILED++)) || true
fi

# Summary
echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "PASS: All read.sh sanitization tests passed"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
