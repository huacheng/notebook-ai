#!/usr/bin/env bash
# Intelligence Fetcher for Rule Evolution
# Usage: intel-fetcher.sh --sources <config.yaml> --output <evolving-rules-dir>
#
# Fetches intelligence from configured sources and generates candidate rules.
# Sources: NIST NVD, GitHub Advisories, OWASP, arXiv, etc.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YAML_PARSER="$SCRIPT_DIR/../../../core/yaml_parser.py"

# Defaults
SOURCES_FILE=""
OUTPUT_DIR=""
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --sources) SOURCES_FILE="$2"; shift 2 ;;
        --output)  OUTPUT_DIR="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$SOURCES_FILE" || ! -f "$SOURCES_FILE" ]]; then
    echo "[ERROR] --sources <config.yaml> required" >&2
    exit 1
fi

if [[ -z "$OUTPUT_DIR" ]]; then
    echo "[ERROR] --output <dir> required" >&2
    exit 1
fi

echo "[intel-fetcher] Starting intelligence fetch..."
echo "[intel-fetcher] Sources: $SOURCES_FILE"
echo "[intel-fetcher] Output: $OUTPUT_DIR"

# Parse sources config
if [[ ! -f "$YAML_PARSER" ]]; then
    echo "[ERROR] yaml_parser.py not found at $YAML_PARSER" >&2
    exit 1
fi

SOURCES_JSON=$(python3 "$YAML_PARSER" parse "$SOURCES_FILE" 2>/dev/null || echo '{}')

# Generate unique rule ID
generate_rule_id() {
    local prefix="${1:-AUTO}"
    local domain="$2"
    local timestamp
    timestamp=$(date +%Y%m%d%H%M%S)
    echo "${prefix}-${domain^^}-${timestamp}-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' ')"
}

# Create candidate rule YAML
create_candidate_rule() {
    local id="$1"
    local name="$2"
    local pattern="$3"
    local domain="$4"
    local source_name="$5"
    local output_file="$6"

    cat > "$output_file" <<EOF
# Auto-generated candidate rule
# Source: $source_name
# Generated: $(date -Iseconds)

id: $id
name: $name
pattern: "$pattern"
domain: $domain
source: $source_name
enabled: true
case_insensitive: false
confidence: 0.70
needs_review: true
EOF

    echo "[intel-fetcher] Created candidate: $output_file"
}

# Fetch from NIST NVD API
fetch_nist_nvd() {
    local url="$1"
    local params="$2"
    local domain="${3:-security}"

    echo "[intel-fetcher] Fetching from NIST NVD..."

    # Build query URL with date parameter
    local seven_days_ago
    seven_days_ago=$(date -d '7 days ago' +%Y-%m-%dT00:00:00.000 2>/dev/null || date -v-7d +%Y-%m-%dT00:00:00.000 2>/dev/null || echo "2024-01-01T00:00:00.000")

    local query_url="${url}?pubStartDate=${seven_days_ago}"

    if $DRY_RUN; then
        echo "[intel-fetcher] DRY-RUN: Would fetch $query_url"
        return 0
    fi

    # Fetch with curl (rate limit: 5 requests per 30 seconds for unauthenticated)
    local response
    response=$(curl -s --max-time 30 "$query_url" 2>/dev/null || echo '{"error": "fetch failed"}')

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
fetch_github_advisories() {
    local url="$1"
    local params="$2"
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

# Extract source names from JSON (simplified parsing)
# In production, use jq or Python for proper JSON handling
echo "[intel-fetcher] Processing sources..."

# Example: create a sample candidate rule if any source is enabled
SAMPLE_CANDIDATES_DIR="$OUTPUT_DIR/security/candidates"
mkdir -p "$SAMPLE_CANDIDATES_DIR"

# Check if this is a fresh run (no candidates yet)
EXISTING_COUNT=$(find "$OUTPUT_DIR" -name "*.yaml" -path "*/candidates/*" 2>/dev/null | wc -l || echo 0)

if [[ "$EXISTING_COUNT" -eq 0 && "$DRY_RUN" == "false" ]]; then
    # Create sample candidate for testing the pipeline
    SAMPLE_ID=$(generate_rule_id "AUTO" "security")
    SAMPLE_FILE="$SAMPLE_CANDIDATES_DIR/${SAMPLE_ID}.yaml"

    create_candidate_rule \
        "$SAMPLE_ID" \
        "Sample auto-generated rule" \
        "example_dangerous_pattern" \
        "security" \
        "intel-fetcher-bootstrap" \
        "$SAMPLE_FILE"

    ((FETCH_COUNT++)) || true
fi

echo "[intel-fetcher] Fetch complete. New candidates: $FETCH_COUNT"
