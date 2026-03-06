#!/usr/bin/env bash
# highlight scope=promote — Experience to Skill Promotion
# Usage: promote.sh [--dry-run] [--target <experience-file>]
# Triggers: quality_status=verified, usage_count>=3, structural patterns

set -euo pipefail

# D3: Verify bc is available (used for floating-point arithmetic)
if ! command -v bc &>/dev/null; then
    echo "[ERROR] 'bc' is required but not installed." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/../../../core"

# Load core library and ensure library directory exists
source "$CORE_DIR/lib.sh"
ensure_library

# D5: Use NB_WORKSPACES_LIBRARY exported by lib.sh (single source of truth)
LIB_PATH="$NB_WORKSPACES_LIBRARY"
EXPERIENCES_DIR="$LIB_PATH/.memory/.experiences"
SKILLS_DIR="$LIB_PATH/.skills"
CANDIDATES_DIR="$SKILLS_DIR/.candidates"
CHANGELOG="$LIB_PATH/.changelog"

# D2: Trap to clean up lock files owned by this process on unexpected exit
_cleanup_locks() {
    local lock_file="$LIB_PATH/.changelog.lock"
    if [[ -f "$lock_file" ]]; then
        local lock_pid
        lock_pid=$(grep -o '"pid":[0-9]*' "$lock_file" 2>/dev/null | grep -o '[0-9]*' || true)
        if [[ "$lock_pid" == "$$" ]]; then
            rm -f "$lock_file" 2>/dev/null || true
        fi
    fi
}
trap _cleanup_locks EXIT

# Thresholds
MIN_USAGE_COUNT=3

# Arguments
DRY_RUN=false
TARGET_FILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=true; shift ;;
        --target)
            if [[ -z "${2:-}" ]]; then
                echo "[ERROR] --target requires a file path argument" >&2
                exit 1
            fi
            TARGET_FILE="$2"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

echo "[promote] Scanning for promotable experiences..."

# Ensure directories exist
if ! mkdir -p "$CANDIDATES_DIR"; then
    echo "[ERROR] Failed to create candidates directory: $CANDIDATES_DIR" >&2
    exit 1
fi

#######################################
# Parse frontmatter field from markdown file
#######################################
parse_frontmatter() {
    local file="$1"
    local field="$2"

    # D3: Extract YAML frontmatter between first two --- markers only
    # Uses awk to stop after the closing ---, avoiding false matches in body
    # D2: Use -F (fixed-string) for field match to avoid regex injection from field names.
    # Uses awk with index() (literal string match) to avoid interpolating field into a regex.
    awk 'NR==1 && /^---$/{f=1;next} f && /^---$/{exit} f' "$file" 2>/dev/null | \
        awk -v key="${field}:" 'index($0, key) == 1 { sub(key, ""); sub(/^[[:space:]]*/, ""); print; exit }' | \
        tr -d '"' | tr -d "'"
}

#######################################
# Count usage from changelog
# Searches for references to the experience file path
#######################################
count_usage() {
    local exp_path="$1"
    local relative_path="${exp_path#$LIB_PATH/}"

    if [[ ! -f "$CHANGELOG" ]]; then
        echo 0
        return
    fi

    # D1: Count only 'referenced' type entries in changelog (actual usage by other tasks).
    # Excludes the initial experience/skill-candidate write entries which are not real usage.
    # Uses -F for fixed-string match (paths contain regex metachar '.').
    local count
    count=$(grep -F "$relative_path" "$CHANGELOG" 2>/dev/null | grep -c '| referenced |' 2>/dev/null || echo 0)
    echo "$count"
}

#######################################
# Check if experience has structural patterns
#######################################
has_structural_patterns() {
    local file="$1"

    # Check for "## Patterns" or "## Steps" headers (prefix match — also matches
    # "## Patterns Discovered" and similar variants, which is intentional)
    # §3.7 trigger condition 3
    if grep -qE '^## (Patterns|Steps)' "$file" 2>/dev/null; then
        return 0
    fi
    return 1
}

#######################################
# Extract section content between ## headers
# Uses awk with prefix match to handle variants like "## Patterns Discovered".
# Handles last-section edge case (no trailing ## header).
#######################################
extract_section() {
    local file="$1" header="$2"
    awk -v h="## $header" '
        index($0, h) == 1 { found=1; next }
        found && /^## / { exit }
        found { print }
    ' "$file"
}

#######################################
# Generate slug from experience file
#######################################
generate_slug() {
    local file="$1"
    local basename
    basename=$(basename "$file" .md)

    # Remove common suffixes (order matters: strip -complete first, then stage prefix)
    basename="${basename%-complete}"
    basename="${basename%-impl}"
    basename="${basename%-verify}"
    basename="${basename%-adhoc}"
    # D6: Strip -stage-N suffix (e.g., "notebook-stage-2" → "notebook")
    basename=$(echo "$basename" | sed 's/-stage-[0-9]\+$//')

    # Convert to kebab-case
    local slug
    slug=$(echo "$basename" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | tr ' ' '-')

    # D3: Validate slug is non-empty after suffix stripping
    if [[ -z "$slug" ]]; then
        slug="unnamed-experience"
    fi

    # D1: Validate slug matches the kebab-case contract from SKILL.md §3.6
    # Strip any characters not matching [a-zA-Z0-9-]
    slug=$(echo "$slug" | sed 's/[^a-zA-Z0-9-]//g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//')
    [[ -z "$slug" ]] && slug="unnamed-experience"
    echo "$slug"
}

#######################################
# Extract skill content from experience
#######################################
extract_skill_content() {
    local exp_file="$1"
    local skill_name="$2"

    # Parse experience metadata
    local exp_type
    exp_type=$(parse_frontmatter "$exp_file" "type")
    [[ -z "$exp_type" ]] && exp_type="general"

    local keywords
    keywords=$(parse_frontmatter "$exp_file" "topic_keywords")
    # D1: strip surrounding brackets — parse_frontmatter preserves YAML list syntax [a, b]
    keywords="${keywords#\[}"
    keywords="${keywords%\]}"

    # Extract key sections
    local patterns=""
    local what_worked=""
    local context=""

    # Extract ## Patterns or ## Patterns Discovered
    if grep -q "^## Patterns" "$exp_file" 2>/dev/null; then
        patterns=$(extract_section "$exp_file" "Patterns")
    fi

    # D6: Extract ## What Worked (maps to "## Steps" in generated skill)
    if grep -q "^## What Worked" "$exp_file" 2>/dev/null; then
        what_worked=$(extract_section "$exp_file" "What Worked")
    fi

    # Extract ## Context
    if grep -q "^## Context" "$exp_file" 2>/dev/null; then
        context=$(extract_section "$exp_file" "Context")
    fi

    # D2: Sanitize context snippet for YAML double-quoted string —
    # remove quotes/backticks, collapse newlines, escape backslashes (YAML interprets \n, \t, etc.)
    local safe_context
    safe_context=$(echo "${context:0:100}" | tr -d '"'"'"'`' | tr '\n' ' ' | sed 's/\\/\\\\/g' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')

    # Generate SKILL.md content
    cat <<EOF
---
name: $skill_name
description: "Auto-generated skill from verified experience. $safe_context"
model_tier: medium
auto_delegatable: false
triggers:
  keywords:
    en: [${keywords:-$skill_name}]
source:
  type: promote
  experience: $(basename "$exp_file")
  promoted_at: $(date -Iseconds)
trust_tier: T1
---

# /$skill_name

Auto-generated from verified experience: \`$(basename "$exp_file")\`

## When to Use

$context

## Steps

$what_worked

## Patterns

$patterns

## Notes

- **Trust Tier**: T1 (unverified candidate)
- **Source**: Promoted from \`.memory/.experiences/\`
- **Review Required**: Yes (run \`check --checkpoint skill-review\` before activation)
EOF
}

#######################################
# Generate trust report
#######################################
generate_trust_report() {
    local exp_file="$1"
    local skill_name="$2"
    local usage_count="$3"

    local quality_status
    quality_status=$(parse_frontmatter "$exp_file" "quality_status")

    cat <<EOF
# Trust Report: $skill_name

## Promotion Criteria

| Criterion | Value | Threshold | Status |
|-----------|-------|-----------|--------|
| quality_status | $quality_status | verified | $([ "$quality_status" = "verified" ] && echo "✅ PASS" || echo "❌ FAIL") |
| usage_count | $usage_count | >= $MIN_USAGE_COUNT | $([ "$usage_count" -ge "$MIN_USAGE_COUNT" ] && echo "✅ PASS" || echo "❌ FAIL") |
| structural_patterns | present | required | ✅ PASS |

## Source Experience

- **File**: $(basename "$exp_file")
- **Type**: $(parse_frontmatter "$exp_file" "type")
- **Created**: $(parse_frontmatter "$exp_file" "created_at")

## Initial Trust Assignment

- **Trust Tier**: T1 (Unverified)
- **Next Steps**:
  1. Run \`check --checkpoint skill-review --target SKILL.md\` → L2 six-dimension audit, score >= 0.70 → T2 (move to .drafts/)
  2. Run \`check --checkpoint skill-deep-review --target SKILL.md\` → L3 deep semantic review, score >= 0.85 → T3 (move to .active/)
  3. Production validation (usage_count >= 3 post-activation, zero failures) → T4 (fully verified)

## Promotion Timestamp

$(date -Iseconds)
EOF
}

#######################################
# Process single experience file
#######################################
process_experience() {
    local exp_file="$1"

    echo "[promote] Checking: $exp_file"

    # Check quality_status
    local quality_status
    quality_status=$(parse_frontmatter "$exp_file" "quality_status")
    if [[ "$quality_status" != "verified" ]]; then
        echo "[promote]   Skip: quality_status=$quality_status (need verified)"
        return 1
    fi

    # Check usage_count
    local usage_count
    usage_count=$(count_usage "$exp_file")
    if [[ "$usage_count" -lt "$MIN_USAGE_COUNT" ]]; then
        echo "[promote]   Skip: usage_count=$usage_count (need >= $MIN_USAGE_COUNT)"
        return 1
    fi

    # Check structural patterns
    if ! has_structural_patterns "$exp_file"; then
        echo "[promote]   Skip: no structural patterns (## Patterns or ## Steps)"
        return 1
    fi

    echo "[promote]   Eligible! quality=verified, usage=$usage_count, has patterns"

    # ─────────────────────────────────────────────────────────────────
    # Pipeline Step 1: D2 Security Check (Static Analysis)
    # ─────────────────────────────────────────────────────────────────
    echo "[promote]   Running D2 Security check..."
    local SECURITY_SCORE=1.0
    local SECURITY_ISSUES=""

    # Check for dangerous patterns
    # D2: use [[:space:]] for POSIX portability (not \s which is PCRE)
    if grep -qE '\$\(|`[^`]+`|eval[[:space:]]|exec[[:space:]]' "$exp_file" 2>/dev/null; then
        SECURITY_SCORE=$(echo "$SECURITY_SCORE - 0.3" | bc)
        SECURITY_ISSUES="${SECURITY_ISSUES}command-substitution;"
    fi
    if grep -qiE 'curl.*\||wget.*\||bash[[:space:]]+-c|sh[[:space:]]+-c' "$exp_file" 2>/dev/null; then
        SECURITY_SCORE=$(echo "$SECURITY_SCORE - 0.4" | bc)
        SECURITY_ISSUES="${SECURITY_ISSUES}remote-exec;"
    fi
    if grep -qiE 'rm[[:space:]]+-rf|chmod[[:space:]]+777|sudo[[:space:]]' "$exp_file" 2>/dev/null; then
        SECURITY_SCORE=$(echo "$SECURITY_SCORE - 0.2" | bc)
        SECURITY_ISSUES="${SECURITY_ISSUES}dangerous-cmd;"
    fi

    # Clamp score
    SECURITY_SCORE=$(echo "if ($SECURITY_SCORE < 0) 0 else $SECURITY_SCORE" | bc)

    if (( $(echo "$SECURITY_SCORE < 0.5" | bc -l) )); then
        echo "[promote]   REJECT: D2 Security failed ($SECURITY_SCORE) - $SECURITY_ISSUES"
        return 1
    fi
    echo "[promote]   D2 Security: $SECURITY_SCORE ✓"

    # ─────────────────────────────────────────────────────────────────
    # Pipeline Step 2: D1/D3/D5 Semantic Review (Self-Assessment)
    # ─────────────────────────────────────────────────────────────────
    echo "[promote]   Running D1/D3/D5 Semantic review..."
    local SEMANTIC_SCORE=0.5

    # D1 Correctness: Has clear objective/context
    if grep -qE "^## (Context|Objective|Goal|Purpose)" "$exp_file" 2>/dev/null; then
        SEMANTIC_SCORE=$(echo "$SEMANTIC_SCORE + 0.15" | bc)
    fi

    # D3 Reliability: Has error handling or edge case docs
    if grep -qiE "(error|fail|edge.case|fallback|when.*not)" "$exp_file" 2>/dev/null; then
        SEMANTIC_SCORE=$(echo "$SEMANTIC_SCORE + 0.15" | bc)
    fi

    # D5 Architecture: Has clear structure (multiple sections)
    local section_count
    section_count=$(grep -cE "^## " "$exp_file" 2>/dev/null || echo 0)
    if [[ "$section_count" -ge 3 ]]; then
        SEMANTIC_SCORE=$(echo "$SEMANTIC_SCORE + 0.2" | bc)
    elif [[ "$section_count" -ge 2 ]]; then
        SEMANTIC_SCORE=$(echo "$SEMANTIC_SCORE + 0.1" | bc)
    fi

    if (( $(echo "$SEMANTIC_SCORE < 0.5" | bc -l) )); then
        echo "[promote]   REJECT: D1/D3/D5 Semantic review failed ($SEMANTIC_SCORE)"
        return 1
    fi
    echo "[promote]   D1/D3/D5 Semantic: $SEMANTIC_SCORE ✓"

    # ─────────────────────────────────────────────────────────────────
    # Pipeline Step 3: Combined Pre-Promotion Score
    # ─────────────────────────────────────────────────────────────────
    local PRE_SCORE
    PRE_SCORE=$(echo "scale=2; $SECURITY_SCORE * 0.4 + $SEMANTIC_SCORE * 0.6" | bc)
    echo "[promote]   Pre-promotion score: $PRE_SCORE"

    if (( $(echo "$PRE_SCORE < 0.5" | bc -l) )); then
        echo "[promote]   REJECT: Pre-promotion score too low ($PRE_SCORE < 0.5)"
        return 1
    fi

    # Generate skill
    local slug
    slug=$(generate_slug "$exp_file")
    local candidate_dir="$CANDIDATES_DIR/$slug"

    if [[ -d "$candidate_dir" ]]; then
        echo "[promote]   Skip: candidate already exists at $candidate_dir"
        return 1
    fi

    if $DRY_RUN; then
        echo "[promote]   DRY-RUN: Would create $candidate_dir/SKILL.md"
        return 0
    fi

    # Create candidate directory and files
    if ! mkdir -p "$candidate_dir"; then
        echo "[promote]   ERROR: Failed to create candidate directory: $candidate_dir" >&2
        return 1
    fi

    # D3: file writes — stderr must NOT mix into stdout (heredoc content)
    if ! extract_skill_content "$exp_file" "$slug" > "$candidate_dir/SKILL.md"; then
        echo "[promote]   ERROR: Failed to write SKILL.md" >&2
        rm -rf "$candidate_dir"
        return 1
    fi
    if ! generate_trust_report "$exp_file" "$slug" "$usage_count" > "$candidate_dir/trust-report.md"; then
        echo "[promote]   WARN: Failed to write trust-report.md" >&2
    fi

    # Append pre-promotion scores to trust-report
    cat >> "$candidate_dir/trust-report.md" <<EOF

## Pre-Promotion Review (Pipeline Steps 1-2)

| Check | Score | Threshold | Status |
|-------|-------|-----------|--------|
| D2 Security | $SECURITY_SCORE | 0.5 | ✅ PASS |
| D1/D3/D5 Semantic | $SEMANTIC_SCORE | 0.5 | ✅ PASS |
| **Combined** | $PRE_SCORE | 0.5 | ✅ PASS |

${SECURITY_ISSUES:+**Security Notes**: $SECURITY_ISSUES}
EOF

    echo "[promote]   Created: $candidate_dir/SKILL.md"
    echo "[promote]   Created: $candidate_dir/trust-report.md"

    # Append to changelog — acquire .changelog.lock per Library Write Protocol step 4
    local changelog_lock="$LIB_PATH/.changelog.lock"
    local lock_acquired=false
    local max_retries=5
    local retry=0
    while [[ $retry -lt $max_retries ]]; do
        if ( set -o noclobber; echo "{\"pid\":$$,\"session\":\"promote\",\"timestamp\":\"$(date -Iseconds)\"}" > "$changelog_lock" ) 2>/dev/null; then
            lock_acquired=true
            break
        fi
        # D3: Detect stale lock — if lock holder PID is dead, remove and retry
        if [[ -f "$changelog_lock" ]]; then
            local lock_pid
            lock_pid=$(grep -o '"pid":[0-9]*' "$changelog_lock" 2>/dev/null | grep -o '[0-9]*' || true)
            if [[ -n "$lock_pid" ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
                echo "[promote]   Removing stale lock (pid $lock_pid is dead)" >&2
                rm -f "$changelog_lock"
                continue
            fi
        fi
        sleep 0.2
        ((retry++)) || true
    done
    if $lock_acquired; then
        echo "$(date -Iseconds) | skill-candidate | .skills/.candidates/$slug | source:promote | from:$(basename "$exp_file")" >> "$CHANGELOG" 2>/dev/null || \
            echo "[promote]   WARN: Failed to append to changelog" >&2
        rm -f "$changelog_lock"
    else
        echo "[promote]   WARN: Could not acquire .changelog.lock, skipping changelog" >&2
    fi

    return 0
}

#######################################
# Main
#######################################
PROMOTED_COUNT=0
SCANNED_COUNT=0

if [[ -n "$TARGET_FILE" ]]; then
    # Process single file
    if [[ -f "$TARGET_FILE" ]]; then
        if process_experience "$TARGET_FILE"; then
            ((PROMOTED_COUNT++)) || true
        fi
        ((SCANNED_COUNT++)) || true
    else
        echo "[ERROR] Target file not found: $TARGET_FILE" >&2
        exit 1
    fi
else
    # Scan all experience files
    if [[ -d "$EXPERIENCES_DIR" ]]; then
        while IFS= read -r -d '' exp_file; do
            ((SCANNED_COUNT++)) || true
            if process_experience "$exp_file"; then
                ((PROMOTED_COUNT++)) || true
            fi
        # D4: Exclude index/summary files and complete distillation files (not individual experiences).
        # Both stage-complete (*-stage-*-complete.md) and final-complete (*-complete.md) are
        # meta-summaries produced by scope=complete — they should not be promoted into skills.
        done < <(find "$EXPERIENCES_DIR" -name "*.md" -type f ! -name ".index.md" ! -name ".summary.md" ! -name "*-complete.md" -print0 2>/dev/null)
    fi
fi

echo ""
echo "[promote] Complete: scanned=$SCANNED_COUNT, promoted=$PROMOTED_COUNT"

if [[ "$PROMOTED_COUNT" -gt 0 ]] && ! $DRY_RUN; then
    echo "[promote] Next: run 'check --checkpoint skill-review' on candidates"
fi
