#!/usr/bin/env bash
# Intelligence Fetcher for Rule Evolution
# Usage: intel-fetcher.sh --sources <config.yaml> --output <evolving-rules-dir> [--test-corpus <dir>]
#
# Fetches intelligence from configured sources and generates:
# 1. Candidate rules → --output/{domain}/candidates/
# 2. Positive test samples → --test-corpus/{domain}/positive/
# 3. Negative test samples → --test-corpus/{domain}/negative/
#
# Sources: NIST NVD, GitHub Advisories, OWASP, arXiv, etc.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# D5: Delegate sample generation to dedicated script
SAMPLE_GENERATOR="$SCRIPT_DIR/sample-generator.sh"

# Defaults
SOURCES_FILE=""
OUTPUT_DIR=""
TEST_CORPUS_DIR=""
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --sources)     [[ $# -ge 2 ]] || { echo "[ERROR] --sources requires a value" >&2; exit 1; }; SOURCES_FILE="$2"; shift 2 ;;
        --output)      [[ $# -ge 2 ]] || { echo "[ERROR] --output requires a value" >&2; exit 1; }; OUTPUT_DIR="$2"; shift 2 ;;
        --test-corpus) [[ $# -ge 2 ]] || { echo "[ERROR] --test-corpus requires a value" >&2; exit 1; }; TEST_CORPUS_DIR="$2"; shift 2 ;;
        --dry-run)     DRY_RUN=true; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$SOURCES_FILE" ]]; then
    echo "[ERROR] --sources <config.yaml> required" >&2
    exit 1
fi
if [[ ! -f "$SOURCES_FILE" ]]; then
    echo "[ERROR] Sources file not found: $SOURCES_FILE" >&2
    exit 1
fi

if [[ -z "$OUTPUT_DIR" ]]; then
    echo "[ERROR] --output <dir> required" >&2
    exit 1
fi

echo "[intel-fetcher] Starting intelligence fetch..."
echo "[intel-fetcher] Sources: $SOURCES_FILE"
echo "[intel-fetcher] Output: $OUTPUT_DIR"

# Generate unique rule ID
generate_rule_id() {
    local prefix="${1:-AUTO}"
    local domain="$2"
    # D2: Sanitize prefix and domain to prevent injection via rule ID
    prefix=$(echo "$prefix" | tr -cd 'A-Za-z0-9_-')
    domain=$(echo "$domain" | tr -cd 'A-Za-z0-9_-')
    local timestamp
    timestamp=$(date +%Y%m%d%H%M%S)
    echo "${prefix}-${domain^^}-${timestamp}-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \t\n')"
}

# Create candidate rule YAML
create_candidate_rule() {
    local id="$1"
    local name="$2"
    local pattern="$3"
    local domain="$4"
    local source_name="$5"
    local output_file="$6"

    # D2: Sanitize YAML string values — escape backslashes, double-quotes, $, newlines
    local safe_name="${name//\\/\\\\}"
    safe_name="${safe_name//\"/\\\"}"
    safe_name="${safe_name//\$/\\\$}"
    safe_name="${safe_name//$'\n'/ }"
    local safe_pattern="${pattern//\\/\\\\}"
    safe_pattern="${safe_pattern//\"/\\\"}"
    safe_pattern="${safe_pattern//\$/\\\$}"
    safe_pattern="${safe_pattern//$'\n'/ }"
    local safe_source="${source_name//\\/\\\\}"
    safe_source="${safe_source//\"/\\\"}"
    safe_source="${safe_source//\$/\\\$}"
    safe_source="${safe_source//$'\n'/ }"

    # D2: Sanitize domain for YAML output (strip non-alphanumeric except dash/underscore)
    local safe_domain
    safe_domain=$(echo "$domain" | tr -cd 'a-zA-Z0-9_-')

    cat > "$output_file" <<EOF
# Auto-generated candidate rule
# Source: $safe_source
# Generated: $(date -Iseconds)

id: "$id"
name: "$safe_name"
pattern: "$safe_pattern"
domain: "$safe_domain"
source: "$safe_source"
enabled: true
case_insensitive: false
confidence: 0.70
needs_review: true
EOF

    echo "[intel-fetcher] Created candidate: $output_file"
}

# I2: Bootstrap-only fallback when sample-generator.sh unavailable
# These functions are kept for backwards compatibility and initial bootstrap
# Primary sample generation is delegated to sample-generator.sh (D5 Architecture)

# Create positive test sample (should match the rule)
# NOTE: Prefer sample-generator.sh for production use
create_positive_sample() {
    local pattern="$1"
    local domain="$2"
    local sample_id="$3"
    local description="$4"

    if [[ -z "$TEST_CORPUS_DIR" ]]; then
        return 0
    fi

    # D1: Escape $ in pattern/description to prevent shell expansion in heredoc
    local safe_pat="${pattern//\$/\\\$}"
    local safe_desc="${description//\$/\\\$}"

    local sample_dir="$TEST_CORPUS_DIR/$domain/positive"
    mkdir -p "$sample_dir"
    local sample_file="$sample_dir/${sample_id}.md"

    # D3: Check if file already exists - skip to avoid overwrite
    if [[ -f "$sample_file" ]]; then
        echo "[intel-fetcher] Skip: $sample_file already exists"
        return 0
    fi

    cat > "$sample_file" <<EOF
# CAUTION: TEST SAMPLE ONLY - DO NOT EXECUTE
# ============================================
# This file contains DANGEROUS patterns for testing security rules.
# It is NOT meant to be executed or used as reference code.
# ============================================

# Positive Sample: $sample_id
# Domain: $domain
# Description: $safe_desc
# Expected: Should MATCH the security rule pattern
# Generated: $(date -Iseconds)

## Dangerous Pattern

\`\`\`
$safe_pat
\`\`\`

## Why This Is Dangerous

This pattern represents a known vulnerability or attack vector.
Security rules should detect and block this pattern.
EOF

    echo "[intel-fetcher] Created positive sample: $sample_file"
}

# Create negative test sample (should NOT match the rule)
create_negative_sample() {
    local pattern="$1"
    local domain="$2"
    local sample_id="$3"
    local description="$4"

    if [[ -z "$TEST_CORPUS_DIR" ]]; then
        return 0
    fi

    # D1: Escape $ in pattern/description to prevent shell expansion in heredoc
    local safe_pat="${pattern//\$/\\\$}"
    local safe_desc="${description//\$/\\\$}"

    local sample_dir="$TEST_CORPUS_DIR/$domain/negative"
    mkdir -p "$sample_dir"
    local sample_file="$sample_dir/${sample_id}.md"

    # D3: Check if file already exists - skip to avoid overwrite
    if [[ -f "$sample_file" ]]; then
        echo "[intel-fetcher] Skip: $sample_file already exists"
        return 0
    fi

    cat > "$sample_file" <<EOF
# Negative Sample: $sample_id
# Domain: $domain
# Description: $safe_desc
# Expected: Should NOT match (safe pattern, no false positive)
# Generated: $(date -Iseconds)

## Safe Pattern

\`\`\`
$safe_pat
\`\`\`

## Why This Is Safe

This pattern represents normal, safe code that should pass security checks.
Security rules should NOT flag this as a violation.
EOF

    echo "[intel-fetcher] Created negative sample: $sample_file"
}

# I1: Validate API response for safety (D2 Security)
# Returns 0 if response is valid JSON and safe, 1 otherwise
MAX_API_RESPONSE_SIZE=1048576  # 1MB max response size (D2)
validate_api_response() {
    local response="$1"
    local source_name="$2"
    local max_size=$MAX_API_RESPONSE_SIZE

    # Check 1: Response size limit
    local response_size=${#response}
    if [[ "$response_size" -gt "$max_size" ]]; then
        echo "[intel-fetcher] WARN: $source_name response exceeds size limit ($response_size > $max_size)"
        return 1
    fi

    # Check 2: Basic JSON structure validation (must start with { or [)
    if ! printf '%s' "$response" | grep -qE '^\s*[\{\[]'; then
        echo "[intel-fetcher] WARN: $source_name response is not valid JSON"
        return 1
    fi

    # Check 3: No dangerous patterns in response (injection prevention)
    if printf '%s' "$response" | grep -qE '\$\(|`[^`]+`|<script|javascript:|data:text/html'; then
        echo "[intel-fetcher] WARN: $source_name response contains dangerous patterns"
        return 1
    fi

    return 0
}

# Fetch from NIST NVD API
# NOTE: Called when YAML sources config specifies "nist_nvd" type (future: YAML dispatch)
fetch_nist_nvd() {
    local url="$1"
    local params="$2"  # Reserved for future query parameter overrides
    local domain="${3:-security}"

    echo "[intel-fetcher] Fetching from NIST NVD..."

    # Build query URL with date parameter
    local seven_days_ago
    # D3: Use python3 as a portable fallback for date arithmetic when neither GNU nor BSD date works
    seven_days_ago=$(date -d '7 days ago' +%Y-%m-%dT00:00:00.000 2>/dev/null \
        || date -v-7d +%Y-%m-%dT00:00:00.000 2>/dev/null \
        || python3 -c "from datetime import datetime,timedelta;print((datetime.now()-timedelta(days=7)).strftime('%Y-%m-%dT00:00:00.000'))" 2>/dev/null \
        || echo "1970-01-01T00:00:00.000")

    local query_url="${url}?pubStartDate=${seven_days_ago}"

    if $DRY_RUN; then
        echo "[intel-fetcher] DRY-RUN: Would fetch $query_url"
        return 0
    fi

    # Fetch with curl (rate limit: 5 requests per 30 seconds for unauthenticated)
    local response
    response=$(curl -s --max-time 30 "$query_url" 2>/dev/null || echo '{"error": "fetch failed"}')

    # I1: Validate response before processing
    if ! validate_api_response "$response" "NVD"; then
        echo "[intel-fetcher] NVD: Skipping invalid response"
        return 1
    fi

    # Check for vulnerabilities
    if echo "$response" | grep -q '"vulnerabilities"'; then
        echo "[intel-fetcher] NVD: Found vulnerabilities in response"
        # In production: parse JSON and create candidate rules
        # For now: log success
    else
        echo "[intel-fetcher] NVD: No new vulnerabilities or fetch failed"
    fi
}

# Fetch from GitHub Advisories API
# NOTE: Called when YAML sources config specifies "github_advisories" type (future: YAML dispatch)
fetch_github_advisories() {
    local url="$1"
    local params="$2"  # Reserved for future query parameter overrides
    local domain="${3:-security}"

    echo "[intel-fetcher] Fetching from GitHub Advisories..."

    if $DRY_RUN; then
        echo "[intel-fetcher] DRY-RUN: Would fetch $url"
        return 0
    fi

    # gh CLI is preferred for authentication
    if command -v gh &>/dev/null; then
        local advisories
        advisories=$(gh api /advisories --jq '.[].ghsa_id' 2>/dev/null | head -5 || echo "")
        if [[ -n "$advisories" ]]; then
            echo "[intel-fetcher] GitHub: Found $(echo "$advisories" | wc -l) recent advisories"
        fi
    else
        echo "[intel-fetcher] GitHub: gh CLI not available, skipping"
    fi
}

# Main fetch loop - parse sources and dispatch
FETCH_COUNT=0

# Bootstrap: creates initial sample candidate and test corpus when no candidates exist.
# Full YAML source dispatch (jq/Python parsing) is a future enhancement.
echo "[intel-fetcher] Processing sources..."

# Example: create a sample candidate rule if any source is enabled
SAMPLE_CANDIDATES_DIR="$OUTPUT_DIR/security/candidates"
mkdir -p "$SAMPLE_CANDIDATES_DIR"

# Check if this is a fresh run (no candidates yet)
# D4: Limit find depth to avoid scanning deep directory trees
EXISTING_COUNT=$(find "$OUTPUT_DIR" -maxdepth 3 -name "*.yaml" -path "*/candidates/*" 2>/dev/null | wc -l || echo 0)

if [[ "$EXISTING_COUNT" -eq 0 && "$DRY_RUN" == "false" ]]; then
    # Create sample candidate for testing the pipeline
    SAMPLE_ID=$(generate_rule_id "AUTO" "security")
    SAMPLE_FILE="$SAMPLE_CANDIDATES_DIR/${SAMPLE_ID}.yaml"
    SAMPLE_PATTERN="eval\\s*\\(\\s*\\$"

    create_candidate_rule \
        "$SAMPLE_ID" \
        "Detect eval with variable input" \
        "$SAMPLE_PATTERN" \
        "security" \
        "intel-fetcher-bootstrap" \
        "$SAMPLE_FILE"

    # Also create corresponding test samples
    create_positive_sample \
        'eval($user_input)' \
        "security" \
        "${SAMPLE_ID}-pos-1" \
        "Eval with user input - code injection vulnerability"

    create_positive_sample \
        'eval( $request->get("code") )' \
        "security" \
        "${SAMPLE_ID}-pos-2" \
        "Eval with request parameter - code injection"

    create_negative_sample \
        'evaluate_expression(sanitized_input)' \
        "security" \
        "${SAMPLE_ID}-neg-1" \
        "Safe function call with sanitized input"

    create_negative_sample \
        'print("Hello, World!")' \
        "security" \
        "${SAMPLE_ID}-neg-2" \
        "Simple print statement - safe code"

    ((FETCH_COUNT++)) || true

    # D5: Delegate sample generation to sample-generator.sh for all domains
    if [[ -n "$TEST_CORPUS_DIR" && -f "$SAMPLE_GENERATOR" ]]; then
        echo "[intel-fetcher] Delegating sample generation to sample-generator.sh..."
        for domain in security sanitization audit; do
            mkdir -p "$OUTPUT_DIR/$domain/candidates"
            bash "$SAMPLE_GENERATOR" --domain "$domain" --output "$TEST_CORPUS_DIR"
        done
    fi
fi

SAMPLE_COUNT=0
if [[ -n "$TEST_CORPUS_DIR" ]]; then
    # D4: Limit find depth for consistency with other find invocations
    SAMPLE_COUNT=$(find "$TEST_CORPUS_DIR" -maxdepth 3 -name "*.md" -type f 2>/dev/null | wc -l || echo 0)
fi

echo "[intel-fetcher] Fetch complete. New candidates: $FETCH_COUNT, Test samples: $SAMPLE_COUNT"
