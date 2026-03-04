#!/usr/bin/env bash
# /task-ai:security implementation
# Usage: security.sh <notebook> <action> [payload]
#
# Actions:
#   verify-cmd <cmd>     - Verify a shell command is safe to execute
#   audit-plan           - Audit the .plan.md for dangerous operations
#   scan-skill <file>    - L1 static analysis for skill files (notebook param ignored)

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

NOTEBOOK="${1:-}"
ACTION="${2:-}"
PAYLOAD="${3:-}"

if [[ -z "$ACTION" ]]; then
    echo "[ERROR] Action is required." >&2
    exit 1
fi

# scan-skill doesn't require a working directory
if [[ "$ACTION" != "scan-skill" ]]; then
    resolve_workdir "$NOTEBOOK"
    NOTEBOOK="$NB_NOTEBOOK"

    if [[ ! -d "$WORK_DIR" ]]; then
        echo "[ERROR] Working directory not found." >&2
        exit 1
    fi
fi

NB_ROOT="${NB_WORKSPACES_ROOT:-$(pwd)}"

verify_cmd() {
    local cmd="$1"
    local risk="low"
    local reason=""

    # 1. Fatal Pattern Blocking (Destructive commands)
    if echo "$cmd" | grep -qE "rm\s+-rf\s+(/|/etc|~|/var)"; then
        risk="high"
        reason="Destructive path deletion"
    fi

    # 2. VFP Injection (Command Semantics)
    if echo "$cmd" | grep -qE -e "--eval|--conftest|--require|--include|--import"; then
        risk="high"
        reason="VFP semantics injection"
    fi

    # 3. Two-stage loading (download & execute patterns)
    if echo "$cmd" | grep -qE "(curl|wget|fetch).*\|.*(/bin/)?(bash|sh|zsh|python|perl|ruby|node)"; then
        risk="high"
        reason="Two-stage payload execution"
    fi
    # 3b. Download-then-execute pattern (curl -o file && run)
    if echo "$cmd" | grep -qE "(curl|wget).*(-o|-O).*&&.*(chmod|bash|sh|\./)"; then
        risk="high"
        reason="Download and execute pattern"
    fi

    # 4. Environment manipulation (high risk if overriding critical libs)
    if echo "$cmd" | grep -qE "(LD_PRELOAD|PYTHONPATH|NODE_OPTIONS|JAVA_TOOL_OPTIONS|RUBYOPT|PERL5LIB|DYLD_INSERT_LIBRARIES)="; then
        risk="high"
        reason="Environment manipulation"
    fi

    # 5. Path Traversal & Absolute Paths
    if echo "$cmd" | grep -qE "\.\./|~| /"; then
        if ! echo "$cmd" | grep -qF "$NB_ROOT"; then
            risk="high"
            reason="Path traversal or absolute path outside workspace"
        fi
    fi

    if [[ "$risk" == "high" ]]; then
        echo "[SECURITY] REJECT: $reason"
        return 1
    else
        echo "[SECURITY] PASS: Command looks safe"
        return 0
    fi
}

audit_plan() {
    local plan_md="$WORK_DIR/.plan.md"
    if [[ ! -f "$plan_md" ]]; then
        echo "[SECURITY] PASS: No plan.md to audit"
        return 0
    fi

    local content=$(cat "$plan_md")

    # Semantic deviation audit (simulated)
    if echo "$content" | grep -qE "rm -rf|curl\s*\|\s*bash|wget"; then
        echo "[SECURITY] BLOCKED: High risk operations detected in plan"
        return 1
    fi
    echo "[SECURITY] PASS: Plan looks safe"
    return 0
}

# Sanitize rule pattern - reject patterns containing shell injection attempts
# Returns 0 if safe, 1 if dangerous
sanitize_rule_pattern() {
    local pattern="$1"
    local rule_id="$2"

    # Reject patterns containing shell injection constructs
    # $(...) command substitution
    if [[ "$pattern" == *'$('* ]]; then
        echo "[SECURITY] WARN: Skipping rule $rule_id - pattern contains \$() injection" >&2
        return 1
    fi
    # `...` backtick substitution
    if [[ "$pattern" == *'`'* ]]; then
        echo "[SECURITY] WARN: Skipping rule $rule_id - pattern contains backtick injection" >&2
        return 1
    fi
    # ; && || command chaining (not in regex context)
    if echo "$pattern" | grep -qE ';\s*\$|;\s*[a-z]|&&\s*[a-z]|\|\|\s*[a-z]'; then
        echo "[SECURITY] WARN: Skipping rule $rule_id - pattern contains command chaining" >&2
        return 1
    fi
    return 0
}

# Load dynamic rules from .evolving-rules/security/active/*.yaml
# Directory structure: $NB_WORKSPACES_LIBRARY/.evolving-rules/security/{candidates,active,review,deprecated}/
# Falls back to legacy .audit-patterns/active/ for compatibility (DEPRECATED: will be removed in v2.0)
# Stores rules in parallel arrays to avoid delimiter conflicts with regex patterns
load_dynamic_rules() {
    RULE_IDS=()
    RULE_PATTERNS=()
    RULE_CASE_INSENSITIVE=()

    # Primary: new unified directory structure
    local rules_dir="${NB_WORKSPACES_LIBRARY:-.library}/.evolving-rules/security/active"
    # Fallback: legacy directory for compatibility
    local legacy_dir="${NB_WORKSPACES_LIBRARY:-.library}/.audit-patterns/active"

    # Use primary if exists, otherwise fallback
    if [[ ! -d "$rules_dir" ]]; then
        if [[ -d "$legacy_dir" ]]; then
            rules_dir="$legacy_dir"
        else
            return 0
        fi
    fi

    for rule_file in "$rules_dir"/*.yaml "$rules_dir"/*.yml; do
        [[ -f "$rule_file" ]] || continue

        # Parse YAML (simple grep-based, no external deps)
        local enabled=$(grep -E '^enabled:\s*' "$rule_file" | sed 's/enabled:\s*//' | tr -d ' ')
        [[ "$enabled" == "false" ]] && continue

        local id=$(grep -E '^id:\s*' "$rule_file" | sed 's/id:\s*//' | tr -d '"' | tr -d "'")
        # Handle pattern on single line only (skip multiline YAML)
        local pattern_line=$(grep -E '^pattern:\s*".*"' "$rule_file" || grep -E "^pattern:\s*'.*'" "$rule_file" || grep -E '^pattern:\s*[^|>]' "$rule_file" | head -1)
        local pattern=$(echo "$pattern_line" | sed 's/pattern:\s*//' | tr -d '"' | tr -d "'")
        local case_insensitive=$(grep -E '^case_insensitive:\s*' "$rule_file" | sed 's/case_insensitive:\s*//' | tr -d ' ')

        # Skip if pattern is empty or multiline indicator
        if [[ -z "$pattern" || "$pattern" == "|" || "$pattern" == ">" ]]; then
            continue
        fi

        # D2 Security: Sanitize rule pattern before loading
        if ! sanitize_rule_pattern "$pattern" "$id"; then
            continue
        fi

        if [[ -n "$id" && -n "$pattern" ]]; then
            RULE_IDS+=("$id")
            RULE_PATTERNS+=("$pattern")
            RULE_CASE_INSENSITIVE+=("${case_insensitive:-false}")
        fi
    done
}

# =============================================================================
# L1 Static Analysis for Skills
# Two-tier architecture:
#   - CORE RULES (hardcoded): Security floor, cannot be disabled
#   - EXTENDED RULES (dynamic): Evolvable, loaded from .evolving-rules/
# =============================================================================

scan_skill() {
    local skill_md="$1"
    local risk="low"
    local findings=()

    if [[ ! -f "$skill_md" ]]; then
        echo "[SECURITY] ERROR: Skill file not found: $skill_md"
        return 1
    fi

    # Check for empty file
    if [[ ! -s "$skill_md" ]]; then
        echo "[SECURITY] WARNING: Skill file is empty: $skill_md"
        echo "[SECURITY] PASS: Empty file has no dangerous patterns"
        return 0
    fi

    local content=$(cat "$skill_md")

    # =========================================================================
    # TIER 1: EXTENDED RULES (Evolvable)
    # Loaded from .evolving-rules/security/active/*.yaml
    # Can be added/modified/disabled without code changes
    # =========================================================================
    load_dynamic_rules
    local i
    for i in "${!RULE_IDS[@]}"; do
        local rule_id="${RULE_IDS[$i]}"
        local rule_pattern="${RULE_PATTERNS[$i]}"
        local rule_case_insensitive="${RULE_CASE_INSENSITIVE[$i]}"

        local grep_flags="-qE"
        [[ "$rule_case_insensitive" == "true" ]] && grep_flags="-qiE"

        if echo "$content" | grep $grep_flags "$rule_pattern"; then
            risk="high"
            findings+=("dynamic:$rule_id")
        fi
    done

    # =========================================================================
    # TIER 2: CORE RULES (Security Floor - Hardcoded)
    # These rules are the security baseline and CANNOT be disabled.
    # They protect against known-dangerous patterns that should never appear.
    # To add new core rules, modify this code and release a new version.
    # =========================================================================

    # 1. Extract executable blocks (bash, sh, python, javascript)
    local code_blocks=$(echo "$content" | grep -E '```(bash|sh|python|javascript|js)|^!\`|^\s*\`[^`]+\`$' || true)

    # CORE-001: Destructive commands
    if echo "$content" | grep -qE "(^|\s)rm\s+(-[a-zA-Z]*[rf]|--recursive|--force)"; then
        risk="high"
        findings+=("destructive_command:rm_rf")
    fi

    # CORE-002: VFP Injection (malicious CLI flags)
    if echo "$content" | grep -qE -- "--eval|--conftest|--require|--include|--import"; then
        risk="high"
        findings+=("vfp_injection")
    fi

    # CORE-003: Two-stage loading (download & execute)
    if echo "$content" | grep -qE "(curl|wget|fetch).*\|.*(bash|sh|zsh|python|perl|ruby|node)"; then
        risk="high"
        findings+=("two_stage_loading:pipe")
    fi
    if echo "$content" | grep -qE "(curl|wget).*(-o|-O).*&&.*(chmod|bash|sh|\./)"; then
        risk="high"
        findings+=("two_stage_loading:download_exec")
    fi

    # CORE-004: Environment manipulation (library injection)
    if echo "$content" | grep -qE "(LD_PRELOAD|PYTHONPATH|NODE_OPTIONS|JAVA_TOOL_OPTIONS|RUBYOPT|PERL5LIB|DYLD_INSERT_LIBRARIES)="; then
        risk="high"
        findings+=("env_manipulation")
    fi

    # CORE-005: Injection detection (prompt injection + obfuscation)
    local injection_patterns=(
        'eval\s*\('
        'btoa\s*\('
        'atob\s*\('
        'Function\s*\('
        'base64\s+-d'
        '<system>'
        'ignore previous'
        'forget.*instruction'
        '\\x1b\['
        '\$\{IFS\}'
        '\\x[0-9a-fA-F]{2}'
        '\$\(.*\)'
    )
    for pattern in "${injection_patterns[@]}"; do
        if echo "$content" | grep -qE "$pattern"; then
            risk="high"
            findings+=("injection:$pattern")
            break
        fi
    done

    # CORE-006: CVE-2025-59536/CVE-2026-21852 Claude Code attack vectors
    # CORE-006a: MCP configuration abuse
    if echo "$content" | grep -qiE "enableAllProjectMcpServers|enabledMcpjsonServers|\.mcp\.json"; then
        risk="high"
        findings+=("cve_2026_21852:mcp_config_abuse")
    fi

    # CORE-006b: Hooks configuration tampering
    if echo "$content" | grep -qiE "pre-tool-use|post-tool-use|\.claude/settings\.json|hooks.*command"; then
        risk="high"
        findings+=("cve_2025_59536:hooks_tampering")
    fi

    # CORE-006c: Config file writes
    if echo "$content" | grep -qE ">\s*\.claude/|>\s*\.mcp\.json|>\s*\.claudeignore"; then
        risk="high"
        findings+=("config_file_tampering")
    fi

    # CORE-007: CVE-2026-25253 (OpenClaw) Auth token theft
    # Sensitive paths that should never be read
    local sensitive_paths=(
        '~/\.claude'
        '~/.config/claude'
        '~/\.anthropic'
        'credentials\.json'
        'auth\.json'
        'api[_-]?key'
        '/etc/passwd'
        '/etc/shadow'
        '\.ssh/'
        '\.aws/'
        '\.netrc'
    )
    for spath in "${sensitive_paths[@]}"; do
        if echo "$content" | grep -qiE "(cat|read|head|tail|less|more|vim|nano|cp|mv|curl.*-d|wget.*--post).*$spath"; then
            risk="high"
            findings+=("auth_theft:$spath")
            break
        fi
    done

    # CORE-008: API Key / Secret exfiltration patterns
    # Matches: curl/wget with POST/data containing env vars like $ANTHROPIC_API_KEY
    if echo "$content" | grep -qE "(curl|wget|fetch|nc|ncat).*\\\$(ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_SECRET|GITHUB_TOKEN|API_KEY|SECRET)"; then
        risk="high"
        findings+=("secret_exfil:api_key_env")
    fi

    # CORE-009: Sensitive env var access (echo/print)
    if echo "$content" | grep -qE "(echo|print|printf|cat).*\\\$(ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN)"; then
        risk="high"
        findings+=("env_leak:sensitive_var")
    fi
    if echo "$content" | grep -qE "printenv.*\|\s*grep.*(key|secret|token|password)"; then
        risk="high"
        findings+=("env_leak:printenv_grep")
    fi

    # CORE-010: DNS tunneling / covert channels
    if echo "$content" | grep -qE "(nslookup|dig|host)\s+.*\\\$\("; then
        risk="high"
        findings+=("covert_channel:dns_tunnel")
    fi

    # 4. Output result
    if [[ "$risk" == "high" ]]; then
        echo "[SECURITY] REJECT: Skill contains high-risk patterns"
        if [[ ${#findings[@]} -gt 0 ]]; then
            echo "[SECURITY] Findings:"
            for finding in "${findings[@]}"; do
                echo "  - $finding"
            done
        fi
        return 1
    else
        echo "[SECURITY] PASS: Skill static analysis passed"
        echo "[SECURITY] Risk: $risk"
        return 0
    fi
}

case "$ACTION" in
    verify-cmd)
        verify_cmd "$PAYLOAD"
        ;;
    audit-plan)
        audit_plan
        ;;
    scan-skill)
        scan_skill "$PAYLOAD"
        ;;
    *)
        echo "[ERROR] Unknown action: $ACTION" >&2
        exit 1
        ;;
esac
