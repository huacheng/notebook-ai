#!/usr/bin/env bash
# /task-ai:security implementation
# Usage: security.sh <notebook> <action> [payload]

set -euo pipefail

# Load context discovery from lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../core/lib.sh"

NOTEBOOK="${1:-}"
ACTION="${2:-}"
PAYLOAD="${3:-}"
resolve_workdir "$NOTEBOOK"
NOTEBOOK="$NB_NOTEBOOK"

if [[ -z "$ACTION" ]]; then
    echo "[ERROR] Action is required." >&2
    exit 1
fi

if [[ ! -d "$WORK_DIR" ]]; then
    echo "[ERROR] Working directory not found." >&2
    exit 1
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

case "$ACTION" in
    verify-cmd)
        verify_cmd "$PAYLOAD"
        ;;
    audit-plan)
        audit_plan
        ;;
    *)
        echo "[ERROR] Unknown action: $ACTION" >&2
        exit 1
        ;;
esac
