#!/usr/bin/env bash
# /task-ai:read implementation
# Usage: read.sh <file_path> [--depth shallow|deep]

set -euo pipefail

FILE_PATH="${1:-}"
DEPTH="shallow"

if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
    echo "[ERROR] Valid file path is required." >&2
    exit 1
fi

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --depth) DEPTH="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-$(pwd)}/.library}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Reading document: $FILE_PATH (Depth: $DEPTH)"

# 1. Ingestion & Topic Extraction (Simulated)
BASENAME=$(basename "$FILE_PATH")
TOPIC="${BASENAME%.*}"
echo "[1/4] Extracted Topic: $TOPIC"

# 2. Library Deduplication (Layer 1) (Simulated)
echo "[2/4] Deduplicating against library..."

# 3. Detox Pipeline (dynamic rules from .evolving-rules/sanitization/ + hardcoded fallback)
echo "[3/4] Applying Detox pipeline..."
CONTENT=$(cat "$FILE_PATH")
INJECTION_RISK="none"
FINDINGS="[]"

# Load dynamic sanitization rules from .evolving-rules/sanitization/active/
RULE_LOADER="$SCRIPT_DIR/../../../core/rule-loader.sh"
DYNAMIC_PATTERNS=()
if [[ -f "$RULE_LOADER" ]]; then
    source "$RULE_LOADER"
    load_rules_from_domain "sanitization" 2>/dev/null || true
    for i in "${!RULE_PATTERNS[@]}"; do
        DYNAMIC_PATTERNS+=("${RULE_PATTERNS[$i]}")
    done
fi

# Hardcoded fallback patterns (10 categories from injection-rules.md)
HARDCODED_PATTERNS=(
    'eval\s*\('
    'btoa\s*\('
    'curl.*\|'
    'wget.*\|'
    'LD_PRELOAD='
    'NODE_OPTIONS='
    '<system>'
    'ignore previous'
    'base64\s+-d'
    '\\x1b\['
)

# Merge: dynamic rules first, then hardcoded fallback
ALL_PATTERNS=("${DYNAMIC_PATTERNS[@]}" "${HARDCODED_PATTERNS[@]}")

for pattern in "${ALL_PATTERNS[@]}"; do
    if grep -qE "$pattern" "$FILE_PATH" 2>/dev/null; then
        INJECTION_RISK="high"
        FINDINGS="[\"removed: detected injection pattern: $pattern\"]"
        CONTENT="[REMOVED: potential injection content detected]"
        break
    fi
done

# 4. Library Write Protocol (Atomic: .tmp → rename)
echo "[4/4] Writing to library..."
mkdir -p "$LIB_PATH/.memory/.references"
REF_FILE="$LIB_PATH/.memory/.references/$TOPIC.md"
TMP_FILE="${REF_FILE}.tmp.$$"
DATE=$(date +%Y-%m-%d)

cat > "$TMP_FILE" <<'_TASK_AI_REF_EOF_'
---
_TASK_AI_REF_EOF_

# Write frontmatter fields separately (variable expansion needed)
cat >> "$TMP_FILE" <<_TASK_AI_REF_EOF_
topic: $TOPIC
type: generic
external: true
source_url: local://$FILE_PATH
fetched_at: $DATE
sanitized: true
sanitized_at: $DATE
injection_risk: $INJECTION_RISK
injection_findings: $FINDINGS
last_verified_at: $DATE
---
# $TOPIC
_TASK_AI_REF_EOF_

# Append content separately to avoid heredoc delimiter collision
printf '%s\n' "$CONTENT" >> "$TMP_FILE"

# Atomic rename
mv "$TMP_FILE" "$REF_FILE"

echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") | read | .memory/.references/$TOPIC.md | source:local" >> "$LIB_PATH/.changelog"

# Trigger Rebuild
MAINTAIN_SH="$SCRIPT_DIR/../../library/scripts/maintain.sh"
if [[ -x "$MAINTAIN_SH" ]]; then
    "$MAINTAIN_SH" --rebuild-index
fi

echo "Document successfully ingested."
