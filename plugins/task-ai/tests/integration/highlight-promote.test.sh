#!/usr/bin/env bash
# Integration Test: highlight scope=promote
# Tests the full experience-to-skill promotion flow

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Create isolated test environment
TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

export NB_WORKSPACES_ROOT="$TEST_DIR"
export NB_WORKSPACES_LIBRARY="$TEST_DIR/.library"

echo "=== Integration Test: highlight scope=promote ==="
echo "Test directory: $TEST_DIR"

# Setup library structure
mkdir -p "$NB_WORKSPACES_LIBRARY/.memory/.experiences/software"
mkdir -p "$NB_WORKSPACES_LIBRARY/.skills/.candidates"
touch "$NB_WORKSPACES_LIBRARY/.changelog"

# Test 1: Create eligible experience (verified, with patterns)
echo -n "Test 1: Create eligible experience... "
cat > "$NB_WORKSPACES_LIBRARY/.memory/.experiences/software/test-feature-complete.md" <<'EOF'
---
quality_status: verified
completeness: complete
source: highlight-complete
type: software
notebook: test-feature
created_at: 2026-03-04T10:00:00Z
topic_keywords: [testing, integration, patterns]
---

# Experience: test-feature

## Context
Implemented a test feature with proper patterns.

## What Worked
- Used TDD approach
- Wrote unit tests first
- Followed clean code principles

## Patterns
- Red/Green/Refactor cycle
- Mock external dependencies
- Use fixtures for test data

## Lessons Learned
- Always write tests first
EOF
echo "PASS"

# Test 2: Add changelog entries for usage count
echo -n "Test 2: Add usage entries to changelog... "
for i in {1..5}; do
    echo "$(date -Iseconds) | search | .memory/.experiences/software/test-feature-complete.md | query:patterns" >> "$NB_WORKSPACES_LIBRARY/.changelog"
done
echo "PASS"

# Test 3: Run promote in dry-run mode
echo -n "Test 3: Dry-run detects eligible experience... "
OUTPUT=$(bash "$PROJECT_ROOT/skills/highlight/scripts/promote.sh" --dry-run 2>&1)
if echo "$OUTPUT" | grep -q "Eligible"; then
    echo "PASS"
else
    echo "FAIL: Dry-run did not detect eligible experience"
    echo "Output: $OUTPUT"
    exit 1
fi

# Test 4: Run actual promotion
echo -n "Test 4: Promote creates candidate... "
bash "$PROJECT_ROOT/skills/highlight/scripts/promote.sh" > /dev/null 2>&1
if [[ -d "$NB_WORKSPACES_LIBRARY/.skills/.candidates/test-feature" ]]; then
    echo "PASS"
else
    echo "FAIL: Candidate directory not created"
    ls -la "$NB_WORKSPACES_LIBRARY/.skills/.candidates/" 2>/dev/null || true
    exit 1
fi

# Test 5: SKILL.md generated with correct structure
echo -n "Test 5: SKILL.md has correct structure... "
SKILL_FILE="$NB_WORKSPACES_LIBRARY/.skills/.candidates/test-feature/SKILL.md"
if [[ -f "$SKILL_FILE" ]] && \
   grep -q "^name:" "$SKILL_FILE" && \
   grep -q "^description:" "$SKILL_FILE" && \
   grep -q "trust_tier: T1" "$SKILL_FILE"; then
    echo "PASS"
else
    echo "FAIL: SKILL.md missing required fields"
    cat "$SKILL_FILE" 2>/dev/null || echo "(file not found)"
    exit 1
fi

# Test 6: trust-report.md generated
echo -n "Test 6: trust-report.md generated... "
REPORT_FILE="$NB_WORKSPACES_LIBRARY/.skills/.candidates/test-feature/trust-report.md"
if [[ -f "$REPORT_FILE" ]] && grep -q "Trust Report" "$REPORT_FILE"; then
    echo "PASS"
else
    echo "FAIL: trust-report.md not generated correctly"
    exit 1
fi

# Test 7: Changelog updated
echo -n "Test 7: Changelog updated with promotion entry... "
if grep -q "skill-candidate" "$NB_WORKSPACES_LIBRARY/.changelog"; then
    echo "PASS"
else
    echo "FAIL: Changelog not updated"
    exit 1
fi

# Test 8: Non-eligible experience skipped (not verified)
echo -n "Test 8: Non-eligible experience skipped... "
cat > "$NB_WORKSPACES_LIBRARY/.memory/.experiences/software/provisional-exp.md" <<'EOF'
---
quality_status: provisional
type: software
---
# Provisional
## Patterns
- Some pattern
EOF
OUTPUT=$(bash "$PROJECT_ROOT/skills/highlight/scripts/promote.sh" --dry-run 2>&1)
if echo "$OUTPUT" | grep -q "Skip.*provisional"; then
    echo "PASS"
else
    echo "FAIL: Should skip provisional experience"
    exit 1
fi

echo ""
echo "=== All integration tests passed ==="
