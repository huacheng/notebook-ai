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

# D5: Delegate rule loading to unified rule-loader.sh
# rule-loader.sh uses yaml_parser.py for proper YAML parsing (escape sequences, etc.)
source "$SCRIPT_DIR/../../../core/rule-loader.sh"

NOTEBOOK="${1:-}"
ACTION="${2:-}"
PAYLOAD="${3:-}"

if [[ -z "$ACTION" ]]; then
    echo "[ERROR] Action is required." >&2
    exit 1
fi

# D3: Validate action before resolve_nb_workdir to avoid confusing errors
case "$ACTION" in
    verify-cmd|audit-plan|scan-skill) ;;
    *) echo "[ERROR] Unknown action: $ACTION" >&2; exit 1 ;;
esac

# scan-skill doesn't require a working directory
if [[ "$ACTION" != "scan-skill" ]]; then
    resolve_nb_workdir "$NOTEBOOK"
    NOTEBOOK="$NB_NOTEBOOK"

    if [[ ! -d "$TASKAI_WORK_DIR" ]]; then
        echo "[ERROR] Working directory not found." >&2
        exit 1
    fi
fi

verify_cmd() {
    local cmd="$1"

    # D2: Reject empty commands immediately
    if [[ -z "$cmd" ]]; then
        echo "[SECURITY] REJECT: Empty command string"
        return 1
    fi

    local risk="low"
    local reason=""

    # =========================================================================
    # TIER 1: EXTENDED RULES (Evolvable) - check command against dynamic rules
    # D5: Delegated to rule-loader.sh
    # =========================================================================
    load_rules_from_domain "security"
    local i
    for i in "${!RULE_IDS[@]}"; do
        local rule_id="${RULE_IDS[$i]}"
        local rule_pattern="${RULE_PATTERNS[$i]}"
        local rule_case_insensitive="${RULE_CASE_INSENSITIVE[$i]}"

        local -a grep_opts=("-q" "-E")
        [[ "$rule_case_insensitive" == "true" ]] && grep_opts+=("-i")

        if printf '%s\n' "$cmd" | grep "${grep_opts[@]}" -- "$rule_pattern" 2>/dev/null; then
            risk="high"
            reason="dynamic:$rule_id"
            break
        fi
    done

    # =========================================================================
    # TIER 2: CORE RULES (Security Floor - Hardcoded)
    # =========================================================================

    # 1. Fatal Pattern Blocking (Destructive commands)
    # D2: Broad pattern matching rm with force/recursive flags (parity with scan_skill CORE-001)
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE "(^|\s)rm\s+(-[a-zA-Z]*[rf]|--recursive|--force)"; then
        risk="high"
        reason="Destructive command with force/recursive flags"
    fi

    # 2. VFP Injection (Command Semantics)
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE -- "--eval|--conftest|--require|--include|--import"; then
        risk="high"
        reason="VFP semantics injection"
    fi

    # 3. Two-stage loading (download & execute patterns)
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE "(curl|wget|fetch).*\|.*(/bin/)?(bash|sh|zsh|python|perl|ruby|node)"; then
        risk="high"
        reason="Two-stage payload execution"
    fi
    # 3b. Download-then-execute pattern (curl -o file && chmod/run)
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE "(curl|wget).*(-o|-O).*&&.*(chmod|bash|sh|\./)"; then
        risk="high"
        reason="Download and execute pattern"
    fi

    # 4. Environment manipulation (high risk if overriding critical libs)
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE "(LD_PRELOAD|PYTHONPATH|NODE_OPTIONS|JAVA_TOOL_OPTIONS|RUBYOPT|PERL5LIB|DYLD_INSERT_LIBRARIES)="; then
        risk="high"
        reason="Environment manipulation"
    fi

    # 5. Path Traversal
    # D2: Only check for traversal patterns (../) not all absolute paths (too many false positives)
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE "\.\./"; then
        risk="high"
        reason="Path traversal detected"
    fi

    # 6. Sensitive path access
    # D2: Parity with scan_skill CORE-007 — include /etc/passwd and ~/.config/claude
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE "(~/\.claude|~/\.config/claude|~/\.anthropic|~/\.ssh|~/\.aws|~/\.netrc|/etc/passwd|/etc/shadow|credentials\.json|auth\.json)"; then
        risk="high"
        reason="Sensitive path access"
    fi

    # 7. Secret exfiltration via network tools
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE "(curl|wget|fetch|nc|ncat).*\\\$(ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_SECRET|GITHUB_TOKEN|API_KEY|SECRET)"; then
        risk="high"
        reason="Secret exfiltration via network"
    fi

    # 8. Injection / obfuscation in commands
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE 'base64\s+-d.*\|\s*(bash|sh)|\\x[0-9a-fA-F]{2}.*\\x[0-9a-fA-F]{2}|\$\{IFS\}'; then
        risk="high"
        reason="Command obfuscation detected"
    fi

    # 9. Config file tampering (Claude Code / MCP)
    # D2: Match both redirect (>, >>) and tee writes to config files; also MCP enablement flags
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qiE ">+\s*\.claude/|>+\s*\.mcp\.json|>+\s*\.claudeignore|tee\s+(-a\s+)?\.claude/|tee\s+(-a\s+)?\.mcp\.json|tee\s+(-a\s+)?\.claudeignore|enableAllProjectMcpServers"; then
        risk="high"
        reason="Config file tampering"
    fi

    # 10. DNS tunneling / covert exfiltration
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE "(nslookup|dig|host)\s+.*\\\$\("; then
        risk="high"
        reason="Covert channel via DNS"
    fi

    # 11. SSRF to internal networks (OWASP A10)
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE "(curl|wget|fetch)\s.*https?://(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.0\.0\.0|localhost|\[::1\])"; then
        risk="high"
        reason="SSRF: request to internal network"
    fi

    # 12. Reverse shell patterns (OWASP A03 - Injection)
    if [[ "$risk" == "low" ]] && printf '%s\n' "$cmd" | grep -qE "(bash|sh|zsh)\s+-i\s+>&\s*/dev/tcp|nc\s+-e\s+/bin/(bash|sh)|mkfifo.*nc.*sh"; then
        risk="high"
        reason="Reverse shell detected"
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
    local plan_md="$TASKAI_WORK_DIR/.plan.md"
    if [[ ! -f "$plan_md" ]]; then
        echo "[SECURITY] PASS: No plan.md to audit"
        return 0
    fi

    local content
    content=$(cat "$plan_md" 2>/dev/null) || {
        echo "[SECURITY] PASS: Could not read plan.md (may have been removed)"
        return 0
    }
    # D3: Handle empty plan gracefully
    if [[ -z "$content" ]]; then
        echo "[SECURITY] PASS: Plan is empty"
        return 0
    fi
    local risk="low"
    local findings=()

    # =========================================================================
    # TIER 1: EXTENDED RULES (Evolvable)
    # D5: Delegated to rule-loader.sh
    # =========================================================================
    load_rules_from_domain "security"
    local i
    for i in "${!RULE_IDS[@]}"; do
        local rule_id="${RULE_IDS[$i]}"
        local rule_pattern="${RULE_PATTERNS[$i]}"
        local rule_case_insensitive="${RULE_CASE_INSENSITIVE[$i]}"

        local -a grep_opts=("-q" "-E")
        [[ "$rule_case_insensitive" == "true" ]] && grep_opts+=("-i")

        if printf '%s\n' "$content" | grep "${grep_opts[@]}" -- "$rule_pattern" 2>/dev/null; then
            risk="high"
            findings+=("dynamic:$rule_id")
        fi
    done

    # =========================================================================
    # TIER 2: CORE RULES (Security Floor - Hardcoded)
    # D1: Parity with verify_cmd and scan_skill core rules
    # =========================================================================

    # Destructive commands
    if printf '%s\n' "$content" | grep -qE "(^|\s)rm\s+(-[a-zA-Z]*[rf]|--recursive|--force)"; then
        risk="high"
        findings+=("destructive_command:rm_rf")
    fi

    # VFP injection
    if printf '%s\n' "$content" | grep -qE -- "--eval|--conftest|--require|--include|--import"; then
        risk="high"
        findings+=("vfp_injection")
    fi

    # Two-stage loading (pipe)
    # D1: Parity with verify_cmd — include optional /bin/ prefix for shell binaries
    if printf '%s\n' "$content" | grep -qE "(curl|wget|fetch).*\|.*(/bin/)?(bash|sh|zsh|python|perl|ruby|node)"; then
        risk="high"
        findings+=("two_stage_loading:pipe")
    fi

    # Two-stage loading (download & execute)
    if printf '%s\n' "$content" | grep -qE "(curl|wget).*(-o|-O).*&&.*(chmod|bash|sh|\./)"; then
        risk="high"
        findings+=("two_stage_loading:download_exec")
    fi

    # Environment manipulation
    if printf '%s\n' "$content" | grep -qE "(LD_PRELOAD|PYTHONPATH|NODE_OPTIONS|JAVA_TOOL_OPTIONS|RUBYOPT|PERL5LIB|DYLD_INSERT_LIBRARIES)="; then
        risk="high"
        findings+=("env_manipulation")
    fi

    # Path traversal
    # D1: Parity with verify_cmd rule 5
    if printf '%s\n' "$content" | grep -qE "\.\./"; then
        risk="high"
        findings+=("path_traversal")
    fi

    # Injection / obfuscation patterns
    # D1: Combines prompt injection (plan-specific) + obfuscation (parity with verify_cmd rule 8)
    if printf '%s\n' "$content" | grep -qE 'eval\s*\(|base64\s+-d|<system>|ignore previous|forget.*instruction|\\x[0-9a-fA-F]{2}.*\\x[0-9a-fA-F]{2}|\$\{IFS\}'; then
        risk="high"
        findings+=("injection_or_obfuscation")
    fi

    # Config file tampering (Claude Code / MCP)
    # D2: Match both redirect (>, >>) and tee writes to config files
    if printf '%s\n' "$content" | grep -qiE ">+\s*\.claude/|>+\s*\.mcp\.json|>+\s*\.claudeignore|tee\s+(-a\s+)?\.claude/|tee\s+(-a\s+)?\.mcp\.json|tee\s+(-a\s+)?\.claudeignore|enableAllProjectMcpServers"; then
        risk="high"
        findings+=("config_tampering")
    fi

    # Sensitive path access in plan
    # D2: Parity with verify_cmd rule 6 and scan_skill CORE-007; includes /etc/passwd, ~/.config/claude
    if printf '%s\n' "$content" | grep -qiE "(cat|read|cp|curl.*-d).*(~/\.claude|~/\.config/claude|~/\.anthropic|~/\.ssh|~/\.aws|~/\.netrc|/etc/passwd|/etc/shadow|credentials\.json|auth\.json)"; then
        risk="high"
        findings+=("sensitive_path_access")
    fi

    # Secret exfiltration patterns in plan
    # D1: Parity with verify_cmd/scan_skill — include API_KEY and SECRET suffixes
    if printf '%s\n' "$content" | grep -qE "(curl|wget|fetch|nc|ncat).*\\\$(ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_SECRET|GITHUB_TOKEN|API_KEY|SECRET)"; then
        risk="high"
        findings+=("secret_exfil")
    fi

    # DNS tunneling / covert exfiltration
    # D1: Parity with verify_cmd rule 10 and scan_skill CORE-010
    if printf '%s\n' "$content" | grep -qE "(nslookup|dig|host)\s+.*\\\$\("; then
        risk="high"
        findings+=("covert_channel:dns_tunnel")
    fi

    # SSRF to internal networks
    # D1: Parity with verify_cmd rule 11 and scan_skill CORE-011
    if printf '%s\n' "$content" | grep -qE "(curl|wget|fetch)\s.*https?://(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.0\.0\.0|localhost|\[::1\])"; then
        risk="high"
        findings+=("ssrf:internal_network")
    fi

    # Reverse shell patterns
    # D1: Parity with verify_cmd rule 12 and scan_skill CORE-012
    if printf '%s\n' "$content" | grep -qE "(bash|sh|zsh)\s+-i\s+>&\s*/dev/tcp|nc\s+-e\s+/bin/(bash|sh)|mkfifo.*nc.*sh"; then
        risk="high"
        findings+=("reverse_shell")
    fi

    if [[ "$risk" == "high" ]]; then
        echo "[SECURITY] BLOCKED: High risk operations detected in plan"
        if [[ ${#findings[@]} -gt 0 ]]; then
            echo "[SECURITY] Findings:"
            for finding in "${findings[@]}"; do
                echo "  - $finding"
            done
        fi
        return 1
    fi
    echo "[SECURITY] PASS: Plan looks safe"
    return 0
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

    local content
    content=$(cat "$skill_md" 2>/dev/null) || {
        echo "[SECURITY] ERROR: Could not read skill file: $skill_md"
        return 1
    }

    # =========================================================================
    # TIER 1: EXTENDED RULES (Evolvable)
    # Loaded from .evolving-rules/security/active/*.yaml via rule-loader.sh
    # Can be added/modified/disabled without code changes
    # D5: Delegated to rule-loader.sh (uses yaml_parser.py for proper parsing)
    # =========================================================================
    load_rules_from_domain "security"
    local i
    for i in "${!RULE_IDS[@]}"; do
        local rule_id="${RULE_IDS[$i]}"
        local rule_pattern="${RULE_PATTERNS[$i]}"
        local rule_case_insensitive="${RULE_CASE_INSENSITIVE[$i]}"

        # D6: Use array for grep options to ensure safe expansion
        local -a grep_opts=("-q" "-E")
        [[ "$rule_case_insensitive" == "true" ]] && grep_opts+=("-i")

        if printf '%s\n' "$content" | grep "${grep_opts[@]}" -- "$rule_pattern" 2>/dev/null; then
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

    # CORE rules scan full $content directly for better coverage

    # CORE-001: Destructive commands
    if printf '%s\n' "$content" | grep -qE "(^|\s)rm\s+(-[a-zA-Z]*[rf]|--recursive|--force)"; then
        risk="high"
        findings+=("destructive_command:rm_rf")
    fi

    # CORE-002: VFP Injection (malicious CLI flags)
    if printf '%s\n' "$content" | grep -qE -- "--eval|--conftest|--require|--include|--import"; then
        risk="high"
        findings+=("vfp_injection")
    fi

    # CORE-003: Two-stage loading (download & execute)
    # D1: Include optional /bin/ prefix for parity with verify_cmd/audit_plan
    if printf '%s\n' "$content" | grep -qE "(curl|wget|fetch).*\|.*(/bin/)?(bash|sh|zsh|python|perl|ruby|node)"; then
        risk="high"
        findings+=("two_stage_loading:pipe")
    fi
    if printf '%s\n' "$content" | grep -qE "(curl|wget).*(-o|-O).*&&.*(chmod|bash|sh|\./)"; then
        risk="high"
        findings+=("two_stage_loading:download_exec")
    fi

    # CORE-004: Environment manipulation (library injection)
    if printf '%s\n' "$content" | grep -qE "(LD_PRELOAD|PYTHONPATH|NODE_OPTIONS|JAVA_TOOL_OPTIONS|RUBYOPT|PERL5LIB|DYLD_INSERT_LIBRARIES)="; then
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
        if printf '%s\n' "$content" | grep -qE -- "$pattern"; then
            risk="high"
            findings+=("injection:$pattern")
            break
        fi
    done

    # CORE-006: CVE-2025-59536/CVE-2026-21852 Claude Code attack vectors
    # CORE-006a: MCP configuration abuse
    if printf '%s\n' "$content" | grep -qiE "enableAllProjectMcpServers|enabledMcpjsonServers|\.mcp\.json"; then
        risk="high"
        findings+=("cve_2026_21852:mcp_config_abuse")
    fi

    # CORE-006b: Hooks configuration tampering
    if printf '%s\n' "$content" | grep -qiE "pre-tool-use|post-tool-use|\.claude/settings\.json|hooks.*command"; then
        risk="high"
        findings+=("cve_2025_59536:hooks_tampering")
    fi

    # CORE-006c: Config file writes
    # D2: Match both redirect (>, >>) and tee writes to config files
    if printf '%s\n' "$content" | grep -qE ">+\s*\.claude/|>+\s*\.mcp\.json|>+\s*\.claudeignore|tee\s+(-a\s+)?\.claude/|tee\s+(-a\s+)?\.mcp\.json|tee\s+(-a\s+)?\.claudeignore"; then
        risk="high"
        findings+=("config_file_tampering")
    fi

    # CORE-007: CVE-2026-25253 (OpenClaw) Auth token theft
    # Sensitive paths that should never be read
    local sensitive_paths=(
        '~/\.claude'
        '~/\.config/claude'
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
        if printf '%s\n' "$content" | grep -qiE "(cat|read|head|tail|less|more|vim|nano|cp|mv|curl.*-d|wget.*--post).*$spath"; then
            risk="high"
            findings+=("auth_theft:$spath")
            break
        fi
    done

    # CORE-008: API Key / Secret exfiltration patterns
    # Matches: curl/wget with POST/data containing env vars like $ANTHROPIC_API_KEY
    if printf '%s\n' "$content" | grep -qE "(curl|wget|fetch|nc|ncat).*\\\$(ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_SECRET|GITHUB_TOKEN|API_KEY|SECRET)"; then
        risk="high"
        findings+=("secret_exfil:api_key_env")
    fi

    # CORE-009: Sensitive env var access (echo/print)
    if printf '%s\n' "$content" | grep -qE "(echo|print|printf|cat).*\\\$(ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN)"; then
        risk="high"
        findings+=("env_leak:sensitive_var")
    fi
    if printf '%s\n' "$content" | grep -qE "printenv.*\|\s*grep.*(key|secret|token|password)"; then
        risk="high"
        findings+=("env_leak:printenv_grep")
    fi

    # CORE-010: DNS tunneling / covert channels
    if printf '%s\n' "$content" | grep -qE "(nslookup|dig|host)\s+.*\\\$\("; then
        risk="high"
        findings+=("covert_channel:dns_tunnel")
    fi

    # CORE-011: SSRF to internal networks
    if printf '%s\n' "$content" | grep -qE "(curl|wget|fetch)\s.*https?://(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.0\.0\.0|localhost|\[::1\])"; then
        risk="high"
        findings+=("ssrf:internal_network")
    fi

    # CORE-012: Reverse shell patterns
    if printf '%s\n' "$content" | grep -qE "(bash|sh|zsh)\s+-i\s+>&\s*/dev/tcp|nc\s+-e\s+/bin/(bash|sh)|mkfifo.*nc.*sh"; then
        risk="high"
        findings+=("reverse_shell")
    fi

    # Output result
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
        # D2: Validate payload is provided before calling scan_skill
        if [[ -z "$PAYLOAD" ]]; then
            echo "[ERROR] scan-skill requires a file path as payload." >&2
            exit 1
        fi
        scan_skill "$PAYLOAD"
        ;;
    # D6: No default branch needed — action already validated at lines 30-33
esac
