#!/usr/bin/env bash
# /task-ai:check implementation
# Usage: check.sh <notebook> [--checkpoint post-plan|mid-exec|post-exec]

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"


NOTEBOOK="${1:-}"
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

CHECKPOINT=""
TARGET_FILE=""
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --checkpoint) CHECKPOINT="$2"; shift 2 ;;
    --target) TARGET_FILE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
INDEX_JSON="$WORK_DIR/.index.json"

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
fi

ANALYSIS_DIR="$WORK_DIR/.analysis"
mkdir -p "$ANALYSIS_DIR"

STATE_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/core/state.py"

# Handle audit-validate checkpoint - validates candidate rules
if [[ "$CHECKPOINT" == "audit-validate" ]]; then
    # Verify bc is available for floating point math
    if ! command -v bc &>/dev/null; then
        echo "[ERROR] 'bc' command required for audit-validate. Install with: apt install bc" >&2
        exit 1
    fi

    LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
    EVOLVING_RULES_DIR="$LIB_PATH/.evolving-rules"
    YAML_PARSER="$SCRIPT_DIR/../../../core/yaml_parser.py"

    echo "[audit-validate] Validating candidate rules in $EVOLVING_RULES_DIR"

    # Calculate precision using Python yaml_parser.py
    calculate_precision() {
        local rule_file="$1"
        local test_dir="$2"

        if [[ -f "$YAML_PARSER" ]]; then
            # Use Python parser for robust YAML handling
            python3 "$YAML_PARSER" calculate-precision "$rule_file" "$test_dir" 2>/dev/null || echo "0.75"
        else
            # Fallback: default precision if parser unavailable
            echo "0.75"
        fi
    }

    ACTIVATED_COUNT=0
    REVIEW_COUNT=0

    for domain in security sanitization audit; do
        CANDIDATES_DIR="$EVOLVING_RULES_DIR/$domain/candidates"
        ACTIVE_DIR="$EVOLVING_RULES_DIR/$domain/active"
        REVIEW_DIR="$EVOLVING_RULES_DIR/$domain/review"

        # Ensure directories exist
        mkdir -p "$ACTIVE_DIR" "$REVIEW_DIR"

        # Determine test directory based on domain
        case "$domain" in
            security)     TEST_DIR="$LIB_PATH/.memory/.experiences" ;;
            sanitization) TEST_DIR="$LIB_PATH/.memory/.references" ;;
            audit)        TEST_DIR="$ANALYSIS_DIR" ;;
        esac

        for candidate in "$CANDIDATES_DIR"/*.yaml; do
            [[ -f "$candidate" ]] || continue

            CANDIDATE_NAME=$(basename "$candidate")
            PRECISION=$(calculate_precision "$candidate" "$TEST_DIR")

            # Decision: activate or review
            if (( $(echo "$PRECISION >= 0.80" | bc -l) )); then
                mv "$candidate" "$ACTIVE_DIR/"
                echo "[ACTIVATED] $domain/$CANDIDATE_NAME precision=$PRECISION"
                ((ACTIVATED_COUNT++)) || true
            else
                mv "$candidate" "$REVIEW_DIR/"
                echo "[REVIEW] $domain/$CANDIDATE_NAME precision=$PRECISION (< 0.80 threshold)"
                ((REVIEW_COUNT++)) || true
            fi
        done
    done

    echo "[audit-validate] Complete: activated=$ACTIVATED_COUNT, review=$REVIEW_COUNT"
    exit 0
fi

# Handle skill-review checkpoint separately - GATED EXECUTION
# Gate 1: D2 Security (blocking) → Gate 2: D1 Correctness (blocking)
# → Gate 3: D3 Reliability (blocking) → Gate 4: D4+D5+D6 Optimization (parallel)
if [[ "$CHECKPOINT" == "skill-review" ]]; then
    # Verify bc is available for floating point math
    if ! command -v bc &>/dev/null; then
        echo "[ERROR] 'bc' command required for skill-review. Install with: apt install bc" >&2
        exit 1
    fi

    if [[ -z "$TARGET_FILE" || ! -f "$TARGET_FILE" ]]; then
        echo "[ERROR] --target <skill.md> required for skill-review" >&2
        exit 1
    fi

    echo "=== Gated Skill Review: $TARGET_FILE ==="

    # Load dynamic audit rules from .evolving-rules/audit/active/
    RULE_LOADER="$SCRIPT_DIR/../../../core/rule-loader.sh"
    AUDIT_RULES_LOADED=0
    if [[ -f "$RULE_LOADER" ]]; then
        source "$RULE_LOADER"
        load_rules_from_domain "audit" 2>/dev/null || true
        AUDIT_RULES_LOADED=${#RULE_IDS[@]}
        [[ $AUDIT_RULES_LOADED -gt 0 ]] && echo "[INFO] Loaded $AUDIT_RULES_LOADED dynamic audit rules"
    fi

    # Gate threshold for blocking
    GATE_THRESHOLD=0.5
    BLOCKED_AT=""
    BLOCK_REASON=""
    FIX_SUGGESTION=""

    # Prepare output
    DATE=$(date +%Y-%m-%d)
    SKILL_NAME=$(basename "${TARGET_FILE%.*}")
    ANALYSIS_FILE="$ANALYSIS_DIR/$DATE-skill-review-$SKILL_NAME.md"

    #############################################
    # Gate 1: D2 Security (BLOCKING)
    # Must pass before any other checks
    #############################################
    echo ""
    echo "--- Gate 1: D2 Security (blocking) ---"

    SECURITY_SH="$SCRIPT_DIR/../../security/scripts/security.sh"
    D2_SCORE=0.9
    D2_ISSUES=""

    # Check for dangerous patterns
    if [[ -f "$SECURITY_SH" ]]; then
        SECURITY_OUTPUT=$(bash "$SECURITY_SH" "$NOTEBOOK" scan-skill "$TARGET_FILE" 2>&1 || true)
        if echo "$SECURITY_OUTPUT" | grep -qiE "blocked|dangerous|risk|violation"; then
            D2_SCORE=0.2
            D2_ISSUES="$SECURITY_OUTPUT"
        fi
    fi

    # Additional security checks
    if grep -qE '\$\(|`[^`]+`|eval\s|exec\s' "$TARGET_FILE"; then
        D2_SCORE=$(echo "$D2_SCORE - 0.3" | bc)
        D2_ISSUES="${D2_ISSUES}\n- Command substitution or eval detected"
    fi
    if grep -qiE 'curl.*\||wget.*\||bash\s+-c' "$TARGET_FILE"; then
        D2_SCORE=$(echo "$D2_SCORE - 0.4" | bc)
        D2_ISSUES="${D2_ISSUES}\n- Remote code execution pattern detected"
    fi

    # Clamp score
    D2_SCORE=$(echo "if ($D2_SCORE < 0) 0 else $D2_SCORE" | bc)

    if (( $(echo "$D2_SCORE < $GATE_THRESHOLD" | bc -l) )); then
        echo "Gate 1 FAIL: D2_SCORE=$D2_SCORE < $GATE_THRESHOLD"
        BLOCKED_AT="Gate 1 (D2 Security)"
        BLOCK_REASON="Security violations detected"
        FIX_SUGGESTION="Remove dangerous patterns: command substitution, eval, remote execution. Review: $D2_ISSUES"
    else
        echo "Gate 1 PASS: D2_SCORE=$D2_SCORE ✅"
    fi

    #############################################
    # Gate 2: D1 Correctness (BLOCKING)
    # Only runs if Gate 1 passed
    #############################################
    if [[ -z "$BLOCKED_AT" ]]; then
        echo ""
        echo "--- Gate 2: D1 Correctness (blocking) ---"

        D1_SCORE=0.5
        D1_ISSUES=""

        # Check for required sections
        if grep -qE "^## (Steps|Instructions|Usage)" "$TARGET_FILE"; then
            D1_SCORE=0.8
        else
            D1_ISSUES="${D1_ISSUES}\n- Missing ## Steps or ## Usage section"
        fi

        if grep -qE "^## (Examples|Example)" "$TARGET_FILE"; then
            D1_SCORE=$(echo "$D1_SCORE + 0.1" | bc)
        fi

        # Check frontmatter basics
        if ! grep -qE "^name:" "$TARGET_FILE"; then
            D1_SCORE=$(echo "$D1_SCORE - 0.2" | bc)
            D1_ISSUES="${D1_ISSUES}\n- Missing name: in frontmatter"
        fi
        if ! grep -qE "^description:" "$TARGET_FILE"; then
            D1_SCORE=$(echo "$D1_SCORE - 0.1" | bc)
            D1_ISSUES="${D1_ISSUES}\n- Missing description: in frontmatter"
        fi

        # Clamp score
        D1_SCORE=$(echo "if ($D1_SCORE < 0) 0 else $D1_SCORE" | bc)

        if (( $(echo "$D1_SCORE < $GATE_THRESHOLD" | bc -l) )); then
            echo "Gate 2 FAIL: D1_SCORE=$D1_SCORE < $GATE_THRESHOLD"
            BLOCKED_AT="Gate 2 (D1 Correctness)"
            BLOCK_REASON="Skill structure incomplete"
            FIX_SUGGESTION="Add required sections: ## Steps/Usage, name:, description:. Issues: $D1_ISSUES"
        else
            echo "Gate 2 PASS: D1_SCORE=$D1_SCORE ✅"
        fi
    fi

    #############################################
    # Gate 3: D3 Reliability (BLOCKING)
    # Only runs if Gate 2 passed
    #############################################
    if [[ -z "$BLOCKED_AT" ]]; then
        echo ""
        echo "--- Gate 3: D3 Reliability (blocking) ---"

        D3_SCORE=0.7
        D3_ISSUES=""

        # Error handling mentions
        if grep -qiE "(error|fail|exception|fallback|edge.case)" "$TARGET_FILE"; then
            D3_SCORE=0.85
        else
            D3_SCORE=0.6
            D3_ISSUES="${D3_ISSUES}\n- No error handling or edge case documentation"
        fi

        # Check for boundary conditions
        if grep -qiE "(if.*empty|when.*null|missing|invalid)" "$TARGET_FILE"; then
            D3_SCORE=$(echo "$D3_SCORE + 0.1" | bc)
        fi

        if (( $(echo "$D3_SCORE < $GATE_THRESHOLD" | bc -l) )); then
            echo "Gate 3 FAIL: D3_SCORE=$D3_SCORE < $GATE_THRESHOLD"
            BLOCKED_AT="Gate 3 (D3 Reliability)"
            BLOCK_REASON="Insufficient error handling documentation"
            FIX_SUGGESTION="Document error cases, edge conditions, and fallback behaviors."
        else
            echo "Gate 3 PASS: D3_SCORE=$D3_SCORE ✅"
        fi
    fi

    #############################################
    # Gate 4: D4+D5+D6 Optimization (PARALLEL, non-blocking)
    # Only runs if all blocking gates passed
    #############################################
    if [[ -z "$BLOCKED_AT" ]]; then
        echo ""
        echo "--- Gate 4: D4+D5+D6 Optimization (parallel) ---"

        # D4 Performance: Token efficiency
        LINE_COUNT=$(wc -l < "$TARGET_FILE")
        D4_SCORE=0.8
        D4_SUGGESTION=""
        if [[ $LINE_COUNT -gt 200 ]]; then
            D4_SCORE=0.5
            D4_SUGGESTION="Skill is too long ($LINE_COUNT lines). Consider splitting or condensing."
        elif [[ $LINE_COUNT -gt 100 ]]; then
            D4_SCORE=0.7
            D4_SUGGESTION="Skill is moderately long ($LINE_COUNT lines). Review for redundancy."
        fi
        echo "D4 Performance: $D4_SCORE ${D4_SUGGESTION:+(suggestion: $D4_SUGGESTION)}"

        # D5 Architecture: Frontmatter completeness
        D5_SCORE=0.6
        D5_SUGGESTION=""
        if grep -qE "^name:" "$TARGET_FILE" && grep -qE "^description:" "$TARGET_FILE"; then
            D5_SCORE=0.85
        fi
        if grep -qE "^triggers:" "$TARGET_FILE"; then
            D5_SCORE=$(echo "$D5_SCORE + 0.1" | bc)
        else
            D5_SUGGESTION="Add triggers: for auto-invocation"
        fi
        echo "D5 Architecture: $D5_SCORE ${D5_SUGGESTION:+(suggestion: $D5_SUGGESTION)}"

        # D6 Maintainability: Clear structure
        D6_SCORE=0.7
        D6_SUGGESTION=""
        HEADING_COUNT=$(grep -cE "^##" "$TARGET_FILE" || echo 0)
        if [[ $HEADING_COUNT -ge 3 ]]; then
            D6_SCORE=0.85
        else
            D6_SUGGESTION="Add more section headers (currently $HEADING_COUNT, recommend 3+)"
        fi
        echo "D6 Maintainability: $D6_SCORE ${D6_SUGGESTION:+(suggestion: $D6_SUGGESTION)}"
    else
        # Gates blocked - set optimization scores to 0 (not evaluated)
        D4_SCORE=0
        D5_SCORE=0
        D6_SCORE=0
    fi

    #############################################
    # Calculate composite and determine outcome
    #############################################
    echo ""
    echo "=== Review Summary ==="

    if [[ -n "$BLOCKED_AT" ]]; then
        # Blocked - calculate partial score
        COMPOSITE=$(echo "scale=2; ${D2_SCORE:-0} * 0.25 + ${D1_SCORE:-0} * 0.20 + ${D3_SCORE:-0} * 0.15" | bc)
        TRUST_TIER="T1"
        REVIEW_STATUS="BLOCKED"

        echo "Status: BLOCKED at $BLOCKED_AT"
        echo "Reason: $BLOCK_REASON"
        echo "Fix suggestion: $FIX_SUGGESTION"
        echo "Partial score: $COMPOSITE (gates incomplete)"

        cat > "$ANALYSIS_FILE" <<EOF
# Skill Review: $SKILL_NAME · $DATE

## Status: BLOCKED ❌

**Blocked at**: $BLOCKED_AT
**Reason**: $BLOCK_REASON

### Fix Suggestion
$FIX_SUGGESTION

## Gate Progress
| Gate | Dimension | Score | Threshold | Status |
|------|-----------|-------|-----------|--------|
| 1 | D2 Security | ${D2_SCORE:-N/A} | $GATE_THRESHOLD | $([ "${D2_SCORE:-0}" != "0" ] && (( $(echo "${D2_SCORE:-0} >= $GATE_THRESHOLD" | bc -l) )) && echo "✅ PASS" || echo "❌ FAIL") |
| 2 | D1 Correctness | ${D1_SCORE:-N/A} | $GATE_THRESHOLD | $([ -n "${D1_SCORE:-}" ] && (( $(echo "${D1_SCORE:-0} >= $GATE_THRESHOLD" | bc -l) )) && echo "✅ PASS" || echo "⏸️ SKIP") |
| 3 | D3 Reliability | ${D3_SCORE:-N/A} | $GATE_THRESHOLD | $([ -n "${D3_SCORE:-}" ] && (( $(echo "${D3_SCORE:-0} >= $GATE_THRESHOLD" | bc -l) )) && echo "✅ PASS" || echo "⏸️ SKIP") |
| 4 | D4+D5+D6 | - | - | ⏸️ SKIP |

## Next Steps
1. Fix the blocking issue above
2. Re-run: \`check <notebook> --checkpoint skill-review --target $TARGET_FILE\`
EOF

    else
        # All gates passed - calculate full composite
        COMPOSITE=$(echo "scale=2; $D1_SCORE * 0.20 + $D2_SCORE * 0.25 + $D3_SCORE * 0.15 + $D4_SCORE * 0.10 + $D5_SCORE * 0.15 + $D6_SCORE * 0.15" | bc)

        # Determine trust tier
        TRUST_TIER="T1"
        if (( $(echo "$COMPOSITE >= 0.85" | bc -l) )); then
            TRUST_TIER="T4"
        elif (( $(echo "$COMPOSITE >= 0.70" | bc -l) )); then
            TRUST_TIER="T3"
        elif (( $(echo "$COMPOSITE >= 0.50" | bc -l) )); then
            TRUST_TIER="T2"
        fi
        REVIEW_STATUS="PASS"

        echo "Status: ALL GATES PASSED ✅"
        echo "Composite Score: $COMPOSITE"
        echo "Trust Tier: $TRUST_TIER"

        cat > "$ANALYSIS_FILE" <<EOF
# Skill Review: $SKILL_NAME · $DATE

## Status: PASSED ✅

## Gate Results
| Gate | Dimension | Score | Threshold | Status |
|------|-----------|-------|-----------|--------|
| 1 | D2 Security | $D2_SCORE | $GATE_THRESHOLD | ✅ PASS |
| 2 | D1 Correctness | $D1_SCORE | $GATE_THRESHOLD | ✅ PASS |
| 3 | D3 Reliability | $D3_SCORE | $GATE_THRESHOLD | ✅ PASS |
| 4 | D4 Performance | $D4_SCORE | - | ✅ |
| 4 | D5 Architecture | $D5_SCORE | - | ✅ |
| 4 | D6 Maintainability | $D6_SCORE | - | ✅ |

## Result
- **Composite Score**: $COMPOSITE
- **Trust Tier**: $TRUST_TIER

## Optimization Suggestions
${D4_SUGGESTION:+- D4: $D4_SUGGESTION}
${D5_SUGGESTION:+- D5: $D5_SUGGESTION}
${D6_SUGGESTION:+- D6: $D6_SUGGESTION}

## Tier Actions
- T4 (>= 0.85): Auto-promote to skills/
- T3 (0.70-0.84): Move to .drafts/ (pending human review)
- T2 (0.50-0.69): Return findings, needs improvement
- T1 (< 0.50): Reject
EOF
    fi

    echo ""
    echo "Analysis written to $ANALYSIS_FILE"
    exit 0
fi

# 1. Decision Logic (Simulated for plumbing)
# In real AI agent run, this would be a reasoned verdict.
VERDICT="PASS"
[[ "$CHECKPOINT" == "post-exec" ]] && VERDICT="ACCEPT"

echo "Checking $NOTEBOOK at $CHECKPOINT... Verdict: $VERDICT"

# 2. State Transitions
case "$VERDICT" in
  PASS)
    python3 "$STATE_PY" transition "$INDEX_JSON" --status review
    ;;
  ACCEPT)
    # ACCEPT keeps 'executing' status but signals 'merge'
    ;;
  REPLAN)
    python3 "$STATE_PY" transition "$INDEX_JSON" --status re-planning --phase needs-plan
    ;;
  BLOCKED)
    python3 "$STATE_PY" transition "$INDEX_JSON" --status blocked
    ;;
esac

# 3. Output Analysis File
DATE=$(date +%Y-%m-%d)
ANALYSIS_FILE="$ANALYSIS_DIR/$DATE-$CHECKPOINT-${VERDICT,,}.md"
cat > "$ANALYSIS_FILE" <<EOF
# Evaluation: $CHECKPOINT · $DATE
- Verdict: $VERDICT
- Rationale: Simulated plumbing pass.
EOF

echo "Check completed. Analysis written to $ANALYSIS_FILE."
