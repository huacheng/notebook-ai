#!/usr/bin/env bash
# Rule Evolution Script - validates candidate rules and activates them
# Usage: evolve-rules.sh --domain <security|sanitization|audit|all> --mode <auto|manual>
#
# This script ONLY validates existing candidates in .evolving-rules/*/candidates/
# Intelligence collection (research --caller audit) is a SEPARATE scheduled task.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/../../../core"

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
EVOLVING_RULES_DIR="$LIB_PATH/.evolving-rules"

# Default values
DOMAIN="all"
MODE="auto"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain) DOMAIN="$2"; shift 2 ;;
        --mode)   MODE="$2"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# Validate domain
VALID_DOMAINS=("security" "sanitization" "audit" "all")
if [[ ! " ${VALID_DOMAINS[*]} " =~ " $DOMAIN " ]]; then
    echo "[ERROR] Invalid domain: $DOMAIN. Must be one of: ${VALID_DOMAINS[*]}" >&2
    exit 1
fi

# Get domains to process
if [[ "$DOMAIN" == "all" ]]; then
    DOMAINS=("security" "sanitization" "audit")
else
    DOMAINS=("$DOMAIN")
fi

echo "[evolve-rules] Starting rule evolution for domains: ${DOMAINS[*]}, mode: $MODE"

# Step 1: Validate existing candidates via check --checkpoint audit-validate
# Note: Intelligence collection (research --caller audit) is a separate scheduled task,
# not part of the evolve loop. Evolve only validates what's already in candidates/.
CHECK_SH="$SCRIPT_DIR/../../check/scripts/check.sh"
if [[ -f "$CHECK_SH" ]]; then
    echo "[evolve-rules] Phase 1: Validating candidates..."
    bash "$CHECK_SH" "_evolve" --checkpoint audit-validate 2>/dev/null || true
fi

# Report results
echo "[evolve-rules] Phase 2: Evolution summary"
for domain in "${DOMAINS[@]}"; do
    CANDIDATES_DIR="$EVOLVING_RULES_DIR/$domain/candidates"
    ACTIVE_DIR="$EVOLVING_RULES_DIR/$domain/active"
    REVIEW_DIR="$EVOLVING_RULES_DIR/$domain/review"

    CANDIDATE_COUNT=$(find "$CANDIDATES_DIR" -name "*.yaml" 2>/dev/null | wc -l || echo 0)
    ACTIVE_COUNT=$(find "$ACTIVE_DIR" -name "*.yaml" 2>/dev/null | wc -l || echo 0)
    REVIEW_COUNT=$(find "$REVIEW_DIR" -name "*.yaml" 2>/dev/null | wc -l || echo 0)

    echo "  $domain: candidates=$CANDIDATE_COUNT, active=$ACTIVE_COUNT, review=$REVIEW_COUNT"
done

echo "[evolve-rules] Evolution cycle complete."
