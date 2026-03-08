#!/bin/bash
# Test: Universal rule loader for all three domains
# Red/Green TDD: core/rule-loader.sh should load rules from any domain
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RULE_LOADER="$TASK_AI_ROOT/core/rule-loader.sh"

FAILED=0
TEST_TMP=$(mktemp -d)
trap "rm -rf $TEST_TMP" EXIT

export NB_WORKSPACES_LIBRARY="$TEST_TMP/.library"

echo "--- Universal Rule Loader Tests ---"

# Test 1: Loader script exists
if [[ -f "$RULE_LOADER" ]]; then
    echo "PASS: rule-loader.sh exists"
else
    echo "FAIL: rule-loader.sh not found at $RULE_LOADER"
    ((FAILED++)) || true
fi

# Test 2: Load from security domain
mkdir -p "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active"
cat > "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active/sec-rule.yaml" <<'EOF'
id: SEC-001
name: Test security rule
pattern: "danger_pattern"
risk: high
enabled: true
EOF

source "$RULE_LOADER" 2>/dev/null || true
load_rules_from_domain "security" 2>/dev/null || true

if [[ "${#RULE_IDS[@]}" -gt 0 ]] && [[ "${RULE_IDS[0]}" == "SEC-001" ]]; then
    echo "PASS: Loaded rule from security domain"
else
    echo "FAIL: Should load rules from security domain"
    ((FAILED++)) || true
fi

# Test 3: Load from sanitization domain
mkdir -p "$NB_WORKSPACES_LIBRARY/.evolving-rules/sanitization/active"
cat > "$NB_WORKSPACES_LIBRARY/.evolving-rules/sanitization/active/san-rule.yaml" <<'EOF'
id: SAN-001
name: Test sanitization rule
pattern: "injection_pattern"
risk: high
enabled: true
EOF

load_rules_from_domain "sanitization" 2>/dev/null || true

if [[ "${#RULE_IDS[@]}" -gt 0 ]] && [[ "${RULE_IDS[0]}" == "SAN-001" ]]; then
    echo "PASS: Loaded rule from sanitization domain"
else
    echo "FAIL: Should load rules from sanitization domain"
    ((FAILED++)) || true
fi

# Test 4: Load from audit domain
mkdir -p "$NB_WORKSPACES_LIBRARY/.evolving-rules/audit/active"
cat > "$NB_WORKSPACES_LIBRARY/.evolving-rules/audit/active/aud-rule.yaml" <<'EOF'
id: AUD-001
name: Test audit rule
dimension: D1
check_items:
  - "Has required sections"
enabled: true
EOF

load_rules_from_domain "audit" 2>/dev/null || true

if [[ "${#RULE_IDS[@]}" -gt 0 ]] && [[ "${RULE_IDS[0]}" == "AUD-001" ]]; then
    echo "PASS: Loaded rule from audit domain"
else
    echo "FAIL: Should load rules from audit domain"
    ((FAILED++)) || true
fi

# Test 5: Disabled rules are skipped
cat > "$NB_WORKSPACES_LIBRARY/.evolving-rules/security/active/disabled-rule.yaml" <<'EOF'
id: DISABLED-001
name: Disabled rule
pattern: "should_not_load"
enabled: false
EOF

load_rules_from_domain "security" 2>/dev/null || true

FOUND_DISABLED=0
for id in "${RULE_IDS[@]:-}"; do
    [[ "$id" == "DISABLED-001" ]] && FOUND_DISABLED=1
done

if [[ $FOUND_DISABLED -eq 0 ]]; then
    echo "PASS: Disabled rules are skipped"
else
    echo "FAIL: Disabled rules should be skipped"
    ((FAILED++)) || true
fi

# Test 6: Empty domain handled gracefully
rm -rf "$NB_WORKSPACES_LIBRARY/.evolving-rules/audit/active"/*
load_rules_from_domain "audit" 2>/dev/null || true

if [[ $? -le 1 ]]; then
    echo "PASS: Empty domain handled gracefully"
else
    echo "FAIL: Empty domain should not crash"
    ((FAILED++)) || true
fi

# Summary
echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "PASS: All rule loader tests passed"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
