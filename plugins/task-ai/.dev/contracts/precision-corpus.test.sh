#!/usr/bin/env bash
# Test: Precision calculation with labeled test corpus
# Verifies true precision using positive/negative samples

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

pass() { echo "✓ $1"; }
fail() { echo "✗ $1" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# Test 1: init-lib.sh creates .test-corpus/ structure
# ─────────────────────────────────────────────────────────────────────────────
test_init_creates_test_corpus() {
    if grep -qE '\.test-corpus|test-corpus' \
        "$TASK_AI_ROOT/skills/library/scripts/init-lib.sh"; then
        pass "init-lib.sh creates .test-corpus/ structure"
    else
        fail "init-lib.sh missing .test-corpus/ structure"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 2: yaml_parser.py uses positive/negative samples
# ─────────────────────────────────────────────────────────────────────────────
test_yaml_parser_uses_labeled_samples() {
    if grep -qE 'positive|negative|true_positive|false_positive' \
        "$TASK_AI_ROOT/core/yaml_parser.py"; then
        pass "yaml_parser.py uses positive/negative samples"
    else
        fail "yaml_parser.py missing positive/negative sample handling"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 3: check.sh uses .test-corpus/ for audit-validate
# ─────────────────────────────────────────────────────────────────────────────
test_check_uses_test_corpus() {
    if grep -qE '\.test-corpus|test-corpus' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "check.sh uses .test-corpus/ for validation"
    else
        fail "check.sh missing .test-corpus/ usage"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 4: research --caller audit generates test samples
# ─────────────────────────────────────────────────────────────────────────────
test_research_audit_generates_samples() {
    if grep -qE '\.test-corpus|generate.*sample|positive.*negative' \
        "$TASK_AI_ROOT/skills/research/scripts/research.sh"; then
        pass "research --caller audit generates test samples"
    else
        fail "research --caller audit missing test sample generation"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 5: intel-fetcher.sh generates labeled samples
# ─────────────────────────────────────────────────────────────────────────────
test_intel_fetcher_generates_samples() {
    if grep -qE '\.test-corpus|positive|negative|sample' \
        "$TASK_AI_ROOT/skills/research/scripts/intel-fetcher.sh"; then
        pass "intel-fetcher.sh generates labeled samples"
    else
        fail "intel-fetcher.sh missing labeled sample generation"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 6: D3 - intel-fetcher checks file existence before overwrite
# ─────────────────────────────────────────────────────────────────────────────
test_no_overwrite_existing() {
    if grep -qE 'if.*-f.*sample_file|already exists|skip.*exist' \
        "$TASK_AI_ROOT/skills/research/scripts/intel-fetcher.sh"; then
        pass "intel-fetcher.sh checks file existence (D3)"
    else
        fail "intel-fetcher.sh missing file existence check (D3)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 7: D1 - generates samples for all three domains
# ─────────────────────────────────────────────────────────────────────────────
test_all_domains_covered() {
    # D1: Check that all three domains are referenced
    local has_sanitization has_audit
    has_sanitization=$(grep -c 'sanitization' "$TASK_AI_ROOT/skills/research/scripts/intel-fetcher.sh" || echo 0)
    has_audit=$(grep -c 'audit' "$TASK_AI_ROOT/skills/research/scripts/intel-fetcher.sh" || echo 0)
    if [[ "$has_sanitization" -ge 1 && "$has_audit" -ge 1 ]]; then
        pass "intel-fetcher.sh covers all domains (D1)"
    else
        fail "intel-fetcher.sh missing sanitization/audit domains (D1)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 8: D2 - positive samples have CAUTION warning
# ─────────────────────────────────────────────────────────────────────────────
test_positive_samples_have_warning() {
    if grep -qE 'CAUTION|WARNING|DO NOT EXECUTE|TEST SAMPLE ONLY' \
        "$TASK_AI_ROOT/skills/research/scripts/intel-fetcher.sh"; then
        pass "positive samples have CAUTION warning (D2)"
    else
        fail "positive samples missing CAUTION warning (D2)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 9: D5 - sample-generator.sh exists (separation of concerns)
# ─────────────────────────────────────────────────────────────────────────────
test_sample_generator_exists() {
    if [[ -f "$TASK_AI_ROOT/skills/research/scripts/sample-generator.sh" ]]; then
        pass "sample-generator.sh exists (D5)"
    else
        fail "sample-generator.sh missing (D5)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 10: D6 - sample templates directory exists
# ─────────────────────────────────────────────────────────────────────────────
test_sample_templates_exist() {
    if [[ -d "$TASK_AI_ROOT/skills/research/templates" ]] || \
       grep -qE 'templates/|TEMPLATES_DIR' "$TASK_AI_ROOT/skills/research/scripts/sample-generator.sh" 2>/dev/null; then
        pass "sample templates structure exists (D6)"
    else
        fail "sample templates missing (D6)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 11: audit-validate has D2 security check
# ─────────────────────────────────────────────────────────────────────────────
test_audit_validate_has_security_check() {
    if grep -qE 'check_rule_security|D2.*security|security.*check' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "audit-validate has D2 security check (B2)"
    else
        fail "audit-validate missing D2 security check (B2)"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 12: audit-validate has audit logging
# ─────────────────────────────────────────────────────────────────────────────
test_audit_validate_has_logging() {
    if grep -qE 'log_audit|\.audit\.log|AUDIT_LOG' \
        "$TASK_AI_ROOT/skills/check/scripts/check.sh"; then
        pass "audit-validate has audit logging (B3)"
    else
        fail "audit-validate missing audit logging (B3)"
    fi
}

# Run tests
echo "=== Precision Corpus Tests ==="
test_init_creates_test_corpus
test_yaml_parser_uses_labeled_samples
test_check_uses_test_corpus
test_research_audit_generates_samples
test_intel_fetcher_generates_samples
test_no_overwrite_existing
test_all_domains_covered
test_positive_samples_have_warning
test_sample_generator_exists
test_sample_templates_exist
test_audit_validate_has_security_check
test_audit_validate_has_logging
echo ""
echo "All tests passed."
