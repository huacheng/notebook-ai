#!/usr/bin/env bash
# Six-dimension audit tests for evolve loop components
# Tests: R1, R2, C1, L1, L2

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

pass() { echo "✓ $1"; }
fail() { echo "✗ $1" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# R1: research.sh - $WORK_DIR empty should not break .auto-signal
# ─────────────────────────────────────────────────────────────────────────────
test_R1_auto_signal_handles_empty_workdir() {
    # Check that research.sh handles empty WORK_DIR gracefully
    # Pattern: either old style (2>/dev/null || true) or new style (if WORK_DIR check)
    if grep -qE 'WORK_DIR.*auto-signal.*2>/dev/null' "$TASK_AI_ROOT/skills/research/scripts/research.sh" || \
       grep -qE 'if.*-n.*WORK_DIR.*-d.*WORK_DIR' "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R1: research.sh handles empty WORK_DIR for .auto-signal"
    else
        fail "R1: research.sh may fail when WORK_DIR is empty"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R2: research.sh - intel-fetcher errors should be logged
# ─────────────────────────────────────────────────────────────────────────────
test_R2_intel_fetcher_error_handling() {
    # Check that intel-fetcher errors are not silently ignored
    if grep -qE 'intel-fetcher.*\|\|.*echo.*\[.*\]|INTEL_FETCH_STATUS|intel-fetcher.*failed' \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R2: research.sh logs intel-fetcher errors"
    else
        fail "R2: research.sh silently ignores intel-fetcher errors"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# C1: check.sh - pattern extraction should handle special chars
# ─────────────────────────────────────────────────────────────────────────────
test_C1_pattern_extraction_robust() {
    # Check that pattern extraction uses robust method (not grep -oP on JSON)
    if grep -qE 'jq.*pattern|python.*json.*pattern|parse.*pattern.*safe' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "C1: check.sh uses robust pattern extraction"
    else
        # Alternative: check if it handles the edge case
        if grep -qE 'pattern.*\|\|.*""' "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
            pass "C1: check.sh has fallback for pattern extraction"
        else
            fail "C1: check.sh pattern extraction may fail on special chars"
        fi
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# L1: rule-loader.sh - grep options must be safely expanded
# ─────────────────────────────────────────────────────────────────────────────
test_L1_grep_opts_safe_expansion() {
    # Check that grep_opts is properly quoted or uses array
    # BAD: grep $grep_opts
    # GOOD: grep "$grep_opts" or grep ${grep_flags[@]}
    if grep -qE 'grep\s+\$grep_opts\s' "$TASK_AI_ROOT/core/rule-loader.sh"; then
        fail "L1: rule-loader.sh has unsafe grep \$grep_opts expansion"
    else
        pass "L1: rule-loader.sh grep options safely expanded"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# L2: rule-loader.sh - JSON parsing should be robust
# ─────────────────────────────────────────────────────────────────────────────
test_L2_json_parsing_robust() {
    # Check for robust JSON parsing (not relying on tr + grep hacks)
    if grep -qE 'jq\s|python.*json|--jsonpath' "$TASK_AI_ROOT/core/rule-loader.sh" || \
       grep -qE 'while.*read.*-r.*line.*json_output' "$TASK_AI_ROOT/core/rule-loader.sh"; then
        # Has some form of structured parsing or documented limitation
        pass "L2: rule-loader.sh has structured JSON handling"
    else
        fail "L2: rule-loader.sh JSON parsing is fragile"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R3: research.sh - experience copy should validate content (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_R3_experience_copy_validated() {
    # Check that experience files are validated before copy
    # Accepts: head -c check, grep dangerous patterns on exp_file, or explicit sanitize/validate
    if grep -qE 'sanitize.*exp_file|validate.*exp_file|check.*content.*exp_file|head.*-c.*exp_file|grep.*dangerous.*exp_file|grep.*-qE.*exp_file' \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R3: research.sh validates experience content before copy"
    else
        fail "R3: research.sh copies experience without content validation"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R4: research.sh - no duplicate directory creation (D5)
# ─────────────────────────────────────────────────────────────────────────────
test_R4_no_duplicate_mkdir() {
    # Check that directory creation is delegated to intel-fetcher
    local research_mkdir_count
    research_mkdir_count=$(grep -cE 'mkdir.*candidates|mkdir.*positive|mkdir.*negative' \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh" || echo 0)
    # Should be 0 or have a comment about delegation
    if [[ "$research_mkdir_count" -eq 0 ]] || \
       grep -qE '#.*intel-fetcher.*creates|#.*delegat' "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R4: research.sh delegates directory creation"
    else
        fail "R4: research.sh has duplicate directory creation"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R5: research.sh - no magic strings for quality_status (D6)
# ─────────────────────────────────────────────────────────────────────────────
test_R5_no_magic_strings() {
    # Check that quality_status is defined as constant
    if grep -qE 'QUALITY_STATUS_VERIFIED|VERIFIED_STATUS=' \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R5: research.sh uses named constant for quality_status"
    else
        # Alternative: check if it's in a well-documented location
        if grep -qE '#.*quality_status.*verified.*marker' \
            "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
            pass "R5: research.sh documents quality_status magic string"
        else
            fail "R5: research.sh uses undocumented magic string"
        fi
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# I1: intel-fetcher.sh - API response should be validated (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_I1_api_response_validated() {
    if grep -qE 'validate.*response|sanitize.*response|check.*json|response.*valid' \
        "$TASK_AI_ROOT/skills/research/scripts/intel-fetcher.sh"; then
        pass "I1: intel-fetcher.sh validates API responses"
    else
        fail "I1: intel-fetcher.sh does not validate API responses"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# I2: intel-fetcher.sh - should not duplicate sample-generator functions (D5)
# ─────────────────────────────────────────────────────────────────────────────
test_I2_no_duplicate_sample_functions() {
    # Check that inline sample creation is removed or marked as bootstrap-only
    local inline_count
    inline_count=$(grep -cE '^create_positive_sample\(\)|^create_negative_sample\(\)' \
        "$TASK_AI_ROOT/skills/research/scripts/intel-fetcher.sh" || echo 0)
    if [[ "$inline_count" -eq 0 ]] || \
       grep -qE '#.*bootstrap.*only|#.*fallback.*sample-generator' \
        "$TASK_AI_ROOT/skills/research/scripts/intel-fetcher.sh"; then
        pass "I2: intel-fetcher.sh delegates to sample-generator"
    else
        fail "I2: intel-fetcher.sh has duplicate sample functions"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# L3: rule-loader.sh - should have caching mechanism (D4)
# ─────────────────────────────────────────────────────────────────────────────
test_L3_has_caching() {
    if grep -qE 'CACHE|_LOADED|skip.*reload|already.*loaded' \
        "$TASK_AI_ROOT/core/rule-loader.sh"; then
        pass "L3: rule-loader.sh has caching mechanism"
    else
        fail "L3: rule-loader.sh lacks caching"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# L4: rule-loader.sh - paths should be configurable (D6)
# ─────────────────────────────────────────────────────────────────────────────
test_L4_configurable_paths() {
    if grep -qE 'EVOLVING_RULES_PATH|RULES_BASE_DIR|\$\{.*:-.*evolving-rules\}' \
        "$TASK_AI_ROOT/core/rule-loader.sh"; then
        pass "L4: rule-loader.sh has configurable paths"
    else
        fail "L4: rule-loader.sh has hardcoded paths"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# S1: security.sh - should delegate to rule-loader.sh (D5)
# ─────────────────────────────────────────────────────────────────────────────
test_S1_delegates_to_rule_loader() {
    if grep -qE 'source.*rule-loader\.sh|load_rules_from_domain' \
        "$TASK_AI_ROOT/skills/security/scripts/security.sh"; then
        pass "S1: security.sh delegates to rule-loader.sh"
    else
        fail "S1: security.sh has duplicate load_dynamic_rules implementation"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# S2: security.sh - grep options should be safely expanded (D6)
# ─────────────────────────────────────────────────────────────────────────────
test_S2_grep_opts_safe() {
    # BAD: grep $grep_flags
    # GOOD: grep "${grep_opts[@]}" or grep "$grep_flags" (quoted)
    if grep -qE 'grep\s+\$grep_flags\s' "$TASK_AI_ROOT/skills/security/scripts/security.sh"; then
        fail "S2: security.sh has unsafe grep \$grep_flags expansion"
    else
        pass "S2: security.sh grep options safely expanded"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# S3: security.sh - should use RULE_PATTERNS from rule-loader (D1)
# ─────────────────────────────────────────────────────────────────────────────
test_S3_uses_rule_loader_arrays() {
    # After delegation, security.sh should use RULE_IDS/RULE_PATTERNS from rule-loader
    if grep -qE 'RULE_IDS\[|RULE_PATTERNS\[' \
        "$TASK_AI_ROOT/skills/security/scripts/security.sh"; then
        pass "S3: security.sh uses rule-loader arrays"
    else
        fail "S3: security.sh doesn't use standard rule arrays"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# S4: security.sh verify_cmd should use dynamic rules
# ─────────────────────────────────────────────────────────────────────────────
test_S4_verify_cmd_uses_dynamic_rules() {
    if grep -A30 '^verify_cmd()' "$TASK_AI_ROOT/skills/security/scripts/security.sh" | \
       grep -qE 'load_rules_from_domain|RULE_PATTERNS'; then
        pass "S4: verify_cmd uses dynamic rules"
    else
        fail "S4: verify_cmd only has hardcoded rules"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# S5: security.sh audit_plan should use dynamic rules
# ─────────────────────────────────────────────────────────────────────────────
test_S5_audit_plan_uses_dynamic_rules() {
    if grep -A30 '^audit_plan()' "$TASK_AI_ROOT/skills/security/scripts/security.sh" | \
       grep -qE 'load_rules_from_domain|RULE_PATTERNS'; then
        pass "S5: audit_plan uses dynamic rules"
    else
        fail "S5: audit_plan only has hardcoded rules"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# E1: exec.sh should call security verify-cmd
# ─────────────────────────────────────────────────────────────────────────────
test_E1_exec_calls_verify_cmd() {
    if grep -qE 'security\.sh.*verify-cmd|SECURITY.*verify-cmd' \
        "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"; then
        pass "E1: exec.sh calls security verify-cmd"
    else
        fail "E1: exec.sh missing security verify-cmd call"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# C2: check.sh should call security audit-plan (post-plan checkpoint)
# ─────────────────────────────────────────────────────────────────────────────
test_C2_check_calls_audit_plan() {
    if grep -qE 'security\.sh.*audit-plan|SECURITY.*audit-plan' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "C2: check.sh calls security audit-plan"
    else
        fail "C2: check.sh missing security audit-plan call"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# E2: exec.sh should not use eval for command execution (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_E2_no_eval_injection() {
    # eval "$cmd" is dangerous - should use safer alternatives
    if grep -qE 'eval\s+"\$cmd"' "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"; then
        fail "E2: exec.sh uses dangerous eval for command execution"
    else
        pass "E2: exec.sh avoids eval injection risk"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# E3: exec.sh should warn if security script missing (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_E3_security_missing_warning() {
    if grep -qE 'else.*WARN|SECURITY_SH.*not.*found|security.*missing' \
        "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"; then
        pass "E3: exec.sh warns when security script missing"
    else
        fail "E3: exec.sh silently skips security when script missing"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# C3: check.sh SECURITY_SH should be defined once at top (D6)
# ─────────────────────────────────────────────────────────────────────────────
test_C3_security_path_not_duplicated() {
    local count
    count=$(grep -c 'SECURITY_SH=.*security\.sh' "$TASK_AI_ROOT/skills/check/scripts/check.sh" || echo 0)
    if [[ "$count" -le 1 ]]; then
        pass "C3: check.sh has single SECURITY_SH definition"
    else
        fail "C3: check.sh has duplicate SECURITY_SH definitions ($count)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R6: research.sh audit mode should not write .auto-signal to empty path (D1)
# ─────────────────────────────────────────────────────────────────────────────
test_R6_audit_no_empty_auto_signal() {
    # Audit mode should either skip .auto-signal or use a valid path
    # BAD: echo '...' > "$WORK_DIR/.auto-signal" when WORK_DIR is empty
    # GOOD: Check if WORK_DIR is set, or use LIB_PATH
    if grep -A5 'caller.*audit' "$TASK_AI_ROOT/skills/research/scripts/research.sh" | \
       grep -qE 'WORK_DIR=|audit.*not.*auto-signal|skip.*auto-signal'; then
        pass "R6: research.sh audit mode handles .auto-signal correctly"
    else
        # Check if there's a guard before writing
        if grep -B2 'auto-signal' "$TASK_AI_ROOT/skills/research/scripts/research.sh" | \
           grep -qE '\[\[ -n.*WORK_DIR|if.*WORK_DIR'; then
            pass "R6: research.sh guards .auto-signal write"
        else
            fail "R6: research.sh audit mode may write .auto-signal to empty path"
        fi
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R7: research.sh should guard against empty SLUG (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_R7_slug_empty_guard() {
    if grep -A3 'SLUG=' "$TASK_AI_ROOT/skills/research/scripts/research.sh" | \
       grep -qE '\[\[ -z.*SLUG|SLUG:-|if.*SLUG.*empty'; then
        pass "R7: research.sh guards against empty SLUG"
    else
        fail "R7: research.sh may have empty SLUG issue"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R8: research.sh LIB_PATH should not be redefined in audit mode (D5)
# ─────────────────────────────────────────────────────────────────────────────
test_R8_lib_path_not_duplicated() {
    local count
    count=$(grep -c '^LIB_PATH=' "$TASK_AI_ROOT/skills/research/scripts/research.sh" || echo 0)
    if [[ "$count" -le 1 ]]; then
        pass "R8: research.sh has single LIB_PATH definition"
    else
        fail "R8: research.sh has duplicate LIB_PATH definitions ($count)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R9: research.sh should check detect_stage.py existence (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_R9_detect_stage_py_check() {
    # Check for existence validation: [[ -f or [[ ! -f
    if grep -qE '\[\[.*-f.*DETECT_STAGE_PY|if.*-f.*detect_stage\.py' \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R9: research.sh checks detect_stage.py existence"
    else
        fail "R9: research.sh calls detect_stage.py without existence check"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R10: research.sh should validate STAGE variable (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_R10_stage_variable_validated() {
    # STAGE should be validated for injection-safe characters
    if grep -qE 'STAGE.*=~|STAGE.*tr -cd|validate.*STAGE|sanitize.*STAGE' \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R10: research.sh validates STAGE variable"
    else
        fail "R10: research.sh uses STAGE without validation"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R11: research.sh cp command should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_R11_cp_error_handling() {
    # cp should have error handling: cp ... || { handle; }
    if grep -qE 'cp.*\|\|.*echo|cp.*2>&1|cp.*&&.*NEGATIVE' \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R11: research.sh cp command has error handling"
    else
        fail "R11: research.sh cp command lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R12: research.sh heredoc should use safe delimiter (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_R12_heredoc_safe_delimiter() {
    # Heredoc should use 'EOF' (quoted) to prevent variable expansion issues
    # or use a unique delimiter unlikely to appear in TOPIC
    if grep -qE "<<\s*'EOF'|<<\s*'RESEARCH_END'|<<-\s*'.*'" \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R12: research.sh heredoc uses safe quoted delimiter"
    else
        fail "R12: research.sh heredoc may have EOF collision risk"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R13: research.sh dangerous pattern check should scan full file (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_R13_full_file_dangerous_check() {
    # Should not limit to first 1024 bytes, or should have documented reason
    if grep -qE 'head.*-c.*1024.*dangerous' "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        # Check if there's documentation or secondary full check
        if grep -qE '#.*1024.*performance|#.*first.*bytes.*optimization|grep.*dangerous.*\$exp_file' \
            "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
            pass "R13: research.sh documents 1024-byte limit rationale or has full check"
        else
            fail "R13: research.sh dangerous pattern check limited to 1024 bytes without justification"
        fi
    else
        pass "R13: research.sh checks full file for dangerous patterns"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R14: research.sh sed substitution should escape & character (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_R14_sed_ampersand_safe() {
    # sed & means "matched content" - must be escaped in replacement
    # Safe patterns: escaping & before sed, or using awk/python
    if grep -qE 'TOPIC.*//&/\\\\&|TOPIC_ESCAPED.*&' \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R14: research.sh escapes & in TOPIC for sed"
    else
        # Check if sed is not used for TOPIC substitution
        if ! grep -qE 'sed.*TOPIC_PLACEHOLDER' "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
            pass "R14: research.sh does not use sed for TOPIC substitution"
        else
            fail "R14: research.sh sed TOPIC substitution may have & injection"
        fi
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R15: research.sh should not use echo -e with STAGE variable (D1/D2)
# ─────────────────────────────────────────────────────────────────────────────
test_R15_no_echo_e_stage() {
    # echo -e interprets escape sequences - dangerous with user-influenced vars
    if grep -qE 'echo\s+-e.*\$STAGE' "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        fail "R15: research.sh uses echo -e with STAGE variable"
    else
        pass "R15: research.sh avoids echo -e with STAGE"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R16: research.sh mv archive should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_R16_mv_error_handling() {
    # mv should have error handling: if mv ... 2>&1; then or mv ... || { handle; }
    if grep -qE 'if mv.*ARCHIVE|mv.*ARCHIVE.*\|\||mv.*ARCHIVE.*2>&1' \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "R16: research.sh mv archive has error handling"
    else
        fail "R16: research.sh mv archive lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# R17: research.sh YAML_PARSER should be used or removed (D6)
# ─────────────────────────────────────────────────────────────────────────────
test_R17_no_unused_yaml_parser() {
    # YAML_PARSER should either be used or have comment explaining retention
    if grep -qE 'YAML_PARSER=' "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        # Check if it's used or has retention comment
        if grep -qE '\$YAML_PARSER|#.*YAML_PARSER.*future|#.*YAML_PARSER.*reserved' \
            "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
            pass "R17: research.sh YAML_PARSER is used or documented"
        else
            fail "R17: research.sh has unused YAML_PARSER variable"
        fi
    else
        pass "R17: research.sh has no unused YAML_PARSER"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# T1: target.sh heredoc should use quoted delimiter (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_T1_heredoc_quoted_delimiter() {
    # heredoc with unquoted EOF allows variable expansion - risky with user input
    # Check for quoted 'EOF' or 'TARGET_END' etc
    if grep -qE "<<\s*'[A-Z_]+'" "$TASK_AI_ROOT/skills/target/scripts/target.sh" || \
       ! grep -qE '<<\s*EOF' "$TASK_AI_ROOT/skills/target/scripts/target.sh"; then
        pass "T1: target.sh heredoc uses safe delimiter"
    else
        fail "T1: target.sh heredoc may have variable expansion risk"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# T2: target.sh mv should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_T2_mv_error_handling() {
    # mv TMP_FILE should have error handling
    if grep -qE 'if mv.*TMP_FILE|mv.*TMP_FILE.*\|\||mv.*TMP_FILE.*2>&1' \
        "$TASK_AI_ROOT/skills/target/scripts/target.sh"; then
        pass "T2: target.sh mv has error handling"
    else
        fail "T2: target.sh mv lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# P1: plan.sh should use printf for REFINE_CONTENT (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_P1_printf_refine_content() {
    # echo with user input can interpret -n/-e as options
    # Should use printf for safety
    if grep -qE 'printf.*REFINE_CONTENT|printf.*DATE.*REFINE' \
        "$TASK_AI_ROOT/skills/plan/scripts/plan.sh"; then
        pass "P1: plan.sh uses printf for REFINE_CONTENT"
    else
        fail "P1: plan.sh uses echo for REFINE_CONTENT (unsafe)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# P2: plan.sh git add/commit should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_P2_git_error_handling() {
    # git add/commit should have error handling like target.sh
    if grep -qE 'if.*git add|git add.*\|\||git add.*2>&1' \
        "$TASK_AI_ROOT/skills/plan/scripts/plan.sh"; then
        pass "P2: plan.sh git commands have error handling"
    else
        fail "P2: plan.sh git commands lack error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# P3: plan.sh mv should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_P3_mv_error_handling() {
    # mv for archiving should have error handling
    if grep -qE 'if.*mv.*plan|mv.*plan.*\|\||mv.*plan.*2>&1|if ! mv' \
        "$TASK_AI_ROOT/skills/plan/scripts/plan.sh"; then
        pass "P3: plan.sh mv has error handling"
    else
        fail "P3: plan.sh mv lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# P4: plan.sh STATE_PY should have existence check (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_P4_state_py_existence_check() {
    if grep -qE '\[\[.*-f.*STATE_PY|if.*-f.*state\.py' \
        "$TASK_AI_ROOT/skills/plan/scripts/plan.sh"; then
        pass "P4: plan.sh checks STATE_PY existence"
    else
        fail "P4: plan.sh calls state.py without existence check"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# P5: plan.sh python3 state.py calls should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_P5_python_error_handling() {
    # python3 state.py calls should have error handling or || fallback
    if grep -qE 'python3.*STATE_PY.*\|\||if.*python3.*STATE_PY|python3.*STATE_PY.*2>&1' \
        "$TASK_AI_ROOT/skills/plan/scripts/plan.sh"; then
        pass "P5: plan.sh python3 calls have error handling"
    else
        fail "P5: plan.sh python3 calls lack error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# P6: plan.sh SESSION_CONTEXT write should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_P6_session_context_error_handling() {
    # SESSION_CONTEXT write should have error handling like target.sh
    if grep -qE 'if.*printf.*SESSION_CONTEXT|if ! cat.*SESSION_CONTEXT|SESSION_CONTEXT.*2>&1' \
        "$TASK_AI_ROOT/skills/plan/scripts/plan.sh"; then
        pass "P6: plan.sh SESSION_CONTEXT write has error handling"
    else
        fail "P6: plan.sh SESSION_CONTEXT write lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# P7: plan.sh generate mode should commit changes (D1 consistency)
# ─────────────────────────────────────────────────────────────────────────────
test_P7_generate_commits() {
    # Generate mode should commit like refine mode for consistency
    # Check for git commit after plan generation (Mode 3 section spans ~100 lines)
    if grep -A100 '# Mode 3: Generate plan' "$TASK_AI_ROOT/skills/plan/scripts/plan.sh" | \
       grep -qE 'git commit.*plan.*generate|git commit.*:plan.*generate'; then
        pass "P7: plan.sh generate mode commits changes"
    else
        fail "P7: plan.sh generate mode does not commit (inconsistent with refine)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# IN1: init.sh git add/commit should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_IN1_git_error_handling() {
    # git add/commit should have error handling like other scripts
    if grep -qE 'if.*git add|git add.*\|\||if ! git add' \
        "$TASK_AI_ROOT/skills/init/scripts/init.sh"; then
        pass "IN1: init.sh git commands have error handling"
    else
        fail "IN1: init.sh git commands lack error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# IN2: init.sh TAGS should handle empty input correctly (D1)
# ─────────────────────────────────────────────────────────────────────────────
test_IN2_tags_empty_handling() {
    # Empty tags input should produce [] not [""]
    # Check for guard against empty sanitized result
    if grep -qE 'TAGS.*-z.*TAGS|if.*SANITIZED.*empty|TAGS="\[\]".*default|\[\[ -z.*SANITIZED' \
        "$TASK_AI_ROOT/skills/init/scripts/init.sh"; then
        pass "IN2: init.sh handles empty TAGS correctly"
    else
        fail "IN2: init.sh empty TAGS may produce invalid JSON"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# V1: verify.sh file writes should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_V1_file_write_error_handling() {
    # cat > file should have error handling
    if grep -qE 'if.*cat.*TEST_FILE|if ! cat|cat.*>.*2>&1' \
        "$TASK_AI_ROOT/skills/verify/scripts/verify.sh"; then
        pass "V1: verify.sh file writes have error handling"
    else
        fail "V1: verify.sh file writes lack error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# V2: verify.sh STEP_NUM should be validated (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_V2_step_num_validated() {
    # STEP_NUM should be validated to contain only digits
    if grep -qE 'STEP_NUM.*=~|STEP_NUM.*tr -cd|validate.*STEP_NUM|\[\[.*STEP_NUM.*\^' \
        "$TASK_AI_ROOT/skills/verify/scripts/verify.sh"; then
        pass "V2: verify.sh validates STEP_NUM"
    else
        fail "V2: verify.sh STEP_NUM not validated"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# V3: verify.sh should handle empty CHECKPOINT (D1)
# ─────────────────────────────────────────────────────────────────────────────
test_V3_empty_checkpoint_handling() {
    # Empty CHECKPOINT should default to 'quick' or show warning
    if grep -qE 'CHECKPOINT:-quick|CHECKPOINT.*:-.*quick|\[\[ -z.*CHECKPOINT' \
        "$TASK_AI_ROOT/skills/verify/scripts/verify.sh"; then
        pass "V3: verify.sh handles empty CHECKPOINT"
    else
        fail "V3: verify.sh does not handle empty CHECKPOINT"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CK1: check.sh audit-validate mv should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_CK1_mv_error_handling() {
    # mv commands for rule activation should have error handling
    if grep -qE 'if.*mv.*candidate|if ! mv.*candidate|mv.*candidate.*\|\|' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "CK1: check.sh mv has error handling"
    else
        fail "CK1: check.sh mv lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CK2: check.sh python3 STATE_PY should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_CK2_python_error_handling() {
    # python3 STATE_PY calls should have error handling
    if grep -qE 'if.*python3.*STATE_PY|python3.*STATE_PY.*\|\||if ! python3.*STATE_PY' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "CK2: check.sh python3 calls have error handling"
    else
        fail "CK2: check.sh python3 calls lack error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CK3: check.sh cp -r for skill promotion should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_CK3_cp_error_handling() {
    # cp -r commands for skill promotion should have error handling
    if grep -qE 'if.*cp -r|if ! cp -r|cp -r.*\|\|' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "CK3: check.sh cp -r has error handling"
    else
        fail "CK3: check.sh cp -r lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CK4: check.sh should handle empty CHECKPOINT (D1)
# ─────────────────────────────────────────────────────────────────────────────
test_CK4_empty_checkpoint_handling() {
    # Empty CHECKPOINT should default to a value or produce an error
    if grep -qE 'CHECKPOINT:-|CHECKPOINT.*:-|if.*-z.*CHECKPOINT|\[\[ -z.*CHECKPOINT' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "CK4: check.sh handles empty CHECKPOINT"
    else
        fail "CK4: check.sh does not handle empty CHECKPOINT"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CK5: check.sh STATE_PY should have existence check (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_CK5_state_py_existence_check() {
    if grep -qE '\[\[.*-f.*STATE_PY|if.*-f.*state\.py' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "CK5: check.sh checks STATE_PY existence"
    else
        fail "CK5: check.sh calls state.py without existence check"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# EX4: exec.sh STATE_PY should have existence check (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_EX4_state_py_existence_check() {
    if grep -qE '\[\[.*-f.*STATE_PY|if.*-f.*state\.py|\[\[ ! -f.*STATE_PY' \
        "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"; then
        pass "EX4: exec.sh checks STATE_PY existence"
    else
        fail "EX4: exec.sh calls state.py without existence check"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# EX5: exec.sh python3 STATE_PY should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_EX5_python_error_handling() {
    # python3 STATE_PY calls should have error handling
    if grep -qE 'if.*python3.*STATE_PY|python3.*STATE_PY.*\|\||if ! python3.*STATE_PY' \
        "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"; then
        pass "EX5: exec.sh python3 calls have error handling"
    else
        fail "EX5: exec.sh python3 calls lack error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# EX6: exec.sh TYPE should have default/fallback value (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_EX6_type_default_value() {
    # TYPE should have a fallback if python3 call fails
    if grep -qE 'TYPE=.*\|\||TYPE:-|TYPE.*:-|if.*-z.*TYPE' \
        "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"; then
        pass "EX6: exec.sh TYPE has default/fallback"
    else
        fail "EX6: exec.sh TYPE has no fallback on failure"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# EX7: exec.sh transition should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_EX7_transition_error_handling() {
    # python3 STATE_PY transition should have error handling
    if grep -qE 'if.*python3.*transition|if ! python3.*transition|transition.*\|\|' \
        "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"; then
        pass "EX7: exec.sh transition has error handling"
    else
        fail "EX7: exec.sh transition lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# EX8: exec.sh TARGET_STEP should be validated as number (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_EX8_target_step_validated() {
    # TARGET_STEP should be validated to contain only digits
    if grep -qE 'TARGET_STEP.*=~|TARGET_STEP.*\^[0-9]|\[\[.*TARGET_STEP.*-gt.*0' \
        "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"; then
        pass "EX8: exec.sh validates TARGET_STEP"
    else
        fail "EX8: exec.sh TARGET_STEP not validated"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# EX9: exec.sh file writes should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_EX9_file_write_error_handling() {
    # cat > file should have error handling
    if grep -qE 'if.*cat.*NOTES|if ! cat|cat.*>.*2>&1' \
        "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"; then
        pass "EX9: exec.sh file writes have error handling"
    else
        fail "EX9: exec.sh file writes lack error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# EX10: exec.sh COMPLETED should be validated as number (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_EX10_completed_validated() {
    # COMPLETED should be validated to contain only digits
    if grep -qE 'COMPLETED.*=~|COMPLETED.*\^[0-9]|COMPLETED.*tr -cd' \
        "$TASK_AI_ROOT/skills/exec/scripts/exec.sh"; then
        pass "EX10: exec.sh validates COMPLETED"
    else
        fail "EX10: exec.sh COMPLETED not validated"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# LIB1: lib.sh init-lib.sh call should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_LIB1_init_lib_error_handling() {
    # bash $init_script should have error handling or warning
    if grep -qE 'if.*bash.*init_script|bash.*init_script.*\|\||if ! bash.*init_script' \
        "$TASK_AI_ROOT/core/lib.sh"; then
        pass "LIB1: lib.sh init-lib.sh has error handling"
    else
        fail "LIB1: lib.sh init-lib.sh lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# ILIB1: init-lib.sh cp template should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_ILIB1_cp_error_handling() {
    if grep -qE 'if.*cp.*INTEL_TEMPLATE|if ! cp.*INTEL_TEMPLATE|cp.*INTEL_TEMPLATE.*\|\|' \
        "$TASK_AI_ROOT/skills/library/scripts/init-lib.sh"; then
        pass "ILIB1: init-lib.sh cp has error handling"
    else
        fail "ILIB1: init-lib.sh cp lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# ILIB2: init-lib.sh git init should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_ILIB2_git_init_error_handling() {
    if grep -qE 'if.*git init|if ! git init|git init.*\|\|' \
        "$TASK_AI_ROOT/skills/library/scripts/init-lib.sh"; then
        pass "ILIB2: init-lib.sh git init has error handling"
    else
        fail "ILIB2: init-lib.sh git init lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# SEC1: security.sh audit_plan cat should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_SEC1_audit_plan_cat_error_handling() {
    # cat "$plan_md" should have error handling or file existence check before
    # audit_plan spans L118-178, check for existence guard in that function
    if grep -A60 '^audit_plan()' "$TASK_AI_ROOT/skills/security/scripts/security.sh" | \
       grep -qE 'if.*-f.*plan_md|if.*!.*-f.*plan_md'; then
        pass "SEC1: security.sh audit_plan checks file existence before cat"
    else
        fail "SEC1: security.sh audit_plan cat lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# SEC2: security.sh scan_skill cat should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_SEC2_scan_skill_cat_error_handling() {
    # cat "$skill_md" should have error handling or file existence check before
    # scan_skill function checks file existence at L196-199
    if grep -A20 '^scan_skill()' "$TASK_AI_ROOT/skills/security/scripts/security.sh" | \
       grep -qE 'if.*-f.*skill_md|if.*!.*-f.*skill_md'; then
        pass "SEC2: security.sh scan_skill checks file existence before cat"
    else
        fail "SEC2: security.sh scan_skill cat lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# SEC3: security.sh code_blocks variable should be used or removed (D6)
# ─────────────────────────────────────────────────────────────────────────────
test_SEC3_no_unused_code_blocks() {
    # code_blocks should be used after assignment, or not exist
    if grep -q 'code_blocks=' "$TASK_AI_ROOT/skills/security/scripts/security.sh"; then
        # Check if it's used after assignment
        if grep -qE '\$code_blocks|"$code_blocks"' "$TASK_AI_ROOT/skills/security/scripts/security.sh"; then
            pass "SEC3: security.sh code_blocks is used"
        else
            # Check if there's a comment explaining why it exists
            if grep -B1 'code_blocks=' "$TASK_AI_ROOT/skills/security/scripts/security.sh" | \
               grep -qE '#.*future|#.*reserved|#.*TODO'; then
                pass "SEC3: security.sh code_blocks has documented purpose"
            else
                fail "SEC3: security.sh has unused code_blocks variable"
            fi
        fi
    else
        pass "SEC3: security.sh has no unused code_blocks"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MG1: merge.sh STATE_PY should have existence check (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MG1_state_py_existence_check() {
    if grep -qE '\[\[.*-f.*STATE_PY|if.*-f.*state\.py|\[\[ ! -f.*STATE_PY' \
        "$TASK_AI_ROOT/skills/merge/scripts/merge.sh"; then
        pass "MG1: merge.sh checks STATE_PY existence"
    else
        fail "MG1: merge.sh calls state.py without existence check"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MG2: merge.sh python3 transition evolving should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MG2_stage_transition_error_handling() {
    if grep -qE 'if.*python3.*evolving|if ! python3.*evolving|evolving.*\|\|' \
        "$TASK_AI_ROOT/skills/merge/scripts/merge.sh"; then
        pass "MG2: merge.sh stage transition has error handling"
    else
        fail "MG2: merge.sh stage transition lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MG3: merge.sh unified evolving path — no --status complete in merge.sh (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MG3_unified_evolving_path() {
    if ! grep -qE '\-\-status complete' \
        "$TASK_AI_ROOT/skills/merge/scripts/merge.sh"; then
        pass "MG3: merge.sh has no --status complete (unified evolving path)"
    else
        fail "MG3: merge.sh still contains --status complete"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MG4: merge.sh STAGE_CURRENT should be validated as number (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_MG4_stage_numbers_validated() {
    if grep -qE 'STAGE_CURRENT.*=~|\[\[.*STAGE.*\^[0-9]' \
        "$TASK_AI_ROOT/skills/merge/scripts/merge.sh"; then
        pass "MG4: merge.sh validates STAGE numbers"
    else
        fail "MG4: merge.sh STAGE numbers not validated"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MG5: merge.sh should write .auto-signal (D1 consistency with SKILL.md)
# ─────────────────────────────────────────────────────────────────────────────
test_MG5_writes_auto_signal() {
    if grep -qE '\.auto-signal|auto-signal' \
        "$TASK_AI_ROOT/skills/merge/scripts/merge.sh"; then
        pass "MG5: merge.sh writes .auto-signal"
    else
        fail "MG5: merge.sh does not write .auto-signal (SKILL.md requires it)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MG6: merge.sh git checkout back to task branch should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MG6_checkout_task_branch_error_handling() {
    # The second git checkout (back to task branch) should have error handling
    if grep -qE 'git checkout.*TASK_BRANCH.*\|\||if.*git checkout.*TASK_BRANCH|checkout.*TASK_BRANCH.*2>&1' \
        "$TASK_AI_ROOT/skills/merge/scripts/merge.sh"; then
        pass "MG6: merge.sh checkout to task branch has error handling"
    else
        fail "MG6: merge.sh checkout to task branch lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MG7: merge.sh .auto-signal write should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MG7_auto_signal_write_error_handling() {
    if grep -qE 'if.*cat.*auto-signal|if ! cat.*auto-signal|auto-signal.*2>&1' \
        "$TASK_AI_ROOT/skills/merge/scripts/merge.sh"; then
        pass "MG7: merge.sh .auto-signal write has error handling"
    else
        fail "MG7: merge.sh .auto-signal write lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MG8: merge.sh git merge --abort should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MG8_merge_abort_error_handling() {
    if grep -qE 'merge --abort.*\|\||if.*merge --abort|merge --abort.*2>&1' \
        "$TASK_AI_ROOT/skills/merge/scripts/merge.sh"; then
        pass "MG8: merge.sh merge --abort has error handling"
    else
        fail "MG8: merge.sh merge --abort lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MG9: merge.sh evolving path should write .auto-signal (D1)
# ─────────────────────────────────────────────────────────────────────────────
test_MG9_evolving_auto_signal() {
    # Check that evolving branch also writes .auto-signal
    if grep -A10 'status evolving' "$TASK_AI_ROOT/skills/merge/scripts/merge.sh" | \
       grep -qE 'auto-signal|evolving.*signal'; then
        pass "MG9: merge.sh evolving writes .auto-signal"
    else
        fail "MG9: merge.sh evolving missing .auto-signal"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MG10: merge.sh should git commit state files (D1 per SKILL.md)
# ─────────────────────────────────────────────────────────────────────────────
test_MG10_git_commit() {
    if grep -qE 'git commit.*merge|git add.*index' \
        "$TASK_AI_ROOT/skills/merge/scripts/merge.sh"; then
        pass "MG10: merge.sh performs git commit"
    else
        fail "MG10: merge.sh missing git commit"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RP1: report.sh STATE_PY should have existence check (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RP1_state_py_existence_check() {
    if grep -qE '\[\[.*-f.*STATE_PY|if.*-f.*state\.py|\[\[ ! -f.*STATE_PY' \
        "$TASK_AI_ROOT/skills/report/scripts/report.sh"; then
        pass "RP1: report.sh checks STATE_PY existence"
    else
        fail "RP1: report.sh calls state.py without existence check"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RP2: report.sh python3 calls should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RP2_python_error_handling() {
    if grep -qE 'python3.*STATE_PY.*\|\||python3.*STATE_PY.*2>/dev/null' \
        "$TASK_AI_ROOT/skills/report/scripts/report.sh"; then
        pass "RP2: report.sh python3 calls have error handling"
    else
        fail "RP2: report.sh python3 calls lack error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RP3: report.sh report file write should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RP3_report_write_error_handling() {
    if grep -qE 'if.*cat.*REPORT_FILE|if ! cat.*REPORT_FILE|REPORT_FILE.*2>&1' \
        "$TASK_AI_ROOT/skills/report/scripts/report.sh"; then
        pass "RP3: report.sh report write has error handling"
    else
        fail "RP3: report.sh report write lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RP4: report.sh should write .auto-signal (D1)
# ─────────────────────────────────────────────────────────────────────────────
test_RP4_writes_auto_signal() {
    if grep -qE '\.auto-signal|auto-signal' \
        "$TASK_AI_ROOT/skills/report/scripts/report.sh"; then
        pass "RP4: report.sh writes .auto-signal"
    else
        fail "RP4: report.sh does not write .auto-signal"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RP5: report.sh should git commit (D1)
# ─────────────────────────────────────────────────────────────────────────────
test_RP5_git_commit() {
    if grep -qE 'git commit|git add' \
        "$TASK_AI_ROOT/skills/report/scripts/report.sh"; then
        pass "RP5: report.sh performs git commit"
    else
        fail "RP5: report.sh does not git commit"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RP6: report.sh maintain.sh call should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RP6_maintain_error_handling() {
    if grep -qE 'if.*MAINTAIN_SH|MAINTAIN_SH.*\|\||MAINTAIN_SH.*2>&1' \
        "$TASK_AI_ROOT/skills/report/scripts/report.sh"; then
        pass "RP6: report.sh maintain.sh call has error handling"
    else
        fail "RP6: report.sh maintain.sh call lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RP7: report.sh FORMAT parameter should be used (D1/D6)
# ─────────────────────────────────────────────────────────────────────────────
test_RP7_format_parameter_used() {
    # FORMAT is parsed at L19, should be used somewhere
    if grep -qE 'FORMAT.*full|FORMAT.*summary|if.*FORMAT|\$FORMAT' \
        "$TASK_AI_ROOT/skills/report/scripts/report.sh"; then
        pass "RP7: report.sh FORMAT parameter is used"
    else
        fail "RP7: report.sh FORMAT parameter parsed but never used"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RP8: report.sh --format argument should validate $2 exists (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RP8_format_argument_validated() {
    # Should check that $2 exists before shift 2, or use ${2:-} pattern
    if grep -qE '\-\-format\).*\$\{2:-|\-\-format\).*if.*-z.*\$2|shift 2 2>/dev/null' \
        "$TASK_AI_ROOT/skills/report/scripts/report.sh"; then
        pass "RP8: report.sh --format validates argument exists"
    else
        fail "RP8: report.sh --format shift 2 without checking \$2 exists"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RP9: report.sh should not have unused variables (D6)
# ─────────────────────────────────────────────────────────────────────────────
test_RP9_no_unused_variables() {
    # Check that NB_ROOT and LIB_PATH are either used or removed
    local has_nb_root has_lib_path uses_nb_root uses_lib_path
    has_nb_root=$(grep -c 'NB_ROOT=' "$TASK_AI_ROOT/skills/report/scripts/report.sh" || echo 0)
    has_lib_path=$(grep -c 'LIB_PATH=' "$TASK_AI_ROOT/skills/report/scripts/report.sh" || echo 0)
    uses_nb_root=$(grep -cE '\$NB_ROOT|\${NB_ROOT}' "$TASK_AI_ROOT/skills/report/scripts/report.sh" | head -1 || echo 0)
    uses_lib_path=$(grep -cE '\$LIB_PATH|\${LIB_PATH}' "$TASK_AI_ROOT/skills/report/scripts/report.sh" | head -1 || echo 0)

    # If defined but not used (beyond assignment), that's dead code
    if [[ "$has_nb_root" -gt 0 && "$uses_nb_root" -le 1 ]] || \
       [[ "$has_lib_path" -gt 0 && "$uses_lib_path" -le 1 ]]; then
        fail "RP9: report.sh has unused NB_ROOT or LIB_PATH variables"
    else
        pass "RP9: report.sh has no unused variables"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# AU1: auto.sh STATE_PY should have existence check (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_AU1_state_py_existence_check() {
    if grep -qE '\[\[.*-f.*STATE_PY|if.*-f.*state\.py|\[\[ ! -f.*STATE_PY' \
        "$TASK_AI_ROOT/skills/auto/scripts/auto.sh"; then
        pass "AU1: auto.sh checks STATE_PY existence"
    else
        fail "AU1: auto.sh calls state.py without existence check"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# AU2: auto.sh python3 call should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_AU2_python_error_handling() {
    if grep -qE 'python3.*STATE_PY.*\|\||python3.*STATE_PY.*2>/dev/null' \
        "$TASK_AI_ROOT/skills/auto/scripts/auto.sh"; then
        pass "AU2: auto.sh python3 call has error handling"
    else
        fail "AU2: auto.sh python3 call lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# AU3: auto.sh .auto-signal write should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_AU3_auto_signal_write_error_handling() {
    if grep -qE 'if.*cat.*SIGNAL_FILE|if ! cat.*SIGNAL_FILE|SIGNAL_FILE.*2>&1' \
        "$TASK_AI_ROOT/skills/auto/scripts/auto.sh"; then
        pass "AU3: auto.sh .auto-signal write has error handling"
    else
        fail "AU3: auto.sh .auto-signal write lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# AU4: auto.sh ACTION parameter should be used (D1/D6)
# ─────────────────────────────────────────────────────────────────────────────
test_AU4_action_parameter_used() {
    # ACTION is parsed (--stop/--status), should be used
    if grep -qE 'case.*ACTION|if.*ACTION|\$ACTION' \
        "$TASK_AI_ROOT/skills/auto/scripts/auto.sh"; then
        pass "AU4: auto.sh ACTION parameter is used"
    else
        fail "AU4: auto.sh ACTION parameter parsed but never used"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RD1: read.sh cat FILE_PATH should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RD1_cat_error_handling() {
    if grep -qE 'if.*cat.*FILE_PATH|cat.*FILE_PATH.*\|\||CONTENT.*\|\|' \
        "$TASK_AI_ROOT/skills/read/scripts/read.sh"; then
        pass "RD1: read.sh cat has error handling"
    else
        fail "RD1: read.sh cat lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RD2: read.sh mkdir should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RD2_mkdir_error_handling() {
    if grep -qE 'if.*mkdir|mkdir.*\|\||if ! mkdir' \
        "$TASK_AI_ROOT/skills/read/scripts/read.sh"; then
        pass "RD2: read.sh mkdir has error handling"
    else
        fail "RD2: read.sh mkdir lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RD3: read.sh mv should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RD3_mv_error_handling() {
    if grep -qE 'if.*mv.*TMP_FILE|mv.*TMP_FILE.*\|\||if ! mv' \
        "$TASK_AI_ROOT/skills/read/scripts/read.sh"; then
        pass "RD3: read.sh mv has error handling"
    else
        fail "RD3: read.sh mv lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RD4: read.sh changelog append should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RD4_changelog_error_handling() {
    if grep -qE 'if.*>>.*changelog|changelog.*\|\||if ! echo.*changelog' \
        "$TASK_AI_ROOT/skills/read/scripts/read.sh"; then
        pass "RD4: read.sh changelog append has error handling"
    else
        fail "RD4: read.sh changelog append lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RD5: read.sh maintain.sh call should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RD5_maintain_error_handling() {
    if grep -qE 'if.*MAINTAIN_SH.*rebuild|MAINTAIN_SH.*\|\||if ! .*MAINTAIN_SH' \
        "$TASK_AI_ROOT/skills/read/scripts/read.sh"; then
        pass "RD5: read.sh maintain.sh call has error handling"
    else
        fail "RD5: read.sh maintain.sh call lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RD6: read.sh DEPTH should be validated (D2)
# ─────────────────────────────────────────────────────────────────────────────
test_RD6_depth_validated() {
    if grep -qE 'DEPTH.*shallow.*deep|DEPTH.*=~|case.*DEPTH' \
        "$TASK_AI_ROOT/skills/read/scripts/read.sh"; then
        pass "RD6: read.sh validates DEPTH"
    else
        fail "RD6: read.sh DEPTH not validated"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# RD7: read.sh --depth argument should validate $2 exists (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_RD7_depth_argument_validated() {
    # Should check that $2 exists before shift 2, or use ${2:-} pattern
    if grep -qE '\-\-depth\).*\$\{2:-|\-\-depth\).*if.*-z.*\$2|shift 2 2>/dev/null' \
        "$TASK_AI_ROOT/skills/read/scripts/read.sh"; then
        pass "RD7: read.sh --depth validates argument exists"
    else
        fail "RD7: read.sh --depth shift 2 without checking \$2 exists"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# PR1: promote.sh initial mkdir should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_PR1_mkdir_error_handling() {
    # First mkdir should have error handling
    if grep -qE 'if.*mkdir.*CANDIDATES_DIR|mkdir.*CANDIDATES_DIR.*\|\||if ! mkdir.*CANDIDATES' \
        "$TASK_AI_ROOT/skills/highlight/scripts/promote.sh"; then
        pass "PR1: promote.sh mkdir has error handling"
    else
        fail "PR1: promote.sh mkdir lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# PR2: promote.sh candidate dir mkdir should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_PR2_candidate_mkdir_error_handling() {
    if grep -qE 'if.*mkdir.*candidate_dir|mkdir.*candidate_dir.*\|\||if ! mkdir.*candidate' \
        "$TASK_AI_ROOT/skills/highlight/scripts/promote.sh"; then
        pass "PR2: promote.sh candidate mkdir has error handling"
    else
        fail "PR2: promote.sh candidate mkdir lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# PR3: promote.sh file writes should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_PR3_file_write_error_handling() {
    if grep -qE 'if.*extract_skill_content|if ! .*>.*SKILL\.md|SKILL\.md.*\|\|' \
        "$TASK_AI_ROOT/skills/highlight/scripts/promote.sh"; then
        pass "PR3: promote.sh file write has error handling"
    else
        fail "PR3: promote.sh file write lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# PR4: promote.sh changelog append should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_PR4_changelog_error_handling() {
    if grep -qE 'if.*>>.*CHANGELOG|CHANGELOG.*\|\||if ! echo.*CHANGELOG' \
        "$TASK_AI_ROOT/skills/highlight/scripts/promote.sh"; then
        pass "PR4: promote.sh changelog append has error handling"
    else
        fail "PR4: promote.sh changelog append lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# PR5: promote.sh --target argument should validate $2 exists (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_PR5_target_argument_validated() {
    # Should check that $2 exists before shift 2, or use ${2:-} pattern
    if grep -qE '\-\-target\).*\$\{2:-|\-\-target\).*if.*-z.*\$2|shift 2 2>/dev/null' \
        "$TASK_AI_ROOT/skills/highlight/scripts/promote.sh"; then
        pass "PR5: promote.sh --target validates argument exists"
    else
        fail "PR5: promote.sh --target shift 2 without checking \$2 exists"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MT1: maintain.sh rebuild-index should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MT1_rebuild_index_error_handling() {
    if grep -qE 'if.*python3.*REBUILD_INDEX|python3.*REBUILD_INDEX.*\|\||if ! python3.*REBUILD_INDEX' \
        "$TASK_AI_ROOT/skills/library/scripts/maintain.sh"; then
        pass "MT1: maintain.sh rebuild-index has error handling"
    else
        fail "MT1: maintain.sh rebuild-index lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MT2: maintain.sh rebuild-relations should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MT2_rebuild_relations_error_handling() {
    if grep -qE 'if.*python3.*REBUILD_RELATIONS|python3.*REBUILD_RELATIONS.*\|\||if ! python3.*REBUILD_RELATIONS' \
        "$TASK_AI_ROOT/skills/library/scripts/maintain.sh"; then
        pass "MT2: maintain.sh rebuild-relations has error handling"
    else
        fail "MT2: maintain.sh rebuild-relations lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MT3: maintain.sh compact mkdir should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MT3_compact_mkdir_error_handling() {
    if grep -qE 'if.*mkdir.*ARCHIVE_DIR|mkdir.*ARCHIVE_DIR.*\|\||if ! mkdir.*ARCHIVE' \
        "$TASK_AI_ROOT/skills/library/scripts/maintain.sh"; then
        pass "MT3: maintain.sh compact mkdir has error handling"
    else
        fail "MT3: maintain.sh compact mkdir lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MT4: maintain.sh git add should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MT4_git_add_error_handling() {
    if grep -qE 'if.*git add|git add.*\|\||if ! git add' \
        "$TASK_AI_ROOT/skills/library/scripts/maintain.sh"; then
        pass "MT4: maintain.sh git add has error handling"
    else
        fail "MT4: maintain.sh git add lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MT5: maintain.sh git commit should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MT5_git_commit_error_handling() {
    if grep -qE 'if.*git commit|git commit.*\|\||if ! git commit' \
        "$TASK_AI_ROOT/skills/library/scripts/maintain.sh"; then
        pass "MT5: maintain.sh git commit has error handling"
    else
        fail "MT5: maintain.sh git commit lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MT6: maintain.sh compact cat append should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MT6_compact_cat_error_handling() {
    if grep -qE 'if.*cat.*CHANGELOG.*>>|if ! cat.*CHANGELOG|cat.*ARCHIVE.*\|\|' \
        "$TASK_AI_ROOT/skills/library/scripts/maintain.sh"; then
        pass "MT6: maintain.sh compact cat append has error handling"
    else
        fail "MT6: maintain.sh compact cat append lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MT7: maintain.sh compact mv should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MT7_compact_mv_error_handling() {
    if grep -qE 'if.*mv.*CHANGELOG.*ARCHIVE|if ! mv.*CHANGELOG|mv.*ARCHIVE.*\|\|' \
        "$TASK_AI_ROOT/skills/library/scripts/maintain.sh"; then
        pass "MT7: maintain.sh compact mv has error handling"
    else
        fail "MT7: maintain.sh compact mv lacks error handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# MT8: maintain.sh evolve-rules.sh execution should have error handling (D3)
# ─────────────────────────────────────────────────────────────────────────────
test_MT8_evolve_error_handling() {
    if grep -qE 'if.*bash.*EVOLVE_SCRIPT|bash.*EVOLVE_SCRIPT.*\|\||if ! bash.*EVOLVE' \
        "$TASK_AI_ROOT/skills/library/scripts/maintain.sh"; then
        pass "MT8: maintain.sh evolve-rules execution has error handling"
    else
        fail "MT8: maintain.sh evolve-rules execution lacks error handling"
    fi
}

# Run tests
echo "=== Evolve Loop D6 Tests ==="
test_R1_auto_signal_handles_empty_workdir
test_R2_intel_fetcher_error_handling
test_C1_pattern_extraction_robust
test_L1_grep_opts_safe_expansion
test_L2_json_parsing_robust
test_R3_experience_copy_validated
test_R4_no_duplicate_mkdir
test_R5_no_magic_strings
test_I1_api_response_validated
test_I2_no_duplicate_sample_functions
test_L3_has_caching
test_L4_configurable_paths
test_S1_delegates_to_rule_loader
test_S2_grep_opts_safe
test_S3_uses_rule_loader_arrays
test_S4_verify_cmd_uses_dynamic_rules
test_S5_audit_plan_uses_dynamic_rules
test_E1_exec_calls_verify_cmd
test_C2_check_calls_audit_plan
test_E2_no_eval_injection
test_E3_security_missing_warning
test_C3_security_path_not_duplicated
test_R6_audit_no_empty_auto_signal
test_R7_slug_empty_guard
test_R8_lib_path_not_duplicated
test_R9_detect_stage_py_check
test_R10_stage_variable_validated
test_R11_cp_error_handling
test_R12_heredoc_safe_delimiter
test_R13_full_file_dangerous_check
test_R14_sed_ampersand_safe
test_R15_no_echo_e_stage
test_R16_mv_error_handling
test_R17_no_unused_yaml_parser
test_T1_heredoc_quoted_delimiter
test_T2_mv_error_handling
test_P1_printf_refine_content
test_P2_git_error_handling
test_P3_mv_error_handling
test_P4_state_py_existence_check
test_P5_python_error_handling
test_P6_session_context_error_handling
test_P7_generate_commits
test_IN1_git_error_handling
test_IN2_tags_empty_handling
test_V1_file_write_error_handling
test_V2_step_num_validated
test_V3_empty_checkpoint_handling
test_CK1_mv_error_handling
test_CK2_python_error_handling
test_CK3_cp_error_handling
test_CK4_empty_checkpoint_handling
test_CK5_state_py_existence_check
test_EX4_state_py_existence_check
test_EX5_python_error_handling
test_EX6_type_default_value
test_EX7_transition_error_handling
test_EX8_target_step_validated
test_EX9_file_write_error_handling
test_EX10_completed_validated
test_LIB1_init_lib_error_handling
test_ILIB1_cp_error_handling
test_ILIB2_git_init_error_handling
test_SEC1_audit_plan_cat_error_handling
test_SEC2_scan_skill_cat_error_handling
test_SEC3_no_unused_code_blocks
test_MG1_state_py_existence_check
test_MG2_stage_transition_error_handling
test_MG3_unified_evolving_path
test_MG4_stage_numbers_validated
test_MG5_writes_auto_signal
test_MG6_checkout_task_branch_error_handling
test_MG7_auto_signal_write_error_handling
test_MG8_merge_abort_error_handling
test_MG9_evolving_auto_signal
test_MG10_git_commit
test_RP1_state_py_existence_check
test_RP2_python_error_handling
test_RP3_report_write_error_handling
test_RP4_writes_auto_signal
test_RP5_git_commit
test_RP6_maintain_error_handling
test_RP7_format_parameter_used
test_RP8_format_argument_validated
test_RP9_no_unused_variables
test_AU1_state_py_existence_check
test_AU2_python_error_handling
test_AU3_auto_signal_write_error_handling
test_AU4_action_parameter_used
test_RD1_cat_error_handling
test_RD2_mkdir_error_handling
test_RD3_mv_error_handling
test_RD4_changelog_error_handling
test_RD5_maintain_error_handling
test_RD6_depth_validated
test_RD7_depth_argument_validated
test_PR1_mkdir_error_handling
test_PR2_candidate_mkdir_error_handling
test_PR3_file_write_error_handling
test_PR4_changelog_error_handling
test_PR5_target_argument_validated
test_MT1_rebuild_index_error_handling
test_MT2_rebuild_relations_error_handling
test_MT3_compact_mkdir_error_handling
test_MT4_git_add_error_handling
test_MT5_git_commit_error_handling
test_MT6_compact_cat_error_handling
test_MT7_compact_mv_error_handling
test_MT8_evolve_error_handling
echo ""
echo "All tests passed."
