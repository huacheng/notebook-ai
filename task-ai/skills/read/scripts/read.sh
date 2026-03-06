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
        --depth) DEPTH="${2:-}"; shift 2 2>/dev/null || shift ;;
        *) echo "[ERROR] Unknown option: $1" >&2; exit 1 ;;
    esac
done

# D2: Validate DEPTH value
if [[ "$DEPTH" != "shallow" && "$DEPTH" != "deep" ]]; then
    echo "[WARN] Invalid DEPTH '$DEPTH', defaulting to 'shallow'" >&2
    DEPTH="shallow"
fi

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-$(pwd)}/.library}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Reading document: $FILE_PATH (Depth: $DEPTH)"

# 1. Ingestion & Topic Extraction
BASENAME=$(basename "$FILE_PATH")
TOPIC="${BASENAME%.*}"
# D2: Sanitize TOPIC for safe YAML embedding and path safety
# Strip control chars, quotes, colons; also strip / and .. to prevent path traversal
TOPIC=$(printf '%s' "$TOPIC" | tr -d '\0-\37\177/' | sed 's/\.\./_/g; s/[:"'"'"'`#]/_/g' | head -c 120)
# D3: Guard against empty topic after sanitization
if [[ -z "$TOPIC" ]]; then
    TOPIC="unnamed-$(date +%s)"
fi
echo "[1/7] Extracted Topic: $TOPIC"

# 2. Library Deduplication (Layer 1)
echo "[2/7] Deduplicating against library..."

# D1: Handle depth=deep by logging delegation intent (actual delegation not yet implemented)
if [[ "$DEPTH" == "deep" ]]; then
    echo "[2/7] Depth=deep: will delegate gap research to 'research --caller exec --scope gap' after dedup"
fi

# 5. Detox Pipeline (dynamic rules from .evolving-rules/sanitization/ + hardcoded fallback)
echo "[3/7] Applying Detox pipeline..."
# D4: Defer loading content into bash variable until after size check to limit memory usage
CONTENT=""
INJECTION_RISK="none"
FINDINGS=""

# Load dynamic sanitization rules from .evolving-rules/sanitization/active/
RULE_LOADER="$SCRIPT_DIR/../../../core/rule-loader.sh"
DYNAMIC_PATTERNS=()
if [[ -f "$RULE_LOADER" ]]; then
    source "$RULE_LOADER"
    load_rules_from_domain "sanitization" 2>/dev/null || true
    if [[ -n "${RULE_PATTERNS+x}" ]]; then
        for i in "${!RULE_PATTERNS[@]}"; do
            DYNAMIC_PATTERNS+=("${RULE_PATTERNS[$i]}")
        done
    fi
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
ALL_PATTERNS=()
[[ ${#DYNAMIC_PATTERNS[@]} -gt 0 ]] && ALL_PATTERNS+=("${DYNAMIC_PATTERNS[@]}")
ALL_PATTERNS+=("${HARDCODED_PATTERNS[@]}")

for pattern in "${ALL_PATTERNS[@]}"; do
    if grep -qE -- "$pattern" "$FILE_PATH" 2>/dev/null; then
        INJECTION_RISK="high"
        # D2: Sanitize pattern for safe YAML embedding
        SAFE_PATTERN=$(printf '%s' "$pattern" | sed 's/["\\]/\\&/g')
        FINDINGS="removed: detected injection pattern: $SAFE_PATTERN"
        CONTENT="[REMOVED: potential injection content detected]"
        break
    fi
done

# D4: Enforce 50KB size limit per injection-rules.md Category 5
# D1: Skip truncation if content was already replaced by detox (injection found)
if [[ "$INJECTION_RISK" == "none" ]]; then
    # D3: Trim whitespace from wc output for reliable numeric comparison
    FILE_SIZE=$(wc -c < "$FILE_PATH" 2>/dev/null | tr -d ' ')
    FILE_SIZE="${FILE_SIZE:-0}"
    if [[ "$FILE_SIZE" -gt 51200 ]]; then
        CONTENT=$(head -c 51200 "$FILE_PATH" 2>/dev/null || echo "")
        CONTENT="${CONTENT}
[TRUNCATED: content exceeded 50KB limit]"
        echo "[WARN] File exceeds 50KB, truncated" >&2
    else
        # D3: Read content with error handling (deferred from detox step for efficiency)
        CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")
    fi
fi

# D1: Compute content hashes (required by injection-rules.md frontmatter schema)
# content_hash_original = hash of raw file content before any sanitization
# D3: Handle sha256sum failure gracefully (e.g., file deleted between check and hash)
HASH_ORIGINAL=$(sha256sum "$FILE_PATH" 2>/dev/null | cut -d' ' -f1)
if [[ -z "$HASH_ORIGINAL" ]]; then
    echo "[ERROR] Failed to compute hash for $FILE_PATH" >&2
    exit 1
fi

# 6. Library Write Protocol (six-step per skills/library/references/write-protocol.md)

# Step 1: mkdir -p (idempotent)
echo "[4/7] Writing to library..."
REF_DIR="$LIB_PATH/.memory/.references"
if ! mkdir -p "$REF_DIR" 2>/dev/null; then
    echo "[ERROR] Failed to create library directory" >&2
    exit 1
fi

# Step 2: Acquire directory-level .lock (O_CREAT|O_EXCL)
LOCK_FILE="$REF_DIR/.lock"
LOCK_PID=$$
# D2: Sanitize session ID for safe JSON embedding in lock file
LOCK_SESSION=$(printf '%s' "${NB_SESSION_ID:-read-$$}" | tr -d '"\\' | head -c 64)
LOCK_ACQUIRED=0

acquire_lock() {
    local lock="$1"
    local max_retries=5
    local retry=0
    while [[ $retry -lt $max_retries ]]; do
        # O_CREAT|O_EXCL via bash noclobber
        if ( set -C; echo "{\"pid\":$LOCK_PID,\"session\":\"$LOCK_SESSION\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$lock" ) 2>/dev/null; then
            return 0
        fi
        # Lock exists -- check for stale lock
        if [[ -f "$lock" ]]; then
            local held_pid
            held_pid=$(grep -oP '"pid":\s*\K[0-9]+' "$lock" 2>/dev/null || echo "")
            if [[ -n "$held_pid" ]] && ! kill -0 "$held_pid" 2>/dev/null; then
                # Stale lock: rename-based recovery (TOCTOU safe)
                if mv "$lock" "${lock}.stale.${held_pid}" 2>/dev/null; then
                    rm -f "${lock}.stale.${held_pid}" 2>/dev/null
                    continue  # retry acquisition
                fi
            fi
        fi
        retry=$((retry + 1))
        sleep 0.2
    done
    return 1
}

release_lock() {
    rm -f "$1" 2>/dev/null
}

if ! acquire_lock "$LOCK_FILE"; then
    echo "[ERROR] Failed to acquire .references/.lock after retries" >&2
    exit 1
fi
LOCK_ACQUIRED=1

# Step 3: Write file (.tmp → rename, POSIX atomic)
REF_FILE="$REF_DIR/$TOPIC.md"

# D3: Set trap immediately after lock acquisition to guarantee cleanup on any exit
CHANGELOG_LOCK_ACQUIRED=0
cleanup() {
    [[ "$LOCK_ACQUIRED" -eq 1 ]] && release_lock "$LOCK_FILE"
    [[ "$CHANGELOG_LOCK_ACQUIRED" -eq 1 ]] && release_lock "${CHANGELOG_LOCK:-}"
    rm -f "${REF_DIR}/${TOPIC}.md.tmp.$$" 2>/dev/null
}
trap cleanup EXIT
TMP_FILE="${REF_FILE}.tmp.$$"
DATE=$(date +%Y-%m-%d)

# Determine version (increment if file exists)
VERSION=1
if [[ -f "$REF_FILE" ]]; then
    PREV_VERSION=$(grep -oP '^version:\s*\K[0-9]+' "$REF_FILE" 2>/dev/null || echo "0")
    VERSION=$((PREV_VERSION + 1))
fi

{
cat <<_TASK_AI_REF_EOF_
---
topic: "$TOPIC"
type: generic
external: true
source_url: "local://$(printf '%s' "$FILE_PATH" | sed 's/["\\]/\\&/g')"
fetched_at: $DATE
sanitized: true
sanitized_at: $DATE
injection_risk: $INJECTION_RISK
_TASK_AI_REF_EOF_

# D6: Write injection_findings as proper YAML list (empty array if none)
if [[ -n "$FINDINGS" ]]; then
    echo "injection_findings:"
    echo "  - \"$FINDINGS\""
else
    echo "injection_findings: []"
fi

cat <<_TASK_AI_REF_EOF_
content_hash_original: sha256:$HASH_ORIGINAL
staleness_threshold_days: 90
last_verified_at: $DATE
status: active
version: $VERSION
effectiveness_mark: false
failure_count: 0
---
# $TOPIC
_TASK_AI_REF_EOF_
} > "$TMP_FILE"

# Append content separately to avoid heredoc delimiter collision
printf '%s\n' "$CONTENT" >> "$TMP_FILE"

# Compute sanitized hash (body content after second '---' delimiter)
HASH_SANITIZED=$(awk '/^---$/{n++; next} n>=2' "$TMP_FILE" | sha256sum | cut -d' ' -f1)
# Insert content_hash_sanitized after content_hash_original
sed -i "s|^content_hash_original: sha256:$HASH_ORIGINAL|content_hash_original: sha256:$HASH_ORIGINAL\ncontent_hash_sanitized: sha256:$HASH_SANITIZED|" "$TMP_FILE"

# Atomic rename
if ! mv "$TMP_FILE" "$REF_FILE" 2>/dev/null; then
    echo "[ERROR] Failed to write reference file" >&2
    exit 1
fi

# Step 4: Acquire .changelog.lock, append, release
echo "[5/7] Updating changelog and index..."
CHANGELOG_LOCK="$LIB_PATH/.changelog.lock"
if acquire_lock "$CHANGELOG_LOCK"; then
    CHANGELOG_LOCK_ACQUIRED=1
    # D3: Use || fallback to handle append failure without aborting (lock is released below)
    printf '%s | reference | .memory/.references/%s.md | topic:%s,source:local\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TOPIC" "$TOPIC" >> "$LIB_PATH/.changelog" 2>/dev/null \
        || echo "[WARN] Failed to append to changelog" >&2
    release_lock "$CHANGELOG_LOCK" || true
    CHANGELOG_LOCK_ACQUIRED=0
else
    echo "[WARN] Failed to acquire .changelog.lock, skipping changelog" >&2
fi

# Step 5: Update .index.md (while still holding directory .lock)
INDEX_FILE="$REF_DIR/.index.md"
INDEX_ROW="| $TOPIC | v$VERSION | — | local | $DATE | no | $INJECTION_RISK |"
if [[ -f "$INDEX_FILE" ]]; then
    # Check if topic already has a row; update in-place or append
    # D2: Escape TOPIC for safe use in grep/sed regex (dots, brackets, etc.)
    TOPIC_ESCAPED=$(printf '%s' "$TOPIC" | sed 's/[][.\\*^$()+?{}|]/\\&/g')
    if grep -q "^| $TOPIC_ESCAPED |" "$INDEX_FILE" 2>/dev/null; then
        # D3: Use '#' as sed delimiter to avoid conflict with '|' in markdown tables
        sed -i "s#^| $TOPIC_ESCAPED |.*#$INDEX_ROW#" "$INDEX_FILE" 2>/dev/null \
            || echo "[WARN] Failed to update .index.md row" >&2
    else
        echo "$INDEX_ROW" >> "$INDEX_FILE"
    fi
else
    # Create .index.md with header
    cat > "$INDEX_FILE" <<'_INDEX_EOF_'
| topic | versions | marked_version | source_domain | last_verified | stale | injection_risk |
|-------|---------|----------------|---------------|---------------|-------|----------------|
_INDEX_EOF_
    echo "$INDEX_ROW" >> "$INDEX_FILE"
fi

# Step 6: Release directory-level .lock
echo "[6/7] Releasing lock..."
release_lock "$LOCK_FILE"
LOCK_ACQUIRED=0

# 7. Trigger Rebuild
echo "[7/7] Triggering index rebuild..."
MAINTAIN_SH="$SCRIPT_DIR/../../library/scripts/maintain.sh"
if [[ -x "$MAINTAIN_SH" ]]; then
    if ! "$MAINTAIN_SH" --rebuild-index; then
        echo "[WARN] maintain.sh --rebuild-index failed" >&2
    fi
fi

echo "Document successfully ingested."
