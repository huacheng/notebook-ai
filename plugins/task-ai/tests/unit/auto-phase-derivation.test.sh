#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUTO_SH="$SCRIPT_DIR/skills/auto/scripts/auto.sh"

# Create mock notebook with .working subdirectory (resolve_workdir sets WORK_DIR=nb_dir/.working)
mkdir -p "$TEST_DIR/test-nb/.working"
cat > "$TEST_DIR/test-nb/.working/.status.json" <<'EOF'
{"name": "test-nb", "status": "planning", "type": "software"}
EOF
cat > "$TEST_DIR/test-nb/.working/.target.md" <<'EOF'
# Test Target
## Requirements
- Implement feature X
EOF

# Run auto.sh — auto-detect notebook from CWD
(cd "$TEST_DIR/test-nb/.working" && NB_WORKSPACES_ROOT="$TEST_DIR" bash "$AUTO_SH" 2>/dev/null) || true

# Red: auto.sh currently does NOT write phase field to .auto-signal
SIGNAL_FILE="$TEST_DIR/test-nb/.working/.auto-signal"
if [[ ! -f "$SIGNAL_FILE" ]]; then
    echo "FAIL: .auto-signal not created"
    exit 1
fi

PHASE=$(python3 -c "import json; d=json.load(open('$SIGNAL_FILE')); print(d.get('phase', 'MISSING'))")
if [[ "$PHASE" == "MISSING" ]]; then
    echo "FAIL: .auto-signal missing 'phase' field"
    exit 1
fi
if [[ "$PHASE" != "planning" ]]; then
    echo "FAIL: status=planning should derive phase=planning, got '$PHASE'"
    exit 1
fi

# Also verify retry_count is present and initialized
RETRY=$(python3 -c "import json; d=json.load(open('$SIGNAL_FILE')); print(d.get('retry_count', 'MISSING'))")
if [[ "$RETRY" == "MISSING" ]]; then
    echo "FAIL: .auto-signal missing 'retry_count' field"
    exit 1
fi

echo "PASS: auto.sh writes phase and retry_count to .auto-signal"
