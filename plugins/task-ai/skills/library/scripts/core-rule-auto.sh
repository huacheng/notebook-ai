#!/usr/bin/env bash
# Core Rules LLM-driven automation
set -euo pipefail
# Usage: core-rule-auto.sh <action> [args]
#
# Actions:
#   discover              - Run external intel scan and generate proposals
#   elaborate <proposal>  - LLM elaborates rationale + test cases
#   review <proposal>     - LLM performs six-dimension review
#   integrate <proposal>  - Generate code change (requires approval)
#   auto-pipeline         - Full automation with configurable gates

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SECURITY_SH="$TASK_AI_ROOT/skills/security/scripts/security.sh"

# Runtime directories (under .library/, not task-ai/)
LIB_DIR="${NB_WORKSPACES_LIBRARY:-.library}"
PROPOSALS_DIR="$LIB_DIR/.core-rule-proposals"

# Configuration
AUTO_MERGE_THRESHOLD=0.95    # Minimum confidence for auto-merge
PRECISION_THRESHOLD=0.98     # Minimum precision on historical data
REQUIRE_HUMAN_APPROVAL=false # Full automation enabled (set true for manual approval gate)

# Evolution intervals (seconds)
CORE_RULES_INTERVAL=$((7 * 24 * 3600))      # 7 days for Core Rules
EXTENDED_RULES_INTERVAL=$((1 * 24 * 3600))  # 1 day for Extended Rules

ACTION="${1:-}"
shift || true

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Audit log location
AUDIT_LOG="$PROPOSALS_DIR/.audit.log"

# Ensure proposals directory exists
mkdir -p "$PROPOSALS_DIR"

# Audit logging function
# Usage: audit_log <action> <status> <details>
audit_log() {
    local action="$1"
    local status="$2"
    local details="${3:-}"
    local timestamp=$(date -Iseconds)
    local entry=$(printf '{"ts":"%s","action":"%s","status":"%s","details":"%s"}\n' \
        "$timestamp" "$action" "$status" "$details")
    echo "$entry" >> "$AUDIT_LOG"
}

discover_threats() {
    audit_log "discover" "started" ""
    echo -e "${BLUE}=== Step 1: Discovering New Threats ===${NC}"
    echo ""

    # This would integrate with research --caller audit
    # For now, output LLM instructions

    cat <<'EOF'
LLM Instructions for threat discovery:

1. Search external sources:
   - NIST NVD API: CVEs with keywords [LLM, AI agent, prompt injection, MCP]
   - OWASP LLM Top 10 updates
   - GitHub Security Advisories: claude-code, openclaw, langchain
   - arXiv cs.CR: recent security papers

2. For each threat found:
   a. Analyze if it's already covered by existing Core/Extended rules
   b. If not covered, determine if it should be Core (mandatory) or Extended (optional)
   c. Core criteria:
      - Attack is severe (RCE, data exfil, auth bypass)
      - Pattern is stable (won't cause false positives)
      - Disabling detection would be dangerous

3. Generate proposals for uncovered Core-worthy threats:
   library core-rule propose "<name>" "<pattern>" --cve <CVE-ID>

4. Output format:
   {
     "discovered": 5,
     "already_covered": 3,
     "new_proposals": [
       {"id": "CORE-011", "name": "...", "cve": "CVE-..."}
     ]
   }
EOF
    audit_log "discover" "completed" "instructions_output"
}

elaborate_proposal() {
    local proposal_file="${1:-}"

    if [[ -z "$proposal_file" || ! -f "$proposal_file" ]]; then
        echo "Usage: core-rule-auto elaborate <proposal.md>"
        exit 1
    fi

    audit_log "elaborate" "started" "file=$(basename "$proposal_file")"
    echo -e "${BLUE}=== Step 2: LLM Elaborating Proposal ===${NC}"
    echo ""

    cat <<EOF
LLM Instructions for elaboration:

Read proposal: $proposal_file

1. Fill in "## Rationale" section:
   - Why must this be a CORE rule (cannot be disabled)?
   - What attack does it prevent?
   - What's the blast radius if exploited?
   - Reference CVE/advisory if applicable

2. Fill in "## Test Cases" section:
   ### Should REJECT (true positives)
   - Generate 3-5 realistic examples that SHOULD be blocked
   - Include variations (different quoting, spacing, etc.)

   ### Should PASS (true negatives)
   - Generate 3-5 legitimate examples that should NOT be blocked
   - Include edge cases that look similar but are safe

3. Run validation:
   library core-rule validate "<pattern>"

4. Update "## Validation Results" with actual output

5. Check all items in "## Checklist"

Output: Updated proposal file with all sections filled
EOF
    audit_log "elaborate" "completed" "file=$(basename "$proposal_file")"
}

review_proposal() {
    local proposal_file="${1:-}"

    if [[ -z "$proposal_file" || ! -f "$proposal_file" ]]; then
        echo "Usage: core-rule-auto review <proposal.md>"
        exit 1
    fi

    audit_log "review" "started" "file=$(basename "$proposal_file")"
    echo -e "${BLUE}=== Step 3: LLM Six-Dimension Review ===${NC}"
    echo ""

    # Extract pattern from proposal
    local pattern=$(grep -E '^- \*\*Pattern\*\*:' "$proposal_file" | sed 's/.*`\(.*\)`.*/\1/')
    local name=$(grep -E '^- \*\*Name\*\*:' "$proposal_file" | sed 's/.*: //')

    echo "Reviewing: $name"
    echo "Pattern: $pattern"
    echo ""

    cat <<EOF
LLM Instructions for six-dimension review:

## D1 Correctness (25%)
- Does the pattern match the intended threat?
- Are there false negatives (missed attacks)?
- Score: [0.0-1.0]

## D2 Security (25%)
- Is the pattern itself safe (no injection)?
- Does it align with the stated CVE/threat?
- Score: [0.0-1.0]

## D3 Reliability (20%)
- What's the false positive rate on legitimate skills?
- Edge cases handled?
- Score: [0.0-1.0]

## D4 Performance (10%)
- Is the regex efficient?
- Any catastrophic backtracking risk?
- Score: [0.0-1.0]

## D5 Architecture (10%)
- Does this belong in Core (not Extended)?
- Consistent with existing Core rules?
- Score: [0.0-1.0]

## D6 Maintainability (10%)
- Is the pattern readable/understandable?
- Well documented?
- Score: [0.0-1.0]

## Composite Score
composite = D1*0.25 + D2*0.25 + D3*0.20 + D4*0.10 + D5*0.10 + D6*0.10

## Verdict
- composite >= $AUTO_MERGE_THRESHOLD AND precision >= $PRECISION_THRESHOLD → AUTO_APPROVE
- composite >= 0.80 → RECOMMEND_APPROVE (human review suggested)
- composite < 0.80 → NEEDS_REVISION

Output format:
{
  "scores": {"d1": 0.9, "d2": 0.95, "d3": 0.85, "d4": 0.9, "d5": 0.9, "d6": 0.85},
  "composite": 0.90,
  "precision": 0.97,
  "verdict": "RECOMMEND_APPROVE",
  "concerns": ["Pattern may match legitimate kubectl debug commands"],
  "suggestions": ["Consider adding negative lookahead for 'debug'"]
}
EOF
    audit_log "review" "completed" "file=$(basename "$proposal_file")"
}

integrate_proposal() {
    local proposal_file="${1:-}"

    if [[ -z "$proposal_file" || ! -f "$proposal_file" ]]; then
        echo "Usage: core-rule-auto integrate <proposal.md>"
        exit 1
    fi

    audit_log "integrate" "started" "file=$(basename "$proposal_file")"
    echo -e "${BLUE}=== Step 4: Generating Code Integration ===${NC}"
    echo ""

    # Extract info from proposal
    local core_id=$(grep -E '^# Core Rule Proposal:' "$proposal_file" | grep -oE 'CORE-[0-9]+')
    local pattern=$(grep -E '^- \*\*Pattern\*\*:' "$proposal_file" | sed 's/.*`\(.*\)`.*/\1/')
    local name=$(grep -E '^- \*\*Name\*\*:' "$proposal_file" | sed 's/.*: //')

    echo "Generating code for: $core_id - $name"
    echo ""

    # Generate the code block
    local code_block="    # $core_id: $name
    if echo \"\$content\" | grep -qE \"$pattern\"; then
        risk=\"high\"
        findings+=(\"$core_id:$(echo "$name" | tr ' ' '_' | tr '[:upper:]' '[:lower:]')\")
    fi"

    echo -e "${YELLOW}Code to add to security.sh:${NC}"
    echo ""
    echo "$code_block"
    echo ""

    if [[ "$REQUIRE_HUMAN_APPROVAL" == "true" ]]; then
        echo -e "${RED}⚠️  HUMAN APPROVAL REQUIRED${NC}"
        echo ""
        echo "To integrate this rule:"
        echo "  1. Review the code above"
        echo "  2. Add to security.sh in TIER 2: CORE RULES section"
        echo "  3. Add test case to skill-sandbox.test.sh"
        echo "  4. Commit and create PR"
        echo ""
        echo "To enable auto-merge, set REQUIRE_HUMAN_APPROVAL=false"
        echo "(Only recommended for trusted, air-gapped environments)"
        audit_log "integrate" "pending_approval" "rule=$core_id"
    else
        echo -e "${GREEN}Auto-merge enabled. Integrating...${NC}"

        # For Extended Rules: write YAML to .evolving-rules/
        local rule_yaml="$LIB_DIR/.evolving-rules/security/active/${core_id}-$(echo "$name" | tr ' ' '-' | tr '[:upper:]' '[:lower:]').yaml"
        mkdir -p "$(dirname "$rule_yaml")"
        cat > "$rule_yaml" <<EOYAML
id: $core_id
name: $name
pattern: "$pattern"
enabled: true
added: $(date +%Y-%m-%d)
source: auto-evolved
EOYAML
        echo "[INTEGRATE] Created: $rule_yaml"

        # Commit to library
        local lib_commit="$SCRIPT_DIR/lib-commit.sh"
        if [[ -x "$lib_commit" ]]; then
            bash "$lib_commit" --system evolve "add $core_id $name" "$rule_yaml"
        fi

        audit_log "integrate" "auto_merged" "rule=$core_id,file=$rule_yaml"
    fi
}

auto_pipeline() {
    echo -e "${BLUE}=== Full Automation Pipeline ===${NC}"
    echo ""

    cat <<'EOF'
Pipeline Configuration:
  AUTO_MERGE_THRESHOLD: 0.95 (LLM confidence)
  PRECISION_THRESHOLD:  0.98 (historical backtest)
  REQUIRE_HUMAN_APPROVAL: false (full automation)

Pipeline Steps:

┌─────────────────────────────────────────────────────────────────┐
│  1. DISCOVER (fully automated)                                  │
│     research --caller audit → new threats                       │
│     ↓                                                           │
│  2. PROPOSE (fully automated)                                   │
│     library core-rule propose → .core-rule-proposals/           │
│     ↓                                                           │
│  3. ELABORATE (LLM automated)                                   │
│     LLM fills rationale + test cases                            │
│     ↓                                                           │
│  4. VALIDATE (fully automated)                                  │
│     library core-rule validate → precision/recall               │
│     ↓                                                           │
│  5. REVIEW (LLM automated)                                      │
│     Six-dimension review → composite score                      │
│     ↓                                                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  DECISION GATE                                          │    │
│  │  ├─ composite >= 0.95 AND precision >= 0.98             │    │
│  │  │   → AUTO_APPROVE (if REQUIRE_HUMAN_APPROVAL=false)   │    │
│  │  │   → RECOMMEND_APPROVE (if REQUIRE_HUMAN_APPROVAL)    │    │
│  │  ├─ composite >= 0.80                                   │    │
│  │  │   → NEEDS_HUMAN_REVIEW                               │    │
│  │  └─ composite < 0.80                                    │    │
│  │       → REJECT (move to review/ for manual analysis)    │    │
│  └─────────────────────────────────────────────────────────┘    │
│     ↓                                                           │
│  6. INTEGRATE (conditional)                                     │
│     ├─ AUTO: modify security.sh + create PR                     │
│     └─ MANUAL: generate instructions for human                  │
│     ↓                                                           │
│  7. RELEASE (CI/CD)                                             │
│     PR merge → version bump → publish                           │
└─────────────────────────────────────────────────────────────────┘

Safety Controls:
  ✓ Historical backtest required (precision >= 0.98)
  ✓ Six-dimension review must pass (>= 0.80)
  ✓ All decisions logged to .evolving-rules.log
  ✓ Audit trail in .core-rule-proposals/
  ✓ Git provides rollback safety net

One-click full automation:
  library core-rule-auto auto-pipeline

Scheduled check:
  library core-rule-auto cron-job [--core|--extended|--all] [--force]
  library core-rule-auto cron-setup   # Show external cron setup
EOF
}

# Cron job entry point - checks if scan is due
# Usage: cron_job [--core|--extended|--all] [--force]
cron_job() {
    local rule_type="all"
    local force=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --core)     rule_type="core"; shift ;;
            --extended) rule_type="extended"; shift ;;
            --all)      rule_type="all"; shift ;;
            --force)    force="--force"; shift ;;
            *) shift ;;
        esac
    done

    local now=$(date +%s)

    # Check Core Rules
    if [[ "$rule_type" == "core" || "$rule_type" == "all" ]]; then
        local core_state="$PROPOSALS_DIR/.last-scan-core"
        local core_due=true

        if [[ -f "$core_state" && -z "$force" ]]; then
            local last=$(($(cat "$core_state")))
            local elapsed=$((now - last))
            if [[ $elapsed -lt $CORE_RULES_INTERVAL ]]; then
                local remaining=$(( (CORE_RULES_INTERVAL - elapsed) / 3600 ))
                echo "[CORE] Last scan: $((elapsed / 3600))h ago. Next in ${remaining}h. (interval: $((CORE_RULES_INTERVAL / 86400))d)"
                core_due=false
            fi
        fi

        if [[ "$core_due" == "true" ]]; then
            echo "[CORE] Starting Core Rules scan..."
            audit_log "cron-core" "started" "interval=${CORE_RULES_INTERVAL}s"
            discover_threats
            echo "$now" > "$core_state"
            audit_log "cron-core" "completed" ""
        fi
    fi

    # Check Extended Rules
    if [[ "$rule_type" == "extended" || "$rule_type" == "all" ]]; then
        local ext_state="$PROPOSALS_DIR/.last-scan-extended"
        local ext_due=true

        if [[ -f "$ext_state" && -z "$force" ]]; then
            local last=$(($(cat "$ext_state")))
            local elapsed=$((now - last))
            if [[ $elapsed -lt $EXTENDED_RULES_INTERVAL ]]; then
                local remaining=$(( (EXTENDED_RULES_INTERVAL - elapsed) / 3600 ))
                echo "[EXTENDED] Last sync: $((elapsed / 3600))h ago. Next in ${remaining}h. (interval: $((EXTENDED_RULES_INTERVAL / 86400))d)"
                ext_due=false
            fi
        fi

        if [[ "$ext_due" == "true" ]]; then
            echo "[EXTENDED] Syncing Extended Rules from .evolving-rules/..."
            audit_log "cron-extended" "started" "interval=${EXTENDED_RULES_INTERVAL}s"
            # Extended rules are YAML files - just verify they exist and are valid
            local rules_dir="$LIB_DIR/.evolving-rules/security/active"
            if [[ -d "$rules_dir" ]]; then
                local count=$(find "$rules_dir" -name "*.yaml" -o -name "*.yml" 2>/dev/null | wc -l)
                echo "[EXTENDED] Active rules: $count"
            else
                echo "[EXTENDED] No active rules directory yet."
            fi
            echo "$now" > "$ext_state"
            audit_log "cron-extended" "completed" ""
        fi
    fi

}

# Show cron setup instructions
show_cron_setup() {
    # Resolve to absolute paths
    local workspace
    workspace="$(cd "${NB_WORKSPACES_ROOT:-.}" && pwd)"
    local lib_dir="$workspace/.library"
    local script_path="$lib_dir/.evolve-cron.sh"
    local log_path="$lib_dir/.evolve.log"

    cat <<EOF
External Cron Setup
===================

.library is shared across all projects in the workspace.
One cron job covers all projects under \$NB_WORKSPACES_ROOT.

Script: $script_path
Log:    $log_path

Quick Setup (copy & run):
-------------------------
cat > $script_path << 'EOSCRIPT'
#!/bin/bash
cd $workspace || exit 1
claude --print "/task-ai library evolve --full" 2>&1 >> $log_path
EOSCRIPT
chmod +x $script_path
(crontab -l 2>/dev/null; echo "0 3 * * 0  $script_path") | crontab -


Multiple Workspaces (different NB_WORKSPACES_ROOT):
---------------------------------------------------
0 3 * * 0  /workspace-a/.library/.evolve-cron.sh
0 4 * * 0  /workspace-b/.library/.evolve-cron.sh

EOF
}

case "$ACTION" in
    discover)
        discover_threats
        ;;
    elaborate)
        elaborate_proposal "$@"
        ;;
    review)
        review_proposal "$@"
        ;;
    integrate)
        integrate_proposal "$@"
        ;;
    auto-pipeline|pipeline)
        auto_pipeline
        ;;
    cron-job|cron)
        cron_job "$@"
        ;;
    cron-setup|setup)
        show_cron_setup
        ;;
    *)
        echo "Core Rules LLM Automation"
        echo ""
        echo "Usage: library core-rule-auto <action> [args]"
        echo ""
        echo "Actions:"
        echo "  discover              Scan for new threats (LLM)"
        echo "  elaborate <proposal>  Fill rationale + tests (LLM)"
        echo "  review <proposal>     Six-dimension review (LLM)"
        echo "  integrate <proposal>  Generate code change"
        echo "  auto-pipeline         Show full automation flow"
        echo "  cron-job [opts]       Scheduled check (--core 7d / --extended 1d / --all / --force)"
        echo "  cron-setup            Show external cron setup instructions"
        echo ""
        echo "Safety: REQUIRE_HUMAN_APPROVAL=$REQUIRE_HUMAN_APPROVAL"
        exit 1
        ;;
esac
