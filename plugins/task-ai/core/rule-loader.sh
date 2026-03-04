#!/usr/bin/env bash
# Universal rule loader for all three domains
# Domains: security | sanitization | audit
# Provides: load_rules_from_domain(), RULE_IDS[], RULE_PATTERNS[], RULE_METADATA[]
# Uses: yaml_parser.py for robust YAML parsing

set -euo pipefail

# Global arrays for loaded rules
RULE_IDS=()
RULE_PATTERNS=()
RULE_CASE_INSENSITIVE=()
RULE_METADATA=()

# Locate yaml_parser.py
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YAML_PARSER="$SCRIPT_DIR/yaml_parser.py"

# Sanitize rule pattern to prevent injection attacks
# Returns 0 if safe, 1 if dangerous
sanitize_rule_pattern() {
    local pattern="$1"
    local rule_id="${2:-unknown}"

    if [[ ! -f "$YAML_PARSER" ]]; then
        # Fallback to grep-based check if Python parser unavailable
        if echo "$pattern" | grep -qE '\$\(|`|;\s*(curl|wget|bash|sh|rm|chmod)'; then
            echo "[WARN] Skipping rule $rule_id: dangerous pattern detected" >&2
            return 1
        fi
        return 0
    fi

    local result
    result=$(python3 "$YAML_PARSER" sanitize "$pattern" "$rule_id" 2>/dev/null || echo '{"safe": false}')
    if echo "$result" | grep -q '"safe": false'; then
        echo "[WARN] Skipping rule $rule_id: dangerous pattern detected" >&2
        return 1
    fi
    return 0
}

# Load rules from a specific domain
# Usage: load_rules_from_domain "security" | "sanitization" | "audit"
# Populates: RULE_IDS[], RULE_PATTERNS[], RULE_CASE_INSENSITIVE[], RULE_METADATA[]
load_rules_from_domain() {
    local domain="$1"

    # Validate domain
    case "$domain" in
        security|sanitization|audit) ;;
        *) echo "[ERROR] Invalid domain: $domain (must be security|sanitization|audit)" >&2; return 1 ;;
    esac

    # Reset arrays
    RULE_IDS=()
    RULE_PATTERNS=()
    RULE_CASE_INSENSITIVE=()
    RULE_METADATA=()

    # Primary path: .evolving-rules/<domain>/active/
    local rules_dir="${NB_WORKSPACES_LIBRARY:-.library}/.evolving-rules/$domain/active"

    # Legacy fallback for security domain only (DEPRECATED)
    if [[ "$domain" == "security" && ! -d "$rules_dir" ]]; then
        local legacy_dir="${NB_WORKSPACES_LIBRARY:-.library}/.audit-patterns/active"
        if [[ -d "$legacy_dir" ]]; then
            rules_dir="$legacy_dir"
        fi
    fi

    [[ ! -d "$rules_dir" ]] && return 0

    # Use Python parser if available
    if [[ -f "$YAML_PARSER" ]]; then
        local json_output
        json_output=$(python3 "$YAML_PARSER" load-rules "$domain" "$rules_dir" 2>/dev/null || echo '[]')

        # Parse JSON output using bash (jq not guaranteed)
        # Format: [{"id": "...", "pattern": "...", "case_insensitive": false, ...}, ...]
        while IFS= read -r line; do
            [[ -z "$line" ]] && continue

            # Extract fields using grep/sed
            local id pattern case_insensitive dimension name

            id=$(echo "$line" | grep -oP '"id":\s*"\K[^"]+' || echo "")
            pattern=$(echo "$line" | grep -oP '"pattern":\s*"\K[^"]+' || echo "")
            case_insensitive=$(echo "$line" | grep -oP '"case_insensitive":\s*\K(true|false)' || echo "false")
            dimension=$(echo "$line" | grep -oP '"dimension":\s*"\K[^"]*' || echo "")
            name=$(echo "$line" | grep -oP '"name":\s*"\K[^"]*' || echo "")

            [[ -z "$id" ]] && continue

            RULE_IDS+=("$id")
            RULE_PATTERNS+=("$pattern")
            RULE_CASE_INSENSITIVE+=("$case_insensitive")
            RULE_METADATA+=("dimension=$dimension;name=$name")

        done < <(echo "$json_output" | tr '},{' '\n' | grep '"id"')

        return 0
    fi

    # Fallback: legacy grep/sed parsing (DEPRECATED)
    for rule_file in "$rules_dir"/*.yaml "$rules_dir"/*.yml; do
        [[ -f "$rule_file" ]] || continue

        # Parse enabled flag
        local enabled=$(grep -E '^enabled:\s*' "$rule_file" 2>/dev/null | sed 's/enabled:\s*//' | tr -d ' ')
        [[ "$enabled" == "false" ]] && continue

        # Parse id
        local id=$(grep -E '^id:\s*' "$rule_file" 2>/dev/null | sed 's/id:\s*//' | tr -d '"' | tr -d "'")
        [[ -z "$id" ]] && continue

        # Parse pattern (single line only, skip multiline YAML)
        local pattern_line=$(grep -E '^pattern:\s*".*"' "$rule_file" 2>/dev/null || \
                           grep -E "^pattern:\s*'.*'" "$rule_file" 2>/dev/null || \
                           grep -E '^pattern:\s*[^|>]' "$rule_file" 2>/dev/null | head -1)
        local pattern=$(echo "$pattern_line" | sed 's/pattern:\s*//' | tr -d '"' | tr -d "'")

        # For audit domain, pattern is optional (uses check_items instead)
        if [[ "$domain" == "audit" ]]; then
            [[ -z "$pattern" || "$pattern" == "|" || "$pattern" == ">" ]] && pattern="__audit_rule__"
        else
            [[ -z "$pattern" || "$pattern" == "|" || "$pattern" == ">" ]] && continue
            if ! sanitize_rule_pattern "$pattern" "$id"; then
                continue
            fi
        fi

        # Parse optional fields
        local case_insensitive=$(grep -E '^case_insensitive:\s*' "$rule_file" 2>/dev/null | sed 's/case_insensitive:\s*//' | tr -d ' ')
        local dimension=$(grep -E '^dimension:\s*' "$rule_file" 2>/dev/null | sed 's/dimension:\s*//' | tr -d '"')
        local name=$(grep -E '^name:\s*' "$rule_file" 2>/dev/null | sed 's/name:\s*//' | tr -d '"')

        RULE_IDS+=("$id")
        RULE_PATTERNS+=("$pattern")
        RULE_CASE_INSENSITIVE+=("${case_insensitive:-false}")
        RULE_METADATA+=("dimension=$dimension;name=$name")
    done
}

# Check content against loaded rules
# Usage: check_content_against_rules "content_to_check"
# Returns: 0 if clean, 1 if violation found
# Sets: MATCHED_RULE_ID, MATCHED_RULE_PATTERN
check_content_against_rules() {
    local content="$1"
    MATCHED_RULE_ID=""
    MATCHED_RULE_PATTERN=""

    for i in "${!RULE_IDS[@]}"; do
        local id="${RULE_IDS[$i]}"
        local pattern="${RULE_PATTERNS[$i]}"
        local case_flag="${RULE_CASE_INSENSITIVE[$i]}"

        local grep_opts="-qE"
        [[ "$case_flag" == "true" ]] && grep_opts="-qiE"

        if echo "$content" | grep $grep_opts "$pattern" 2>/dev/null; then
            MATCHED_RULE_ID="$id"
            MATCHED_RULE_PATTERN="$pattern"
            return 1
        fi
    done

    return 0
}

# Get rule count for domain
get_rule_count() {
    echo "${#RULE_IDS[@]}"
}
