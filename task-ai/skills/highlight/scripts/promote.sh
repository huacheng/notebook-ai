#!/usr/bin/env bash
# highlight scope=promote — Experience to Skill Promotion
# Usage: promote.sh [--dry-run] [--target <experience-file>]
# Triggers: quality_status=verified, usage_count>=3, structural patterns

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/../../../core"

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
mkdir -p "$CANDIDATES_DIR"

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
    mkdir -p "$candidate_dir"

    extract_skill_content "$exp_file" "$slug" > "$candidate_dir/SKILL.md"
    generate_trust_report "$exp_file" "$slug" "$usage_count" > "$candidate_dir/trust-report.md"

    echo "[promote]   Created: $candidate_dir/SKILL.md"
    echo "[promote]   Created: $candidate_dir/trust-report.md"

    # Append to changelog
    if [[ -f "$CHANGELOG" ]]; then
        echo "$(date -Iseconds) | skill-candidate | .skills/.candidates/$slug | source:promote | from:$(basename "$exp_file")" >> "$CHANGELOG"
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
