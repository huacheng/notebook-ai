#!/usr/bin/env bash
# Integration test: Full signal flow from signal-writer.sh to .auto-signal with extended fields
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Create minimal notebook structure
mkdir -p "$TEST_DIR/test-nb"
cat > "$TEST_DIR/test-nb/.status.json" <<'EOF'
{"name": "test-nb", "status": "planning", "type": "software"}
EOF
cat > "$TEST_DIR/test-nb/.target.md" <<'EOF'
# Test Target
## Requirements
- Implement feature X
EOF
cat > "$TEST_DIR/test-nb/.plan.md" <<'EOF'
# Test Plan
## Steps
1. Create module A
2. Add tests
EOF

# Source signal-writer
source "$SCRIPT_DIR/skills/auto/scripts/signal-writer.sh"

# Create base signal
cat > "$TEST_DIR/test-nb/.auto-signal" <<'EOF'
{
  "step": "plan",
  "result": "(generated)",
  "next": "check",
  "iteration": 1,
  "timestamp": "2026-01-01T00:00:00Z"
}
EOF

# Write phase info
write_phase "$TEST_DIR/test-nb/.auto-signal" "planning" 0.50

# Write check score
write_check_score "$TEST_DIR/test-nb/.auto-signal" 0.85 0.90 0.80 0.85 0.88 0.82 0.85

# Increment retry
increment_retry "$TEST_DIR/test-nb/.auto-signal"

# Append delegation failure
append_delegation_failure "$TEST_DIR/test-nb/.auto-signal" "verify@iter3"

# Verify all fields present
python3 -c "
import json, sys
with open('$TEST_DIR/test-nb/.auto-signal') as f:
    s = json.load(f)

assert s['phase'] == 'planning', f'phase={s[\"phase\"]}'
assert s['phase_progress'] == 0.50, f'progress={s[\"phase_progress\"]}'
assert s['check_score']['overall'] == 0.85, f'overall={s[\"check_score\"][\"overall\"]}'
assert s['check_score']['d1_correctness'] == 0.90
assert s['check_score']['d6_maintainability'] == 0.85
assert s['retry_count'] == 1, f'retry_count={s[\"retry_count\"]}'
assert s['delegation_failures'] == ['verify@iter3'], f'delegation_failures={s[\"delegation_failures\"]}'
assert s['step'] == 'plan'
assert s['next'] == 'check'
print('All fields verified')
"

echo "PASS: End-to-end signal flow test"
