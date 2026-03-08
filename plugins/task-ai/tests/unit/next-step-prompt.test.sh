#!/usr/bin/env bash
# Regression tests: Next Step Prompt in each SKILL.md
# Validates that every sub-command has deterministic next-step prompts
# Test type: contract test (grep/regex on spec text)

set -euo pipefail

SKILLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../skills" && pwd)"
PASS=0
FAIL=0

assert_contains() {
    local file="$1" pattern="$2" desc="$3"
    if grep -q "$pattern" "$file" 2>/dev/null; then
        echo "  PASS: $desc"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $desc"
        echo "    expected pattern: $pattern"
        echo "    in file: $file"
        FAIL=$((FAIL + 1))
    fi
}

assert_not_contains() {
    local file="$1" pattern="$2" desc="$3"
    if ! grep -q "$pattern" "$file" 2>/dev/null; then
        echo "  PASS: $desc"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $desc (should NOT contain)"
        echo "    unwanted pattern: $pattern"
        echo "    in file: $file"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== Next Step Prompt Regression Tests ==="
echo ""

# --- init ---
echo "[init]"
F="$SKILLS_DIR/init/SKILL.md"
assert_contains "$F" 'Notebook initialized.*Next.*target' \
    "init prompts to define target after initialization"
assert_not_contains "$F" 'next step hint$' \
    "init no longer uses vague 'next step hint'"

# --- target ---
echo "[target]"
F="$SKILLS_DIR/target/SKILL.md"
assert_contains "$F" '## Next Step Prompt' \
    "target has Next Step Prompt section"
assert_contains "$F" 'Target defined.*Next.*research.*plan' \
    "target (draft→planning) prompts research or plan"
assert_contains "$F" 'Stage.*target defined.*Next.*plan' \
    "target (evolving→planning) prompts plan"
assert_contains "$F" 'Target updated.*Next.*plan.*regenerate' \
    "target (refinement) prompts plan regeneration"
assert_contains "$F" 'Target updated mid-execution' \
    "target (mid-exec) prompts impact analysis"

# --- plan ---
echo "[plan]"
F="$SKILLS_DIR/plan/SKILL.md"
assert_contains "$F" 'Plan generated.*Next.*check.*post-plan' \
    "plan prompts check --checkpoint post-plan"

# --- check ---
echo "[check]"
F="$SKILLS_DIR/check/SKILL.md"
assert_contains "$F" "Plan approved.*auto.*exec" \
    "check PASS(post-plan) prompts auto or exec"
assert_contains "$F" 'Plan needs revision.*Next.*plan' \
    "check NEEDS_REVISION prompts plan"
assert_contains "$F" 'Implementation accepted.*Next.*merge' \
    "check ACCEPT prompts merge"
assert_contains "$F" 'Issues found.*Next.*exec.*fixes' \
    "check NEEDS_FIX prompts exec"
assert_contains "$F" 'Fundamental issues.*Next.*plan.*re-plan' \
    "check REPLAN prompts plan"
assert_contains "$F" 'Progress OK.*Next.*exec.*continue' \
    "check CONTINUE prompts exec"
assert_contains "$F" 'Task blocked' \
    "check BLOCKED prompts manual intervention"
assert_contains "$F" 'Pre-merge check passed.*Next.*merge' \
    "check PASS(pre-merge) prompts merge"
assert_contains "$F" 'Pre-merge issues.*Next.*exec.*fix' \
    "check NEEDS_FIX(pre-merge) prompts exec"

# --- exec ---
echo "[exec]"
F="$SKILLS_DIR/exec/SKILL.md"
assert_contains "$F" 'Execution complete.*Next.*check.*post-exec' \
    "exec done prompts check post-exec"
assert_contains "$F" 'Issue encountered.*Next.*check.*mid-exec' \
    "exec mid-exec prompts check mid-exec"
assert_contains "$F" 'Execution blocked.*manual intervention' \
    "exec blocked prompts manual intervention"

# --- verify ---
echo "[verify]"
F="$SKILLS_DIR/verify/SKILL.md"
assert_contains "$F" 'Verification complete.*Next.*check.*checkpoint' \
    "verify prompts check with checkpoint"

# --- merge ---
echo "[merge]"
F="$SKILLS_DIR/merge/SKILL.md"
assert_contains "$F" 'Stage.*merged.*Next.*highlight.*report' \
    "merge evolving prompts highlight then report"
assert_contains "$F" 'Merge conflict.*resolve manually' \
    "merge conflict prompts manual resolution"

# --- highlight ---
echo "[highlight]"
F="$SKILLS_DIR/highlight/SKILL.md"
assert_contains "$F" 'Experience distilled.*Next.*report' \
    "highlight prompts report"

# --- report ---
echo "[report]"
F="$SKILLS_DIR/report/SKILL.md"
assert_contains "$F" 'Task lifecycle complete.*Report saved' \
    "report outputs terminal completion message"

# --- research ---
echo "[research]"
F="$SKILLS_DIR/research/SKILL.md"
assert_contains "$F" 'Research stage complete.*review.*insights' \
    "research O1/O2/O3 prompts user review"
assert_contains "$F" 'All research stages confirmed.*Next.*plan' \
    "research objective-complete prompts plan"
assert_contains "$F" 'References collected.*Next.*plan' \
    "research default caller prompts plan"

# --- research O1/O2/O3 inline prompts (R1) ---
echo "[research O1/O2/O3 inline]"
F="$SKILLS_DIR/research/SKILL.md"
# Each O-stage block must have an Output message line with user-facing prompt
# (not just .auto-signal — the user needs to see what to do next)
assert_contains "$F" 'Output message.*O1.*Research stage complete' \
    "research O1 block has inline output prompt"
assert_contains "$F" 'Output message.*O2.*Research stage complete' \
    "research O2 block has inline output prompt"
assert_contains "$F" 'Output message.*O3.*Research stage complete' \
    "research O3 block has inline output prompt"
assert_contains "$F" 'Objective Complete.*All.*stages.*confirmed' \
    "research objective-complete block has inline output prompt"

# --- cancel ---
echo "[cancel]"
F="$SKILLS_DIR/cancel/SKILL.md"
assert_contains "$F" 'Task cancelled' \
    "cancel has terminal next-step prompt"

# --- summarize ---
echo "[summarize]"
F="$SKILLS_DIR/summarize/SKILL.md"
assert_contains "$F" 'Summary regenerated.*resume' \
    "summarize prompts resuming current lifecycle step"

# --- auto triggers ---
echo "[auto triggers]"
F="$SKILLS_DIR/auto/SKILL.md"
assert_contains "$F" '开始auto' \
    "auto triggers include '开始auto'"
assert_contains "$F" 'auto开始' \
    "auto triggers include 'auto开始'"
assert_contains "$F" '开启auto' \
    "auto triggers include '开启auto'"
assert_contains "$F" '启动auto' \
    "auto triggers include '启动auto'"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
