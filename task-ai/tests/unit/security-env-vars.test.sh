#!/bin/bash
# Test H-SEC-1: Extended environment variable blocking
set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECURITY_SH="$TASK_AI_ROOT/skills/security/scripts/security.sh"

# Setup mock workspace
MOCK_ROOT=$(mktemp -d)
mkdir -p "$MOCK_ROOT/test-notebook/.working"
echo '{"status":"draft"}' > "$MOCK_ROOT/test-notebook/.working/.status.json"
export NB_WORKSPACES_ROOT="$MOCK_ROOT"

cleanup() { rm -rf "$MOCK_ROOT"; }
trap cleanup EXIT

# Test cases: all should be REJECTED
test_cases=(
    "LD_PRELOAD=/evil.so cmd"
    "PYTHONPATH=/evil python"
    "NODE_OPTIONS=--require=/evil node"
    "JAVA_TOOL_OPTIONS=-javaagent:/evil java"
    "RUBYOPT=-r/evil ruby"
    "PERL5LIB=/evil perl"
    "DYLD_INSERT_LIBRARIES=/evil cmd"
)

FAILED=0
for cmd in "${test_cases[@]}"; do
    if "$SECURITY_SH" test-notebook verify-cmd "$cmd" 2>&1 | grep -q "PASS"; then
        echo "FAIL: Should block: $cmd"
        ((FAILED++)) || true
    else
        echo "OK: Blocked: $cmd"
    fi
done

if [[ $FAILED -eq 0 ]]; then
    echo "PASS: All env var injections blocked"
    exit 0
else
    echo "TOTAL FAILURES: $FAILED"
    exit 1
fi
