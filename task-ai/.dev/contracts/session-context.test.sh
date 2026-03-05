#!/usr/bin/env bash
# Test: target.sh sets session-context, plan.sh clears it
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_SCRIPT="$TASK_AI_ROOT/skills/target/scripts/target.sh"
PLAN_SCRIPT="$TASK_AI_ROOT/skills/plan/scripts/plan.sh"

# Setup temp workspace
TEST_ROOT=$(mktemp -d)
trap "rm -rf $TEST_ROOT" EXIT

export NB_WORKSPACES_ROOT="$TEST_ROOT"
TEST_PROJECT="$TEST_ROOT/test-project"
TEST_NOTEBOOK="$TEST_PROJECT/test-notebook"
WORK_DIR="$TEST_NOTEBOOK/.working"

mkdir -p "$WORK_DIR"

# Initialize git repo
cd "$TEST_NOTEBOOK"
git init -q
git config user.email "test@test.com"
git config user.name "Test"

# Create minimal .status.json
cat > "$WORK_DIR/.status.json" << 'EOF'
{
  "status": "draft",
  "stage": { "current": 1, "total": 1 }
}
EOF

git add .
git commit -q -m "init"

# Test 1: target with content creates .session-context
echo "Test 1: target with content creates .session-context"

export NB_NOTEBOOK="test-notebook"
export NB_PROJECT="test-project"

bash "$TARGET_SCRIPT" "Build a JWT auth system" 2>/dev/null || true

if [[ -f "$WORK_DIR/.session-context" ]]; then
    if grep -q "phase: target-refinement" "$WORK_DIR/.session-context"; then
        echo "PASS: .session-context created with target-refinement phase"
    else
        echo "FAIL: .session-context missing phase field"
        cat "$WORK_DIR/.session-context"
        exit 1
    fi
else
    echo "FAIL: .session-context not created"
    exit 1
fi

# Test 2: .target.md was created
echo "Test 2: .target.md was created"

if [[ -f "$WORK_DIR/.target.md" ]]; then
    if grep -q "JWT auth" "$WORK_DIR/.target.md"; then
        echo "PASS: .target.md contains objective"
    else
        echo "FAIL: .target.md missing objective content"
        exit 1
    fi
else
    echo "FAIL: .target.md not created"
    exit 1
fi

# Test 3: plan clears .session-context
echo "Test 3: plan clears .session-context"

# Update status to planning for plan to work
cat > "$WORK_DIR/.status.json" << 'EOF'
{
  "status": "planning",
  "stage": { "current": 1, "total": 1 }
}
EOF

bash "$PLAN_SCRIPT" 2>/dev/null || true

if [[ ! -f "$WORK_DIR/.session-context" ]]; then
    echo "PASS: .session-context cleared by plan"
else
    if grep -q "phase: target-refinement" "$WORK_DIR/.session-context"; then
        echo "FAIL: .session-context still has target-refinement phase"
        exit 1
    else
        echo "PASS: .session-context phase changed"
    fi
fi

# Test 4: plan creates plan-refinement phase
echo "Test 4: plan creates plan-refinement phase"

if [[ -f "$WORK_DIR/.session-context" ]] && grep -q "phase: plan-refinement" "$WORK_DIR/.session-context"; then
    echo "PASS: plan created plan-refinement phase"
else
    echo "FAIL: plan should create plan-refinement phase"
    cat "$WORK_DIR/.session-context" 2>/dev/null || echo "(no .session-context)"
    exit 1
fi

# Test 5: exec clears plan-refinement phase
echo "Test 5: exec clears plan-refinement phase"

EXEC_SCRIPT="$TASK_AI_ROOT/skills/exec/scripts/exec.sh"

# Update status to executing for exec to work
cat > "$WORK_DIR/.status.json" << 'EOF'
{
  "status": "review",
  "type": "software",
  "stage": { "current": 1, "total": 1 }
}
EOF

bash "$EXEC_SCRIPT" 2>/dev/null || true

if [[ ! -f "$WORK_DIR/.session-context" ]]; then
    echo "PASS: .session-context cleared by exec"
else
    if grep -q "phase: plan-refinement" "$WORK_DIR/.session-context"; then
        echo "FAIL: .session-context still has plan-refinement phase"
        exit 1
    else
        echo "PASS: .session-context phase changed"
    fi
fi

echo ""
echo "All session-context tests passed!"
