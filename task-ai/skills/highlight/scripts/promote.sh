#!/usr/bin/env bash
# highlight scope=promote — Experience to Skill Promotion
# Usage: promote.sh [--dry-run] [--target <experience-file>]
# Triggers: quality_status=verified, usage_count>=3, structural patterns

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/../../../core"

# Load core library and ensure library exists (C pattern)
source "$CORE_DIR/lib.sh"
ensure_library

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
EXPERIENCES_DIR="$LIB_PATH/.memory/.experiences"
SKILLS_DIR="$LIB_PATH/.skills"
CANDIDATES_DIR="$SKILLS_DIR/.candidates"
CHANGELOG="$LIB_PATH/.changelog"

# Thresholds
MIN_USAGE_COUNT=3

# Arguments
DRY_RUN=false
TARGET_FILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=true; shift ;;
        --target)  TARGET_FILE="$2"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

echo "[promote] Scanning for promotable experiences..."

# Ensure directories exist
# D3: mkdir with error handling
if ! mkdir -p "$CANDIDATES_DIR" 2>&1; then
    echo "[ERROR] Failed to create candidates directory" >&2
    exit 1
fi

#######################################
# Parse frontmatter field from markdown file
#######################################
parse_frontmatter() {
    local file="$1"
    local field="$2"

    # Extract YAML frontmatter between --- markers
    sed -n '/^---$/,/^---$/p' "$file" 2>/dev/null | \
        grep -E "^${field}:" | \
        sed "s/^${field}:[[:space:]]*//" | \
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

    # Count references in changelog (library search hits, etc.)
    local count
    count=$(grep -c "$relative_path" "$CHANGELOG" 2>/dev/null || echo 0)
    echo "$count"
}

#######################################
# Check if experience has structural patterns
#######################################
has_structural_patterns() {
    local file="$1"

    # Check for "## Patterns" or "## Steps" headers
    if grep -qE '^## (Patterns|Steps|Key Decisions|What Worked)' "$file" 2>/dev/null; then
        return 0
    fi
    return 1
}

#######################################
# Generate slug from experience file
#######################################
generate_slug() {
    local file="$1"
    local basename
    basename=$(basename "$file" .md)

    # Remove common suffixes
    basename="${basename%-complete}"
    basename="${basename%-impl}"
    basename="${basename%-verify}"
    basename="${basename%-adhoc}"

    # Convert to kebab-case
    echo "$basename" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | tr ' ' '-'
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

    # Extract key sections
    local patterns=""
    local steps=""
    local context=""

    # Extract ## Patterns section
    if grep -q "^## Patterns" "$exp_file"; then
        patterns=$(sed -n '/^## Patterns/,/^## /p' "$exp_file" | head -n -1 | tail -n +2)
    fi

    # Extract ## What Worked as steps
    if grep -q "^## What Worked" "$exp_file"; then
        steps=$(sed -n '/^## What Worked/,/^## /p' "$exp_file" | head -n -1 | tail -n +2)
    fi

    # Extract ## Context
    if grep -q "^## Context" "$exp_file"; then
        context=$(sed -n '/^## Context/,/^## /p' "$exp_file" | head -n -1 | tail -n +2)
    fi

    # Generate SKILL.md content
    cat <<EOF
---
name: $skill_name
description: "Auto-generated skill from verified experience. ${context:0:100}"
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

$steps

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
  1. Run \`check --checkpoint skill-review --target SKILL.md\` for six-dimension audit
  2. If score >= 0.70 → T2 (move to .drafts/)
  3. Human review → T3 (move to active skills/)
  4. Production validation → T4 (fully verified)

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
    if grep -qE '\$\(|`[^`]+`|eval\s|exec\s' "$exp_file" 2>/dev/null; then
        SECURITY_SCORE=$(echo "$SECURITY_SCORE - 0.3" | bc)
        SECURITY_ISSUES="${SECURITY_ISSUES}command-substitution;"
    fi
    if grep -qiE 'curl.*\||wget.*\||bash\s+-c|sh\s+-c' "$exp_file" 2>/dev/null; then
        SECURITY_SCORE=$(echo "$SECURITY_SCORE - 0.4" | bc)
        SECURITY_ISSUES="${SECURITY_ISSUES}remote-exec;"
    fi
    if grep -qiE 'rm\s+-rf|chmod\s+777|sudo\s' "$exp_file" 2>/dev/null; then
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
    # D3: mkdir with error handling
    if ! mkdir -p "$candidate_dir" 2>&1; then
        echo "[promote]   ERROR: Failed to create candidate directory" >&2
        return 1
    fi

    # D3: file writes with error handling
    if ! extract_skill_content "$exp_file" "$slug" > "$candidate_dir/SKILL.md" 2>&1; then
        echo "[promote]   ERROR: Failed to write SKILL.md" >&2
        return 1
    fi
    if ! generate_trust_report "$exp_file" "$slug" "$usage_count" > "$candidate_dir/trust-report.md" 2>&1; then
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

    # Append to changelog
    # D3: changelog append with error handling
    if [[ -f "$CHANGELOG" ]]; then
        if ! echo "$(date -Iseconds) | skill-candidate | .skills/.candidates/$slug | source:promote | from:$(basename "$exp_file")" >> "$CHANGELOG" 2>&1; then
            echo "[promote]   WARN: Failed to append to changelog" >&2
        fi
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
        done < <(find "$EXPERIENCES_DIR" -name "*.md" -type f ! -name ".index.md" ! -name ".summary.md" -print0 2>/dev/null)
    fi
fi

echo ""
echo "[promote] Complete: scanned=$SCANNED_COUNT, promoted=$PROMOTED_COUNT"

if [[ "$PROMOTED_COUNT" -gt 0 ]] && ! $DRY_RUN; then
    echo "[promote] Next: run 'check --checkpoint skill-review' on candidates"
fi
