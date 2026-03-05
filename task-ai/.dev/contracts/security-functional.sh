#!/usr/bin/env bash
# L2: Functional test for security sub-command
# Verifies runtime interception of safe and dangerous commands.

source "$(dirname "$0")/lib.sh"

SECURITY_SH="$TASK_AI_ROOT/skills/security/scripts/security.sh"
export NB_WORKSPACES_ROOT="/tmp/security-functional-test"
trap 'rm -rf "$NB_WORKSPACES_ROOT"' EXIT
TEST_NB="security-test-nb"

rm -rf "$NB_WORKSPACES_ROOT" && mkdir -p "$NB_WORKSPACES_ROOT/$TEST_NB/.working"
STATUS_JSON="$NB_WORKSPACES_ROOT/$TEST_NB/.working/.status.json"
echo '{"status": "executing"}' > "$STATUS_JSON"

# Assert: Safe command passes
OUTPUT_SAFE=$("$SECURITY_SH" "$TEST_NB" verify-cmd "ls -la" 2>&1)
if echo "$OUTPUT_SAFE" | grep -q "PASS"; then
    emit_pass "security: allowed safe command"
else
    emit_fail "security: blocked safe command"
fi

# Assert: Malicious command is blocked
OUTPUT_MALICIOUS=$("$SECURITY_SH" "$TEST_NB" verify-cmd "rm -rf /etc" 2>&1)
if echo "$OUTPUT_MALICIOUS" | grep -q "REJECT"; then
    emit_pass "security: blocked destructive command"
else
    emit_fail "security: failed to block destructive command"
fi

# Assert: Malicious VFP injection is blocked
OUTPUT_VFP=$("$SECURITY_SH" "$TEST_NB" verify-cmd "npm test -- --eval 'require("fs")'" 2>&1)
if echo "$OUTPUT_VFP" | grep -q "REJECT"; then
    emit_pass "security: blocked VFP semantic injection"
else
    emit_fail "security: failed to block VFP injection"
fi

# --- Test: security.sh uses fixed-string grep for NB_ROOT (not regex) ---
if grep -n 'grep -qE "\$NB_ROOT"' "$SECURITY_SH" | grep -v '^#'; then
  emit_fail "security: uses grep -qE for NB_ROOT comparison — regex metachar bypass risk"
else
  emit_pass "security: NB_ROOT comparison does not use -qE regex mode"
fi

# --- Test: NB_ROOT path traversal check uses fixed-string matching ---
if grep -n 'grep.*-q.*"$NB_ROOT"' "$SECURITY_SH" | grep -qv -- '-F\|-qF'; then
  emit_fail "security: NB_ROOT match should use -F (fixed string) not regex"
else
  emit_pass "security: NB_ROOT match uses fixed-string mode"
fi

# Cleanup
rm -rf "$NB_WORKSPACES_ROOT"

summary
