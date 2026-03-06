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

# L3: Caching mechanism to avoid redundant reloads (D4 Performance)
declare -A _RULES_CACHE_LOADED=()  # domain -> "1" if loaded
declare -A _RULES_CACHE_MTIME=()   # domain -> mtime of rules dir

# L4: Configurable paths (D6 Maintainability)
# Override with environment variables if needed
EVOLVING_RULES_PATH="${EVOLVING_RULES_PATH:-${NB_WORKSPACES_LIBRARY:-.library}/.evolving-rules}"

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

# L3: Check if rules need reload (cache invalidation)
# Returns 0 if reload needed, 1 if cache is valid
_rules_need_reload() {
    local domain="$1"
    local rules_dir="$2"

    # Not loaded yet -> need reload
    [[ -z "${_RULES_CACHE_LOADED[$domain]:-}" ]] && return 0

    # Directory doesn't exist -> skip reload
    [[ ! -d "$rules_dir" ]] && return 1

    # D4: Check mtime of directory AND newest file for cache invalidation
    # Directory mtime changes on add/delete, but file mtime changes on content edit
    local current_mtime
    current_mtime=$(stat -c %Y "$rules_dir" 2>/dev/null || stat -f %m "$rules_dir" 2>/dev/null || echo 0)
    local newest_file_mtime
    newest_file_mtime=$(find "$rules_dir" -maxdepth 1 \( -name "*.yaml" -o -name "*.yml" \) -exec stat -c %Y {} + 2>/dev/null | sort -rn | head -1 || echo 0)
    [[ -z "$newest_file_mtime" ]] && newest_file_mtime=0
    local composite_mtime="${current_mtime}:${newest_file_mtime}"
    local cached_mtime="${_RULES_CACHE_MTIME[$domain]:-0:0}"

    [[ "$composite_mtime" != "$cached_mtime" ]] && return 0

    return 1  # Cache is valid
}

# Load rules from a specific domain
# Usage: load_rules_from_domain "security" | "sanitization" | "audit"
# Populates: RULE_IDS[], RULE_PATTERNS[], RULE_CASE_INSENSITIVE[], RULE_METADATA[]
load_rules_from_domain() {
    local domain="$1"
    local force_reload="${2:-false}"  # Optional: force reload ignoring cache

    # Validate domain
    case "$domain" in
        security|sanitization|audit) ;;
        *) echo "[ERROR] Invalid domain: $domain (must be security|sanitization|audit)" >&2; return 1 ;;
    esac

    # L4: Use configurable path
    local rules_dir="$EVOLVING_RULES_PATH/$domain/active"

    # L3: Check cache before reload
    if [[ "$force_reload" != "true" ]] && ! _rules_need_reload "$domain" "$rules_dir"; then
        # Cache hit - skip reload
        return 0
    fi

    # Reset arrays (cache miss or force reload)
    RULE_IDS=()
    RULE_PATTERNS=()
    RULE_CASE_INSENSITIVE=()
    RULE_METADATA=()

    # Primary path: .evolving-rules/<domain>/active/
    # (rules_dir already set above using EVOLVING_RULES_PATH)

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
        # D6: Use grep -oP (PCRE) to extract complete JSON objects.
        # Note: -oP requires GNU grep; macOS users need `brew install grep`.
        while IFS= read -r obj; do
            [[ -z "$obj" ]] && continue

            # Extract fields from complete JSON object
            local id pattern case_insensitive dimension name

            id=$(echo "$obj" | grep -oP '"id":\s*"\K[^"]+' || echo "")
            pattern=$(echo "$obj" | grep -oP '"pattern":\s*"\K[^"]+' || echo "")
            case_insensitive=$(echo "$obj" | grep -oP '"case_insensitive":\s*\K(true|false)' || echo "false")
            dimension=$(echo "$obj" | grep -oP '"dimension":\s*"\K[^"]*' || echo "")
            name=$(echo "$obj" | grep -oP '"name":\s*"\K[^"]*' || echo "")

            [[ -z "$id" ]] && continue
            # D1: Skip empty patterns (prevent grep matching everything)
            [[ -z "$pattern" ]] && continue

            RULE_IDS+=("$id")
            RULE_PATTERNS+=("$pattern")
            RULE_CASE_INSENSITIVE+=("$case_insensitive")
            RULE_METADATA+=("dimension=$dimension;name=$name")

        done < <(echo "$json_output" | grep -oP '\{[^}]+\}')

        # L3: Update cache
        _RULES_CACHE_LOADED[$domain]="1"
        local _dir_mt _file_mt
        _dir_mt=$(stat -c %Y "$rules_dir" 2>/dev/null || stat -f %m "$rules_dir" 2>/dev/null || echo 0)
        _file_mt=$(find "$rules_dir" -maxdepth 1 \( -name "*.yaml" -o -name "*.yml" \) -exec stat -c %Y {} + 2>/dev/null | sort -rn | head -1 || echo 0)
        [[ -z "$_file_mt" ]] && _file_mt=0
        _RULES_CACHE_MTIME[$domain]="${_dir_mt}:${_file_mt}"
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
        local pattern_line
        pattern_line=$(grep -E '^pattern:\s*".*"' "$rule_file" 2>/dev/null || \
                       grep -E "^pattern:\s*'.*'" "$rule_file" 2>/dev/null || \
                       grep -E '^pattern:\s*[^|>]' "$rule_file" 2>/dev/null || true)
        pattern_line=$(echo "$pattern_line" | head -1)
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

    # L3: Update cache after legacy loading
    _RULES_CACHE_LOADED[$domain]="1"
    local _dir_mt _file_mt
    _dir_mt=$(stat -c %Y "$rules_dir" 2>/dev/null || stat -f %m "$rules_dir" 2>/dev/null || echo 0)
    _file_mt=$(find "$rules_dir" -maxdepth 1 \( -name "*.yaml" -o -name "*.yml" \) -exec stat -c %Y {} + 2>/dev/null | sort -rn | head -1 || echo 0)
    [[ -z "$_file_mt" ]] && _file_mt=0
    _RULES_CACHE_MTIME[$domain]="${_dir_mt}:${_file_mt}"
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

        # L1: Use array for grep options to ensure safe expansion
        local -a grep_opts=("-q" "-E")
        [[ "$case_flag" == "true" ]] && grep_opts+=("-i")

        if echo "$content" | grep "${grep_opts[@]}" "$pattern" 2>/dev/null; then
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
