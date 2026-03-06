#!/usr/bin/env bash
# Core Rules management commands
set -euo pipefail
# Usage: core-rule.sh <action> [args]
#
# Actions:
#   list                    - List all current core rules
#   propose <name> <pattern> [--cve CVE-ID] [--risk high|medium]
#                           - Propose a new core rule (generates PR template)
#   validate <pattern>      - Test a pattern against sample skills
#   status                  - Show core rules vs extended rules statistics

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SECURITY_SH="$TASK_AI_ROOT/skills/security/scripts/security.sh"

# Runtime directories (under .library/, not task-ai/)
LIB_DIR="${NB_WORKSPACES_LIBRARY:-.library}"

ACTION="${1:-}"
shift || true

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

list_core_rules() {
    if [[ ! -f "$SECURITY_SH" ]]; then
        echo "[ERROR] security.sh not found at $SECURITY_SH" >&2
        exit 1
    fi
    echo -e "${BLUE}=== Core Rules (Security Floor) ===${NC}"
    echo ""

    # Extract CORE-XXX comments from security.sh
    grep -E '^\s*# CORE-[0-9]+' "$SECURITY_SH" | while read -r line; do
        local id=$(echo "$line" | grep -oE 'CORE-[0-9]+[a-z]?')
        local desc=$(echo "$line" | sed 's/.*CORE-[0-9]*[a-z]*:[[:space:]]*//')
        printf "  ${GREEN}%-12s${NC} %s\n" "$id" "$desc"
    done

    echo ""
    echo -e "${YELLOW}Total: $(grep -cE '^\s*# CORE-[0-9]+' "$SECURITY_SH") core rules${NC}"
    echo ""
    echo "Core rules are hardcoded in: $SECURITY_SH"
    echo "To add new core rules, use: library core-rule propose <name> <pattern>"
}

propose_core_rule() {
    local name="${1:-}"
    local pattern="${2:-}"
    local cve=""
    local risk="high"

    # Parse optional args
    shift 2 || true
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --cve)
                if [[ $# -lt 2 ]]; then echo "[ERROR] --cve requires a value" >&2; exit 1; fi
                cve="$2"; shift 2 ;;
            --risk)
                if [[ $# -lt 2 ]]; then echo "[ERROR] --risk requires a value" >&2; exit 1; fi
                risk="$2"; shift 2 ;;
            *) echo "Unknown option: $1" >&2; exit 1 ;;
        esac
    done

    if [[ -z "$name" || -z "$pattern" ]]; then
        echo "Usage: library core-rule propose <name> <pattern> [--cve CVE-ID] [--risk high|medium]"
        echo ""
        echo "Examples:"
        echo "  library core-rule propose 'Kubernetes secrets' 'kubectl.*get.*secret' --risk high"
        echo "  library core-rule propose 'NPM audit bypass' 'npm.*--ignore-scripts' --cve CVE-2026-12345"
        exit 1
    fi

    # D3: Verify security.sh exists before trying to extract CORE-XXX IDs
    if [[ ! -f "$SECURITY_SH" ]]; then
        echo "[ERROR] security.sh not found at $SECURITY_SH" >&2
        exit 1
    fi

    # Get next CORE-XXX ID (find max number, ignore sub-rules like CORE-006a)
    local last_id=$(grep -oE 'CORE-[0-9]+' "$SECURITY_SH" | grep -oE '[0-9]+' | sort -n | uniq | tail -1)
    # Remove leading zeros to avoid octal interpretation
    last_id=$((10#$last_id))
    local next_id=$((last_id + 1))
    local core_id="CORE-$(printf '%03d' $next_id)"

    # Generate proposal file (runtime directory, not dev)
    local proposal_dir="$LIB_DIR/.core-rule-proposals"
    mkdir -p "$proposal_dir"
    local proposal_file="$proposal_dir/$core_id-$(echo "$name" | tr ' ' '-' | tr '[:upper:]' '[:lower:]').md"

    local source_info="Manual proposal"
    [[ -n "$cve" ]] && source_info="$cve"

    cat > "$proposal_file" <<EOF
# Core Rule Proposal: $core_id

## Summary
- **Name**: $name
- **Pattern**: \`$pattern\`
- **Risk Level**: $risk
- **Source**: $source_info
- **Proposed**: $(date +%Y-%m-%d)

## Rationale
<!-- Explain why this should be a CORE rule (cannot be disabled) rather than an Extended rule -->

## Test Cases

### Should REJECT (true positives)
\`\`\`
# Add examples of content that should be blocked
\`\`\`

### Should PASS (true negatives)
\`\`\`
# Add examples of safe content that should NOT be blocked
\`\`\`

## Code Change

Add to \`security.sh\` in the TIER 2: CORE RULES section:

\`\`\`bash
    # $core_id: $name
    if echo "\$content" | grep -qE "$pattern"; then
        risk="high"
        findings+=("$core_id:$(echo "$name" | tr ' ' '_' | tr '[:upper:]' '[:lower:]')")
    fi
\`\`\`

## Validation Results

\`\`\`
$(validate_pattern "$pattern" 2>&1 || echo "Run: library core-rule validate '$pattern'")
\`\`\`

## Checklist

- [ ] Pattern tested against sample skills
- [ ] No false positives on legitimate content
- [ ] Documented rationale for CORE (not Extended)
- [ ] Code change reviewed
- [ ] Tests added to skill-sandbox.test.sh

---

**To submit**: Create a PR with this proposal and the code change.
EOF

    echo -e "${GREEN}[OK] Proposal created: $proposal_file${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Edit the proposal file to add rationale and test cases"
    echo "  2. Run: library core-rule validate '$pattern'"
    echo "  3. Create a PR with the proposal and code change"
    echo ""
    echo -e "${YELLOW}Code to add to security.sh:${NC}"
    echo ""
    echo "    # $core_id: $name"
    echo "    if echo \"\$content\" | grep -qE \"$pattern\"; then"
    echo "        risk=\"high\""
    echo "        findings+=(\"$(echo "$name" | tr ' ' '_' | tr '[:upper:]' '[:lower:]')\")"
    echo "    fi"
}

validate_pattern() {
    local pattern="${1:-}"

    if [[ -z "$pattern" ]]; then
        echo "Usage: library core-rule validate <pattern>"
        exit 1
    fi

    echo -e "${BLUE}=== Validating pattern: $pattern ===${NC}"
    echo ""

    # Create test files
    local test_dir
    test_dir=$(mktemp -d)
    trap 'rm -rf "$test_dir"' EXIT

    # Test 1: Pattern syntax is valid
    echo -n "Pattern syntax: "
    if echo "test" | grep -qE "$pattern" 2>/dev/null || [[ $? -le 1 ]]; then
        echo -e "${GREEN}[OK] Valid${NC}"
    else
        echo -e "${RED}[FAIL] Invalid regex${NC}"
        return 1
    fi

    # Test 2: Check against safe skill
    cat > "$test_dir/safe.md" <<'EOF'
---
name: safe-skill
---
# Safe Skill
echo "hello world"
EOF

    echo -n "Safe skill (should PASS): "
    if echo "hello world" | grep -qE "$pattern"; then
        echo -e "${RED}[FAIL] FALSE POSITIVE - matches safe content${NC}"
    else
        echo -e "${GREEN}[OK] Correctly passes${NC}"
    fi

    # Test 3: Self-test (pattern should match itself in a malicious context)
    echo -n "Pattern triggers on malicious content: "
    echo "Run manual test with actual malicious examples"

    echo ""
    echo -e "${YELLOW}Manual testing recommended:${NC}"
    echo "  1. Create a skill with the dangerous pattern"
    echo "  2. Run: bash $SECURITY_SH _ scan-skill <skill.md>"
    echo "  3. Verify it gets REJECTED"
}

show_status() {
    echo -e "${BLUE}=== Core Rules vs Extended Rules ===${NC}"
    echo ""

    # Count core rules
    # D3: Guard against missing security.sh
    local core_count=0
    if [[ -f "$SECURITY_SH" ]]; then
        core_count=$(grep -cE '^\s*# CORE-[0-9]+' "$SECURITY_SH" 2>/dev/null || echo 0)
    fi

    # Count extended rules
    local lib_dir="${NB_WORKSPACES_LIBRARY:-.library}"
    local extended_count=0
    if [[ -d "$lib_dir/.evolving-rules/security/active" ]]; then
        extended_count=$(find "$lib_dir/.evolving-rules/security/active" -name "*.yaml" -o -name "*.yml" 2>/dev/null | wc -l)
        # D3: Trim whitespace from wc -l output (macOS wc pads with spaces)
        extended_count="${extended_count// /}"
    fi

    # Count pending proposals (runtime directory)
    local proposal_dir="$LIB_DIR/.core-rule-proposals"
    local proposal_count=0
    if [[ -d "$proposal_dir" ]]; then
        proposal_count=$(find "$proposal_dir" -name "*.md" 2>/dev/null | wc -l)
        proposal_count="${proposal_count// /}"
    fi

    echo "  Core Rules (hardcoded):     $core_count"
    echo "  Extended Rules (dynamic):   $extended_count"
    echo "  Pending Proposals:          $proposal_count"
    echo ""

    if [[ $proposal_count -gt 0 ]]; then
        echo -e "${YELLOW}Pending proposals:${NC}"
        find "$proposal_dir" -name "*.md" -exec basename {} \; 2>/dev/null | sed 's/^/  - /'
    fi
}

case "$ACTION" in
    list)
        list_core_rules
        ;;
    propose)
        propose_core_rule "$@"
        ;;
    validate)
        validate_pattern "$@"
        ;;
    status)
        show_status
        ;;
    *)
        echo "Core Rules Management"
        echo ""
        echo "Usage: library core-rule <action> [args]"
        echo ""
        echo "Actions:"
        echo "  list                    List all current core rules"
        echo "  propose <name> <pattern> [--cve CVE-ID] [--risk high|medium]"
        echo "                          Propose a new core rule"
        echo "  validate <pattern>      Test a pattern against samples"
        echo "  status                  Show core vs extended rules stats"
        echo ""
        echo "Examples:"
        echo "  library core-rule list"
        echo "  library core-rule propose 'K8s secrets' 'kubectl.*get.*secret' --cve CVE-2026-99999"
        echo "  library core-rule validate 'curl.*\\|.*bash'"
        exit 1
        ;;
esac
