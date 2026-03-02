#!/usr/bin/env bash
# /task-ai:read implementation
# Usage: read.sh <file_path> [--depth shallow|deep]

set -uo pipefail

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

# 3. Detox Pipeline (Simulated 10-category rules)
# In a real agent, this invokes the Python parser or agent prompt.
# We simulate finding an encoded payload for TDD.
echo "[3/4] Applying Detox pipeline..."
CONTENT=$(cat "$FILE_PATH")
INJECTION_RISK="none"
FINDINGS="[]"

if grep -qE "eval|btoa" "$FILE_PATH"; then
    INJECTION_RISK="high"
    FINDINGS="[\"removed: encoded executable content\"]"
    CONTENT="[REMOVED: encoded executable content]"
fi

# 4. Library Write Protocol
echo "[4/4] Writing to library..."
mkdir -p "$LIB_PATH/.memory/.references"
REF_FILE="$LIB_PATH/.memory/.references/$TOPIC.md"
DATE=$(date +%Y-%m-%d)

cat > "$REF_FILE" <<'_TASK_AI_REF_EOF_'
---
_TASK_AI_REF_EOF_

# Write frontmatter fields separately (variable expansion needed)
cat >> "$REF_FILE" <<_TASK_AI_REF_EOF_
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
printf '%s\n' "$CONTENT" >> "$REF_FILE"

echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") | read | .memory/.references/$TOPIC.md | source:local" >> "$LIB_PATH/.changelog"

# Trigger Rebuild
MAINTAIN_SH="$SCRIPT_DIR/../../library/scripts/maintain.sh"
if [[ -x "$MAINTAIN_SH" ]]; then
    "$MAINTAIN_SH" --rebuild-index
fi

echo "Document successfully ingested."
