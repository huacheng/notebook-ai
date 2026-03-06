#!/usr/bin/env bash
# /task-ai:check implementation
# Usage: check.sh <notebook> [--checkpoint post-plan|mid-exec|post-exec|pre-merge|audit-validate|skill-review|skill-deep-review]

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

# D6: Security script path defined once at top (used by multiple checkpoints)
SECURITY_SH="$SCRIPT_DIR/../../security/scripts/security.sh"

# Parse all arguments first to check for library-only checkpoints
NOTEBOOK=""
CHECKPOINT=""
TARGET_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --checkpoint)
      # D3: Guard against missing option value; D2: reject --option as value
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "[ERROR] --checkpoint requires a value" >&2; exit 1
      fi
      CHECKPOINT="$2"; shift 2 ;;
    --target)
      # D3: Guard against missing option value; D2: reject --option as value
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "[ERROR] --target requires a value" >&2; exit 1
      fi
      TARGET_FILE="$2"; shift 2 ;;
    --*) echo "Unknown option: $1" >&2; exit 1 ;;
    *)
      # Positional argument = notebook name
      if [[ -z "$NOTEBOOK" ]]; then
        NOTEBOOK="$1"
      fi
      shift
      ;;
  esac
done

# D1: Default empty CHECKPOINT to 'post-plan'
if [[ -z "$CHECKPOINT" ]]; then
    CHECKPOINT="post-plan"
    echo "[check] No checkpoint specified, defaulting to 'post-plan'"
fi

# Library-only checkpoints don't need notebook context
LIBRARY_ONLY_CHECKPOINTS="audit-validate"
if [[ " $LIBRARY_ONLY_CHECKPOINTS " =~ " $CHECKPOINT " ]]; then
    # Set minimal context for library operations
    WORK_DIR=""
    STATE_PY="$SCRIPT_DIR/../../../core/state.py"
else
    # Normal notebook-context checkpoints
    # D3: Validate notebook argument before resolving
    if [[ -z "$NOTEBOOK" ]]; then
        echo "[ERROR] Notebook name required for checkpoint '$CHECKPOINT'." >&2
        exit 1
    fi
    resolve_workdir "$NOTEBOOK"
    NOTEBOOK="$NB_NOTEBOOK"
    STATUS_JSON="$WORK_DIR/.status.json"

    if [[ ! -d "$WORK_DIR" ]]; then
        echo "[ERROR] Working directory not found for notebook '$NOTEBOOK'." >&2
        exit 1
    fi

    # D2/D3: Acquire concurrency lock (per SKILL.md Notes)
    LOCK_DIR="$WORK_DIR/.working"
    LOCK_FILE="$LOCK_DIR/.lock"
    mkdir -p "$LOCK_DIR"
    if ! (set -o noclobber; echo "$$" > "$LOCK_FILE") 2>/dev/null; then
        LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "unknown")
        # D3: Stale lock recovery — check if holding process still exists
        if [[ "$LOCK_PID" =~ ^[0-9]+$ ]] && ! kill -0 "$LOCK_PID" 2>/dev/null; then
            echo "[WARN] Removing stale lock from PID $LOCK_PID" >&2
            rm -f "$LOCK_FILE"
            (set -o noclobber; echo "$$" > "$LOCK_FILE") 2>/dev/null || {
                echo "[ERROR] Failed to acquire lock after stale removal" >&2; exit 1
            }
        else
            echo "[ERROR] Another check is running (PID $LOCK_PID). Remove $LOCK_FILE if stale." >&2
            exit 1
        fi
    fi
    # D3: Release lock and clean temp files on exit (normal or error)
    cleanup() {
        rm -f "$LOCK_FILE" 2>/dev/null || true
        rm -f "$WORK_DIR"/.auto-signal.tmp.$$ 2>/dev/null || true
        rm -f "$WORK_DIR"/.analysis/*.tmp.$$ 2>/dev/null || true
    }
    trap cleanup EXIT

    ANALYSIS_DIR="$WORK_DIR/.analysis"
    mkdir -p "$ANALYSIS_DIR"
    STATE_PY="$SCRIPT_DIR/../../../core/state.py"
fi

# D3: Check state.py existence before calling
if [[ ! -f "$STATE_PY" ]]; then
    echo "[ERROR] state.py not found: $STATE_PY" >&2
    exit 1
fi

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

    # D6: Audit log for traceability
    AUDIT_LOG="$LIB_PATH/.evolving-rules/.audit.log"
    mkdir -p "$(dirname "$AUDIT_LOG")"

    log_audit() {
        local action="$1"
        local domain="$2"
        local rule="$3"
        local precision="$4"
        local reason="${5:-}"
        # D2: Sanitize values for safe JSON embedding (escape backslashes, quotes, control chars)
        local safe_reason
        safe_reason=$(printf '%s' "$reason" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g')
        local safe_rule
        safe_rule=$(printf '%s' "$rule" | sed 's/\\/\\\\/g; s/"/\\"/g')
        # D2: Validate precision is numeric before emitting unquoted
        local safe_precision
        if [[ "$precision" =~ ^[0-9]*\.?[0-9]+$ ]]; then
            safe_precision="$precision"
        else
            safe_precision="0.0"
        fi
        printf '{"ts":"%s","action":"%s","domain":"%s","rule":"%s","precision":%s,"reason":"%s"}\n' \
            "$(date -Iseconds)" "$action" "$domain" "$safe_rule" "$safe_precision" "$safe_reason" >> "$AUDIT_LOG"
    }

    # Calculate precision using Python yaml_parser.py
    calculate_precision() {
        local rule_file="$1"
        local test_dir="$2"
        local result

        if [[ -f "$YAML_PARSER" ]]; then
            # Use Python parser for robust YAML handling
            result=$(python3 "$YAML_PARSER" calculate-precision "$rule_file" "$test_dir" 2>/dev/null || echo "0.75")
        else
            # Fallback: default precision if parser unavailable
            result="0.75"
        fi
        # D3: Guard against empty output — default to 0.75 if result is empty or non-numeric
        if [[ -z "$result" || ! "$result" =~ ^[0-9]*\.?[0-9]+$ ]]; then
            result="0.75"
        fi
        echo "$result"
    }

    # D2: Security check before activation
    check_rule_security() {
        local rule_file="$1"
        local rule_id="$2"

        if [[ -f "$YAML_PARSER" ]]; then
            # Extract pattern and check for dangerous constructs
            local pattern
            pattern=$(python3 "$YAML_PARSER" parse "$rule_file" 2>/dev/null | grep -oP '"pattern":\s*"\K[^"]*' || echo "")

            if [[ -n "$pattern" ]]; then
                local result
                result=$(python3 "$YAML_PARSER" sanitize "$pattern" "$rule_id" 2>/dev/null || echo '{"safe":false}')
                if echo "$result" | grep -q '"safe": true\|"safe":true'; then
                    return 0  # Safe
                fi
            fi
        fi
        return 1  # Unsafe or check failed
    }

    ACTIVATED_COUNT=0
    REVIEW_COUNT=0
    BLOCKED_COUNT=0

    for domain in security sanitization audit; do
        CANDIDATES_DIR="$EVOLVING_RULES_DIR/$domain/candidates"
        ACTIVE_DIR="$EVOLVING_RULES_DIR/$domain/active"
        REVIEW_DIR="$EVOLVING_RULES_DIR/$domain/review"

        # Ensure directories exist
        mkdir -p "$ACTIVE_DIR" "$REVIEW_DIR"

        # Determine test directory based on domain
        # Priority: .test-corpus/ (labeled samples) > fallback directories
        TEST_CORPUS="$LIB_PATH/.test-corpus/$domain"
        if [[ -d "$TEST_CORPUS/positive" ]] || [[ -d "$TEST_CORPUS/negative" ]]; then
            TEST_DIR="$TEST_CORPUS"
        else
            # D3: Fallback to legacy directories if no labeled corpus
            case "$domain" in
                security)     TEST_DIR="$LIB_PATH/.memory/.experiences" ;;
                sanitization) TEST_DIR="$LIB_PATH/.memory/.references" ;;
                audit)        TEST_DIR="$LIB_PATH/.analysis" ;;
                *)            TEST_DIR="$LIB_PATH/.memory/.experiences"  # D3: fallback for unknown domains
                              echo "[WARN] Unknown domain '$domain', using default test dir" >&2 ;;
            esac
        fi

        for candidate in "$CANDIDATES_DIR"/*.yaml; do
            [[ -f "$candidate" ]] || continue

            CANDIDATE_NAME=$(basename "$candidate")
            CANDIDATE_ID="${CANDIDATE_NAME%.yaml}"
            PRECISION=$(calculate_precision "$candidate" "$TEST_DIR")

            # D2: Gate 1 - Security check (blocking)
            if ! check_rule_security "$candidate" "$CANDIDATE_ID"; then
                # D3: mv with error handling
                if ! mv "$candidate" "$REVIEW_DIR/" 2>/dev/null; then
                    echo "[ERROR] Failed to move $candidate to review" >&2
                    continue
                fi
                echo "[BLOCKED] $domain/$CANDIDATE_NAME - D2 security check failed"
                log_audit "blocked" "$domain" "$CANDIDATE_NAME" "$PRECISION" "D2_security_failed"
                ((BLOCKED_COUNT++)) || true
                continue
            fi

            # Gate 2 - Precision threshold
            if (( $(echo "$PRECISION >= 0.80" | bc -l) )); then
                # D3: mv with error handling
                if ! mv "$candidate" "$ACTIVE_DIR/" 2>/dev/null; then
                    echo "[ERROR] Failed to move $candidate to active" >&2
                    continue
                fi
                echo "[ACTIVATED] $domain/$CANDIDATE_NAME precision=$PRECISION"
                log_audit "activated" "$domain" "$CANDIDATE_NAME" "$PRECISION" "precision_passed"
                ((ACTIVATED_COUNT++)) || true
            else
                # D3: mv with error handling
                if ! mv "$candidate" "$REVIEW_DIR/" 2>/dev/null; then
                    echo "[ERROR] Failed to move $candidate to review" >&2
                    continue
                fi
                echo "[REVIEW] $domain/$CANDIDATE_NAME precision=$PRECISION (< 0.80 threshold)"
                log_audit "review" "$domain" "$CANDIDATE_NAME" "$PRECISION" "precision_below_threshold"
                ((REVIEW_COUNT++)) || true
            fi
        done
    done

    echo "[audit-validate] Complete: activated=$ACTIVATED_COUNT, review=$REVIEW_COUNT, blocked=$BLOCKED_COUNT"
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
        # D3: Guard against unbound RULE_IDS if load_rules_from_domain did not declare it
        if [[ -n "${RULE_IDS+x}" ]]; then
            AUDIT_RULES_LOADED=${#RULE_IDS[@]}
        fi
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
    # D2: Sanitize skill name — allow only alphanumeric, dash, underscore
    SKILL_NAME=$(echo "$SKILL_NAME" | tr -cd 'a-zA-Z0-9_-')
    ANALYSIS_FILE="$ANALYSIS_DIR/$DATE-skill-review-$SKILL_NAME.md"

    #############################################
    # Gate 1: D2 Security (BLOCKING)
    # Must pass before any other checks
    #############################################
    echo ""
    echo "--- Gate 1: D2 Security (blocking) ---"

    # SECURITY_SH defined at top of file (D6)
    D2_SCORE=0.9
    D2_ISSUES=""

    # Check for dangerous patterns
    if [[ -f "$SECURITY_SH" ]]; then
        SECURITY_OUTPUT=$(bash "$SECURITY_SH" "$NOTEBOOK" scan-skill "$TARGET_FILE" 2>&1 || true)
        # D1: Check for REJECT verdict, not generic keywords (fixes false positive on "Risk: low")
        if echo "$SECURITY_OUTPUT" | grep -qE "REJECT|BLOCKED"; then
            D2_SCORE=0.2
            D2_ISSUES="$SECURITY_OUTPUT"
        fi
    fi

    # Additional security checks
    # D1: Use word-boundary match to avoid false positives on "execution"/"executable"
    if grep -qE '\$\(|`[^`]+`|\beval\b|\bexec\b' "$TARGET_FILE"; then
        D2_SCORE=$(echo "$D2_SCORE - 0.3" | bc)
        D2_ISSUES="${D2_ISSUES}\n- Command substitution or eval detected"
    fi
    if grep -qiE 'curl.*\||wget.*\||bash\s+-c' "$TARGET_FILE"; then
        D2_SCORE=$(echo "$D2_SCORE - 0.4" | bc)
        D2_ISSUES="${D2_ISSUES}\n- Remote code execution pattern detected"
    fi

    # Clamp score
    D2_SCORE=$(echo "scale=2; if ($D2_SCORE < 0) 0 else $D2_SCORE" | bc)

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
        D1_SCORE=$(echo "scale=2; if ($D1_SCORE < 0) 0 else $D1_SCORE" | bc)

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
        HEADING_COUNT=$(grep -cE "^##" "$TARGET_FILE") || HEADING_COUNT=0
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
$(printf '%b' "$FIX_SUGGESTION")

## Gate Progress
| Gate | Dimension | Score | Threshold | Status |
|------|-----------|-------|-----------|--------|
| 1 | D2 Security | ${D2_SCORE:-N/A} | $GATE_THRESHOLD | $(if (( $(echo "${D2_SCORE:-0} >= $GATE_THRESHOLD" | bc -l) )); then echo "✅ PASS"; else echo "❌ FAIL"; fi) |
| 2 | D1 Correctness | ${D1_SCORE:-N/A} | $GATE_THRESHOLD | $(if [[ -z "${D1_SCORE:-}" ]]; then echo "⏸️ SKIP"; elif (( $(echo "$D1_SCORE >= $GATE_THRESHOLD" | bc -l) )); then echo "✅ PASS"; else echo "❌ FAIL"; fi) |
| 3 | D3 Reliability | ${D3_SCORE:-N/A} | $GATE_THRESHOLD | $(if [[ -z "${D3_SCORE:-}" ]]; then echo "⏸️ SKIP"; elif (( $(echo "$D3_SCORE >= $GATE_THRESHOLD" | bc -l) )); then echo "✅ PASS"; else echo "❌ FAIL"; fi) |
| 4 | D4+D5+D6 | - | - | ⏸️ SKIP |

## Next Steps
1. Fix the blocking issue above
2. Re-run: \`check <notebook> --checkpoint skill-review --target $TARGET_FILE\`
EOF

    else
        # All gates passed - calculate full composite
        COMPOSITE=$(echo "scale=2; $D1_SCORE * 0.20 + $D2_SCORE * 0.25 + $D3_SCORE * 0.15 + $D4_SCORE * 0.10 + $D5_SCORE * 0.15 + $D6_SCORE * 0.15" | bc)

        # Determine trust tier for L2 (skill-review)
        # L2 only promotes to T3 (>= 0.70), never directly to T4
        # T4 promotion requires L3 (skill-deep-review)
        TRUST_TIER="T1"
        if (( $(echo "$COMPOSITE >= 0.70" | bc -l) )); then
            TRUST_TIER="T3"  # L2 max tier is T3
        elif (( $(echo "$COMPOSITE >= 0.50" | bc -l) )); then
            TRUST_TIER="T2"
        fi
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

## L2 Tier Actions (skill-review)
- T3 (>= 0.70): Move to .drafts/ → next: L3 skill-deep-review
- T2 (0.50-0.69): Return findings, needs improvement
- T1 (< 0.50): Reject

Note: T4 requires L3 (skill-deep-review) with score >= 0.85
EOF

        # ─────────────────────────────────────────────────────────────────
        # Auto-move: promote to T3 (candidates → drafts)
        # ─────────────────────────────────────────────────────────────────
        LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
        SKILL_PARENT_DIR=$(dirname "$TARGET_FILE")
        SKILL_SLUG=$(basename "$SKILL_PARENT_DIR")
        # D2: Sanitize slug for use in paths
        SKILL_SLUG=$(echo "$SKILL_SLUG" | tr -cd 'a-zA-Z0-9_-.')

        # Check if skill is in .candidates/ (eligible for T3 promotion)
        # L2 promotes to T3 max (L3 required for T4)
        if [[ "$SKILL_PARENT_DIR" == *".candidates"* ]]; then
            if [[ "$TRUST_TIER" == "T3" ]]; then
                DRAFTS_TARGET="$LIB_PATH/.skills/.drafts/$SKILL_SLUG"

                if [[ ! -d "$DRAFTS_TARGET" ]]; then
                    mkdir -p "$DRAFTS_TARGET"
                    # D3: cp -r with error handling
                    if ! cp -r "$SKILL_PARENT_DIR"/* "$DRAFTS_TARGET/" 2>/dev/null; then
                        echo "[ERROR] Failed to copy skill to drafts" >&2
                    else
                        # Update trust_tier in SKILL.md
                        if [[ -f "$DRAFTS_TARGET/SKILL.md" ]]; then
                            sed -i "s/trust_tier: T[0-9]/trust_tier: T3/" "$DRAFTS_TARGET/SKILL.md"
                        fi

                        echo ""
                        echo "[PROMOTION] T2→T3: Moved to $DRAFTS_TARGET"
                        echo "[PROMOTION] Next: check --checkpoint skill-deep-review --target $DRAFTS_TARGET/SKILL.md"
                    fi
                else
                    echo "[SKIP] Already exists in .drafts/"
                fi
            fi
        fi
    fi

    echo ""
    echo "Analysis written to $ANALYSIS_FILE"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Handle skill-deep-review checkpoint (L3 LLM Semantic Review)
# T3→T4 promotion: >= 0.85 composite → move to .skills/<name>/
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$CHECKPOINT" == "skill-deep-review" ]]; then
    if ! command -v bc &>/dev/null; then
        echo "[ERROR] 'bc' command required for skill-deep-review." >&2
        exit 1
    fi

    if [[ -z "$TARGET_FILE" || ! -f "$TARGET_FILE" ]]; then
        echo "[ERROR] --target <skill.md> required for skill-deep-review" >&2
        exit 1
    fi

    echo "=== L3 LLM Deep Semantic Review: $TARGET_FILE ==="

    DATE=$(date +%Y-%m-%d)
    SKILL_NAME=$(basename "${TARGET_FILE%.*}")
    # D2: Sanitize skill name — allow only alphanumeric, dash, underscore
    SKILL_NAME=$(echo "$SKILL_NAME" | tr -cd 'a-zA-Z0-9_-')
    SKILL_PARENT_DIR=$(dirname "$TARGET_FILE")
    SKILL_SLUG=$(basename "$SKILL_PARENT_DIR")
    # D2: Sanitize slug for use in paths
    SKILL_SLUG=$(echo "$SKILL_SLUG" | tr -cd 'a-zA-Z0-9_-.')
    ANALYSIS_FILE="$ANALYSIS_DIR/$DATE-skill-deep-review-$SKILL_NAME.md"

    # Verify skill is in .drafts/ (T3)
    if [[ "$SKILL_PARENT_DIR" != *".drafts"* ]]; then
        echo "[WARN] Skill not in .drafts/ — may not be T3 yet"
    fi

    LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"

    #############################################
    # L3 Dimension 1: Intent Alignment
    #############################################
    echo ""
    echo "--- L3.1: Intent Alignment ---"

    L3_D1_SCORE=0.8
    L3_D1_ISSUES=""

    # Check description vs steps consistency
    # D1: Extract description value from same line (YAML: description: "value")
    DESCRIPTION=$(grep "^description:" "$TARGET_FILE" 2>/dev/null | head -1 | sed 's/^description:\s*//' | tr -d '"' || echo "")
    HAS_STEPS=$(grep -qE "^## (Steps|Instructions|Usage)" "$TARGET_FILE" && echo 1 || echo 0)

    if [[ -n "$DESCRIPTION" && "$HAS_STEPS" == "1" ]]; then
        L3_D1_SCORE=0.9
    else
        L3_D1_SCORE=0.6
        L3_D1_ISSUES="Missing clear description-to-steps alignment"
    fi

    # Check for hidden side effects (write/delete/send without mention in description)
    # D1: Use targeted patterns to avoid false positives on common words (post-plan, git push)
    if grep -qiE "(write file|write to|delete file|remove dir|send request|send data|push to remote)" "$TARGET_FILE" 2>/dev/null; then
        if ! echo "$DESCRIPTION" | grep -qiE "(write|delete|remove|send|modify|update)"; then
            L3_D1_SCORE=$(echo "$L3_D1_SCORE - 0.2" | bc)
            L3_D1_ISSUES="${L3_D1_ISSUES}\n- Potential hidden side effects not in description"
        fi
    fi

    echo "L3.1 Intent Alignment: $L3_D1_SCORE"

    #############################################
    # L3 Dimension 2: Semantic Security
    #############################################
    echo ""
    echo "--- L3.2: Semantic Security ---"

    L3_D2_SCORE=0.9
    L3_D2_ISSUES=""

    # Indirect command execution
    if grep -qE '\$\{.*\}.*\||\$\(.*\)\s*\|' "$TARGET_FILE"; then
        L3_D2_SCORE=$(echo "$L3_D2_SCORE - 0.3" | bc)
        L3_D2_ISSUES="${L3_D2_ISSUES}\n- Indirect command execution pattern"
    fi

    # Data exfiltration paths
    if grep -qiE "(curl|wget|fetch).*\$|send.*to.*\$" "$TARGET_FILE"; then
        L3_D2_SCORE=$(echo "$L3_D2_SCORE - 0.2" | bc)
        L3_D2_ISSUES="${L3_D2_ISSUES}\n- Potential data exfiltration path"
    fi

    # Prompt injection vectors
    # D1: Match injection attack patterns, not defensive mentions like "injection prevention"
    if grep -qiE "user.*input.*directly|inject.*into|ignore.*instruction|override.*system" "$TARGET_FILE"; then
        L3_D2_SCORE=$(echo "$L3_D2_SCORE - 0.4" | bc)
        L3_D2_ISSUES="${L3_D2_ISSUES}\n- Prompt injection vulnerability"
    fi

    L3_D2_SCORE=$(echo "scale=2; if ($L3_D2_SCORE < 0) 0 else $L3_D2_SCORE" | bc)
    echo "L3.2 Semantic Security: $L3_D2_SCORE"

    #############################################
    # L3 Dimension 3: Logical Completeness
    #############################################
    echo ""
    echo "--- L3.3: Logical Completeness ---"

    L3_D3_SCORE=0.7
    L3_D3_ISSUES=""

    # Precondition checks
    if grep -qiE "(require|prerequisite|before|ensure|verify.*first)" "$TARGET_FILE"; then
        L3_D3_SCORE=$(echo "$L3_D3_SCORE + 0.1" | bc)
    else
        L3_D3_ISSUES="${L3_D3_ISSUES}\n- No precondition documentation"
    fi

    # Error handling
    if grep -qiE "(error|fail|exception|fallback|if.*not|when.*missing)" "$TARGET_FILE"; then
        L3_D3_SCORE=$(echo "$L3_D3_SCORE + 0.1" | bc)
    else
        L3_D3_ISSUES="${L3_D3_ISSUES}\n- No error handling documentation"
    fi

    # Idempotency mention
    if grep -qiE "(idempotent|safe.*rerun|repeat)" "$TARGET_FILE"; then
        L3_D3_SCORE=$(echo "$L3_D3_SCORE + 0.1" | bc)
    fi

    echo "L3.3 Logical Completeness: $L3_D3_SCORE"

    #############################################
    # Calculate L3 Composite
    #############################################
    echo ""
    echo "=== L3 Review Summary ==="

    L3_COMPOSITE=$(echo "scale=2; $L3_D1_SCORE * 0.35 + $L3_D2_SCORE * 0.40 + $L3_D3_SCORE * 0.25" | bc)

    # Determine outcome
    if (( $(echo "$L3_COMPOSITE >= 0.85" | bc -l) )); then
        L3_VERDICT="PROMOTE"
        L3_NEXT_TIER="T4"
    elif (( $(echo "$L3_COMPOSITE >= 0.70" | bc -l) )); then
        L3_VERDICT="PASS"
        L3_NEXT_TIER="T3"
    else
        L3_VERDICT="NEEDS_WORK"
        L3_NEXT_TIER="T3"
    fi

    echo "L3 Composite: $L3_COMPOSITE"
    echo "Verdict: $L3_VERDICT"
    echo "Trust Tier: $L3_NEXT_TIER"

    # Write analysis
    cat > "$ANALYSIS_FILE" <<EOF
# L3 Deep Semantic Review: $SKILL_NAME · $DATE

## Scores
| Dimension | Score | Weight |
|-----------|-------|--------|
| L3.1 Intent Alignment | $L3_D1_SCORE | 35% |
| L3.2 Semantic Security | $L3_D2_SCORE | 40% |
| L3.3 Logical Completeness | $L3_D3_SCORE | 25% |

## Result
- **L3 Composite**: $L3_COMPOSITE
- **Verdict**: $L3_VERDICT
- **Trust Tier**: $L3_NEXT_TIER

## Issues Found
$(printf '%b' "${L3_D1_ISSUES:-None}")
$(printf '%b' "${L3_D2_ISSUES:-None}")
$(printf '%b' "${L3_D3_ISSUES:-None}")

## Next Steps
$(if [[ "$L3_VERDICT" == "PROMOTE" ]]; then
    echo "- ✅ Ready for T4 activation"
    echo "- Skill will be moved to .skills/.active/$SKILL_SLUG/"
else
    echo "- Fix issues above and re-run skill-deep-review"
fi)
EOF

    # ─────────────────────────────────────────────────────────────────
    # Auto-move T3→T4 if PROMOTE verdict
    # ─────────────────────────────────────────────────────────────────
    if [[ "$L3_VERDICT" == "PROMOTE" ]]; then
        ACTIVE_TARGET="$LIB_PATH/.skills/.active/$SKILL_SLUG"

        if [[ ! -d "$ACTIVE_TARGET" ]]; then
            mkdir -p "$ACTIVE_TARGET"
            # D3: cp -r with error handling
            if ! cp -r "$SKILL_PARENT_DIR"/* "$ACTIVE_TARGET/" 2>/dev/null; then
                echo "[ERROR] Failed to copy skill to active" >&2
            else
                # Update trust_tier in SKILL.md
                if [[ -f "$ACTIVE_TARGET/SKILL.md" ]]; then
                    sed -i "s/trust_tier: T[0-9]/trust_tier: T4/" "$ACTIVE_TARGET/SKILL.md"
                fi

                echo ""
                echo "[PROMOTION] T3→T4: Moved to $ACTIVE_TARGET"
                echo "[PROMOTION] Skill is now ACTIVE and available for hot-reload"
            fi
        else
            echo "[SKIP] Already exists in .skills/.active/"
        fi
    fi

    echo ""
    echo "Analysis written to $ANALYSIS_FILE"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Post-plan checkpoint: Security audit-plan pre-hook (per SKILL.md Step 10)
# SECURITY_SH defined at top of file (D6)
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$CHECKPOINT" == "post-plan" ]]; then
    echo "[post-plan] Running security audit-plan..."
    if [[ -f "$SECURITY_SH" ]]; then
        AUDIT_OUTPUT=$(bash "$SECURITY_SH" "$NOTEBOOK" audit-plan 2>&1 || true)
        echo "$AUDIT_OUTPUT"
        if echo "$AUDIT_OUTPUT" | grep -qiE "BLOCKED|HIGH.RISK"; then
            echo "[post-plan] Security audit FAILED - triggering REPLAN"
            VERDICT="REPLAN"
            DATE=$(date +%Y-%m-%d)
            ANALYSIS_FILE="$ANALYSIS_DIR/$DATE-$CHECKPOINT-security-blocked.md"
            # D3: Atomic write via temp file
            ANALYSIS_TMP="$ANALYSIS_FILE.tmp.$$"
            cat > "$ANALYSIS_TMP" <<EOF
# Security Audit: post-plan · $DATE
- Verdict: REPLAN
- Reason: Security audit blocked the plan

## Security Report
$AUDIT_OUTPUT

## Required Action
Review and revise the plan to remove dangerous operations.
EOF
            mv -f "$ANALYSIS_TMP" "$ANALYSIS_FILE"
            # D3: python3 call with error handling
            if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status re-planning --phase needs-plan 2>/dev/null; then
                echo "[WARN] Failed to transition status to re-planning" >&2
            fi
            # D1: Write .auto-signal per SKILL.md step 18 (REPLAN → checkpoint empty per signal table)
            # D3: Atomic write — auto loop may read signal concurrently
            SIGNAL_JSON="{\"step\":\"check\",\"result\":\"REPLAN\",\"next\":\"plan\",\"checkpoint\":\"\",\"timestamp\":\"$(date -Iseconds)\"}"
            SIGNAL_TMP="$WORK_DIR/.auto-signal.tmp.$$"
            echo "$SIGNAL_JSON" > "$SIGNAL_TMP" && mv -f "$SIGNAL_TMP" "$WORK_DIR/.auto-signal"
            echo "Check completed. Security blocked. Analysis: $ANALYSIS_FILE"
            exit 0
        fi
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Pre-merge checkpoint: Final quality gate before merge (threshold 0.80)
# No retry — failure falls back to Phase 3 execution
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$CHECKPOINT" == "pre-merge" ]]; then
    echo "[pre-merge] Running pre-merge quality gate..."

    # Source signal-writer for check_score output
    SIGNAL_WRITER="$SCRIPT_DIR/../../auto/scripts/signal-writer.sh"
    if [[ -f "$SIGNAL_WRITER" ]]; then
        source "$SIGNAL_WRITER"
    else
        echo "[WARN] signal-writer.sh not found, check_score will not be written" >&2
    fi

    # Verify bc is available
    if ! command -v bc &>/dev/null; then
        echo "[ERROR] 'bc' command required for pre-merge." >&2
        exit 1
    fi

    # Verify status is executing (pre-merge only after post-exec ACCEPT)
    # D2: Pass path as argument to avoid code injection via filenames
    CURRENT_STATUS=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['status'])" "$STATUS_JSON" 2>/dev/null || echo "unknown")
    if [[ "$CURRENT_STATUS" != "executing" ]]; then
        echo "[ERROR] pre-merge requires status=executing, got $CURRENT_STATUS" >&2
        exit 1
    fi

    DATE=$(date +%Y-%m-%d)
    ANALYSIS_FILE="$ANALYSIS_DIR/$DATE-pre-merge.md"

    # D1 Correctness: Check if post-exec ACCEPT exists
    D1_SCORE=0.70
    # D3: Use compgen glob instead of ls pipe for reliable file detection
    if compgen -G "$ANALYSIS_DIR"'/*post-exec-accept*' > /dev/null 2>&1; then
        D1_SCORE=0.90
    fi

    # D2 Security: Check if security audit passed
    D2_SCORE=0.85
    if [[ -f "$SECURITY_SH" ]]; then
        SECURITY_CHECK=$(bash "$SECURITY_SH" "$NOTEBOOK" scan-quick 2>&1 || true)
        if echo "$SECURITY_CHECK" | grep -qiE "REJECT|HIGH.RISK|BLOCKED"; then
            D2_SCORE=0.50
        fi
    fi

    # D3 Reliability: Check test results exist
    D3_SCORE=0.80
    # D3: Use compgen glob instead of ls pipe for reliable file detection
    if compgen -G "$WORK_DIR/.test/"'*results*' > /dev/null 2>&1; then
        D3_SCORE=0.90
    else
        D3_SCORE=0.65
    fi

    # D4 Performance: Default (no perf regression check in v1)
    D4_SCORE=0.85

    # D5 Architecture: Check plan adherence
    D5_SCORE=0.80
    if [[ -f "$WORK_DIR/.plan.md" ]]; then
        D5_SCORE=0.85
    fi

    # D6 Maintainability: Check summary exists
    D6_SCORE=0.80
    if [[ -f "$WORK_DIR/.summary.md" ]]; then
        D6_SCORE=0.88
    fi

    # Calculate overall composite (weighted)
    OVERALL=$(echo "scale=2; $D1_SCORE * 0.25 + $D2_SCORE * 0.20 + $D3_SCORE * 0.20 + $D4_SCORE * 0.10 + $D5_SCORE * 0.10 + $D6_SCORE * 0.15" | bc)

    echo "[pre-merge] Scores: D1=$D1_SCORE D2=$D2_SCORE D3=$D3_SCORE D4=$D4_SCORE D5=$D5_SCORE D6=$D6_SCORE overall=$OVERALL"

    # Write check_score to .auto-signal if signal file exists
    SIGNAL_FILE="$WORK_DIR/.auto-signal"
    if [[ -f "$SIGNAL_FILE" ]] && type write_check_score &>/dev/null; then
        write_check_score "$SIGNAL_FILE" "$OVERALL" "$D1_SCORE" "$D2_SCORE" "$D3_SCORE" "$D4_SCORE" "$D5_SCORE" "$D6_SCORE"
    fi

    # Determine verdict
    if (( $(echo "$OVERALL >= 0.80" | bc -l) )); then
        VERDICT="PASS"
        echo "[pre-merge] PASS: overall=$OVERALL >= 0.80 threshold"

        cat > "$ANALYSIS_FILE" <<EOF
# Pre-merge Quality Gate · $DATE

## Verdict: PASS

| Dimension | Score |
|-----------|-------|
| D1 Correctness | $D1_SCORE |
| D2 Security | $D2_SCORE |
| D3 Reliability | $D3_SCORE |
| D4 Performance | $D4_SCORE |
| D5 Architecture | $D5_SCORE |
| D6 Maintainability | $D6_SCORE |
| **Overall** | **$OVERALL** |

Threshold: 0.80 — PASSED. Ready to merge.
EOF

        # Write .auto-signal (merge with existing check_score if present)
        # D2: Pass timestamp as argument to avoid shell interpolation in Python code
        MERGE_TS=$(date -Iseconds)
        if [[ -f "$WORK_DIR/.auto-signal" ]] && command -v python3 &>/dev/null; then
            python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f: d = json.load(f)
except Exception: d = {}
d.update({'step':'check','result':'PASS','next':'merge','checkpoint':'pre-merge','timestamp':sys.argv[2]})
with open(sys.argv[1],'w') as f: json.dump(d,f)
" "$WORK_DIR/.auto-signal" "$MERGE_TS" 2>/dev/null || {
                SIGNAL_JSON="{\"step\":\"check\",\"result\":\"PASS\",\"next\":\"merge\",\"checkpoint\":\"pre-merge\",\"timestamp\":\"$MERGE_TS\"}"
                echo "$SIGNAL_JSON" > "$WORK_DIR/.auto-signal"
            }
        else
            SIGNAL_JSON="{\"step\":\"check\",\"result\":\"PASS\",\"next\":\"merge\",\"checkpoint\":\"pre-merge\",\"timestamp\":\"$MERGE_TS\"}"
            echo "$SIGNAL_JSON" > "$WORK_DIR/.auto-signal"
        fi

    else
        VERDICT="NEEDS_FIX"
        echo "[pre-merge] FAIL: overall=$OVERALL < 0.80 threshold — falling back to Phase 3"

        # Identify failing dimensions
        FAILING_DIMS=""
        for dim_var in D1_SCORE D2_SCORE D3_SCORE D4_SCORE D5_SCORE D6_SCORE; do
            dim_val="${!dim_var}"
            if (( $(echo "$dim_val < 0.80" | bc -l) )); then
                FAILING_DIMS="${FAILING_DIMS}\n- ${dim_var%%_SCORE}: $dim_val"
            fi
        done

        cat > "$ANALYSIS_FILE" <<EOF
# Pre-merge Quality Gate · $DATE

## Verdict: NEEDS_FIX (fall back to Phase 3)

| Dimension | Score |
|-----------|-------|
| D1 Correctness | $D1_SCORE |
| D2 Security | $D2_SCORE |
| D3 Reliability | $D3_SCORE |
| D4 Performance | $D4_SCORE |
| D5 Architecture | $D5_SCORE |
| D6 Maintainability | $D6_SCORE |
| **Overall** | **$OVERALL** |

Threshold: 0.80 — FAILED. Falling back to Phase 3.

## Failing Dimensions
$(printf '%b' "$FAILING_DIMS")

## Required Action
Address failing dimensions and re-run post-exec check.
EOF

        # Reset retry_count for Phase 3 re-entry
        if [[ -f "$SIGNAL_FILE" ]] && type write_phase &>/dev/null; then
            write_phase "$SIGNAL_FILE" "execution" 0.90
        fi

        # Write .auto-signal (merge with existing check_score if present)
        # D2: Pass timestamp as argument to avoid shell interpolation in Python code
        FIX_TS=$(date -Iseconds)
        if [[ -f "$WORK_DIR/.auto-signal" ]] && command -v python3 &>/dev/null; then
            python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f: d = json.load(f)
except Exception: d = {}
d.update({'step':'check','result':'NEEDS_FIX','next':'exec','checkpoint':'pre-merge','retry_count':0,'timestamp':sys.argv[2]})
with open(sys.argv[1],'w') as f: json.dump(d,f)
" "$WORK_DIR/.auto-signal" "$FIX_TS" 2>/dev/null || {
                SIGNAL_JSON="{\"step\":\"check\",\"result\":\"NEEDS_FIX\",\"next\":\"exec\",\"checkpoint\":\"pre-merge\",\"retry_count\":0,\"timestamp\":\"$FIX_TS\"}"
                echo "$SIGNAL_JSON" > "$WORK_DIR/.auto-signal"
            }
        else
            SIGNAL_JSON="{\"step\":\"check\",\"result\":\"NEEDS_FIX\",\"next\":\"exec\",\"checkpoint\":\"pre-merge\",\"retry_count\":0,\"timestamp\":\"$FIX_TS\"}"
            echo "$SIGNAL_JSON" > "$WORK_DIR/.auto-signal"
        fi
    fi

    echo "Analysis written to $ANALYSIS_FILE"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Fallthrough: Simulated plumbing for checkpoints not yet fully implemented
# (post-plan without security block, post-exec, mid-exec)
# In real AI agent run, this would be a reasoned verdict from LLM evaluation.
# ─────────────────────────────────────────────────────────────────────────────

# D1: Validate checkpoint-status compatibility per SKILL.md Step 2
CURRENT_STATUS=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['status'])" "$STATUS_JSON" 2>/dev/null || echo "unknown")
case "$CHECKPOINT" in
  post-plan)
    if [[ "$CURRENT_STATUS" != "planning" && "$CURRENT_STATUS" != "re-planning" ]]; then
        echo "[ERROR] post-plan requires status=planning or re-planning, got $CURRENT_STATUS" >&2
        exit 1
    fi
    VERDICT="PASS" ;;
  post-exec)
    if [[ "$CURRENT_STATUS" != "executing" ]]; then
        echo "[ERROR] post-exec requires status=executing, got $CURRENT_STATUS" >&2
        exit 1
    fi
    VERDICT="ACCEPT" ;;
  mid-exec)
    if [[ "$CURRENT_STATUS" != "executing" ]]; then
        echo "[ERROR] mid-exec requires status=executing, got $CURRENT_STATUS" >&2
        exit 1
    fi
    VERDICT="CONTINUE" ;;
  *)
    echo "[ERROR] Unhandled checkpoint: $CHECKPOINT" >&2
    exit 1
    ;;
esac

echo "Checking $NOTEBOOK at $CHECKPOINT... Verdict: $VERDICT"

# State Transitions per SKILL.md State Transitions table
case "$VERDICT" in
  PASS)
    if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status review 2>/dev/null; then
        echo "[WARN] Failed to transition status to review" >&2
    fi
    ;;
  ACCEPT|CONTINUE|NEEDS_REVISION|NEEDS_FIX)
    # ACCEPT/CONTINUE/NEEDS_REVISION/NEEDS_FIX keep current status unchanged
    ;;
  REPLAN)
    if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status re-planning --phase needs-plan 2>/dev/null; then
        echo "[WARN] Failed to transition status to re-planning" >&2
    fi
    ;;
  BLOCKED)
    if ! python3 "$STATE_PY" transition "$STATUS_JSON" --status blocked 2>/dev/null; then
        echo "[WARN] Failed to transition status to blocked" >&2
    fi
    ;;
esac

# Output Analysis File
# D3: Atomic write via temp file
DATE=$(date +%Y-%m-%d)
ANALYSIS_FILE="$ANALYSIS_DIR/$DATE-$CHECKPOINT-${VERDICT,,}.md"
ANALYSIS_TMP="$ANALYSIS_FILE.tmp.$$"
cat > "$ANALYSIS_TMP" <<EOF
# Evaluation: $CHECKPOINT · $DATE
- Verdict: $VERDICT
- Rationale: Plumbing stub — full LLM-driven evaluation not yet implemented for this checkpoint.
EOF
mv -f "$ANALYSIS_TMP" "$ANALYSIS_FILE"

# D1: Write .auto-signal per SKILL.md Step 18
# D6: checkpoint field follows SKILL.md .auto-signal table:
#   NEEDS_FIX includes checkpoint for routing; others use empty string
case "$VERDICT" in
  PASS)
    SIGNAL_NEXT="exec"; SIGNAL_CP="" ;;
  ACCEPT)
    SIGNAL_NEXT="merge"; SIGNAL_CP="" ;;
  CONTINUE)
    SIGNAL_NEXT="exec"; SIGNAL_CP="" ;;
  NEEDS_REVISION)
    SIGNAL_NEXT="plan"; SIGNAL_CP="" ;;
  NEEDS_FIX)
    SIGNAL_NEXT="exec"; SIGNAL_CP="$CHECKPOINT" ;;
  REPLAN)
    SIGNAL_NEXT="plan"; SIGNAL_CP="" ;;
  BLOCKED)
    SIGNAL_NEXT="(stop)"; SIGNAL_CP="" ;;
  *)
    SIGNAL_NEXT="unknown"; SIGNAL_CP="" ;;
esac
# D3: Atomic write — auto loop may read signal concurrently
SIGNAL_JSON="{\"step\":\"check\",\"result\":\"$VERDICT\",\"next\":\"$SIGNAL_NEXT\",\"checkpoint\":\"$SIGNAL_CP\",\"timestamp\":\"$(date -Iseconds)\"}"
SIGNAL_TMP="$WORK_DIR/.auto-signal.tmp.$$"
echo "$SIGNAL_JSON" > "$SIGNAL_TMP" && mv -f "$SIGNAL_TMP" "$WORK_DIR/.auto-signal"

echo "Check completed. Analysis written to $ANALYSIS_FILE."
