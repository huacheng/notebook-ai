#!/usr/bin/env bash
# Library Initialization Script
# Implements: Library Repository Protocol
# Idempotent: creates missing structure, skips existing

set -euo pipefail

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"

echo "Checking Library at: $LIB_PATH"

if [[ ! -d "$LIB_PATH" ]]; then
    echo "Creating library directory..."
    mkdir -p "$LIB_PATH"
fi

cd "$LIB_PATH" || { echo "[ERROR] Cannot access library at $LIB_PATH" >&2; exit 1; }

# Track if any changes were made
CHANGES=0

# --- Ensure directory structure (idempotent) ---
ensure_dir() {
    local dir="$1"
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        echo "[+] Created: $dir"
        CHANGES=1
    fi
}

ensure_file() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        touch "$file"
        echo "[+] Created: $file"
        CHANGES=1
    fi
}

# Core directories
ensure_dir .changelog-archive
ensure_dir .core-rule-proposals

# Memory subsystem (highlight protocol)
# - .experiences/: impl, verify, complete, adhoc scopes write here
# - .thinking/raw/: thinking-raw scope writes here
# - .thinking/patterns/: complete scope extracts patterns here
# - .type-profiles/: complete scope syncs type profiles here
# - .references/: research/read write here (not highlight)
ensure_dir .memory/.experiences
ensure_dir .memory/.thinking/raw
ensure_dir .memory/.thinking/patterns
ensure_dir .memory/.type-profiles
ensure_dir .memory/.references

# Three-domain evolving rules structure (D5 Architecture)
# - security: security.sh scan_skill() uses
# - sanitization: research content detoxification uses
# - audit: check six-dimension review uses
for domain in security sanitization audit; do
    ensure_dir ".evolving-rules/$domain/candidates"
    ensure_dir ".evolving-rules/$domain/active"
    ensure_dir ".evolving-rules/$domain/review"
    ensure_dir ".evolving-rules/$domain/deprecated"
done

# .gitkeep for empty directories
ensure_file .changelog-archive/.gitkeep
ensure_file .core-rule-proposals/.gitkeep

# Memory subsystem .gitkeep
ensure_file .memory/.experiences/.gitkeep
ensure_file .memory/.thinking/raw/.gitkeep
ensure_file .memory/.thinking/patterns/.gitkeep
ensure_file .memory/.type-profiles/.gitkeep
ensure_file .memory/.references/.gitkeep

for domain in security sanitization audit; do
    ensure_file ".evolving-rules/$domain/candidates/.gitkeep"
    ensure_file ".evolving-rules/$domain/active/.gitkeep"
    ensure_file ".evolving-rules/$domain/review/.gitkeep"
    ensure_file ".evolving-rules/$domain/deprecated/.gitkeep"
done

# Copy intel sources template if not exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTEL_TEMPLATE="$SCRIPT_DIR/../templates/audit-intel-sources.yaml"
if [[ -f "$INTEL_TEMPLATE" && ! -f ".audit-intel-sources.yaml" ]]; then
    cp "$INTEL_TEMPLATE" ".audit-intel-sources.yaml"
    echo "[+] Created: .audit-intel-sources.yaml (from template)"
    CHANGES=1
fi

# --- Ensure skeleton files ---
if [[ ! -f .changelog ]]; then
    touch .changelog
    echo "[+] Created: .changelog"
    CHANGES=1
fi

if [[ ! -f .master-index.md ]]; then
    cat > .master-index.md <<EOF
# Library Master Index

| Topic | Type | Keywords | File Path | Source |
|-------|------|----------|-----------|--------|
EOF
    echo "[+] Created: .master-index.md"
    CHANGES=1
fi

if [[ ! -f .type-registry.md ]]; then
    cat > .type-registry.md <<EOF
# Task Type Registry

| Type | Added | Source Task |
|------|-------|-------------|
| software | 2024-01-01 | seed |
| documentation | 2024-01-01 | seed |
EOF
    echo "[+] Created: .type-registry.md"
    CHANGES=1
fi

if [[ ! -f .gitignore ]]; then
    cat > .gitignore <<EOF
.changelog
.changelog-archive/.lock
.memory/.thinking/raw/
.memory/.thinking/patterns/.lock
.inconsistency.log
.ioc.md
**/.library-state.json
**/.lock
**/.lock.stale.*
**/.last-scan*
EOF
    echo "[+] Created: .gitignore"
    CHANGES=1
fi

# --- Git initialization ---
if [[ ! -d ".git" ]]; then
    echo "Initializing Git repository..."
    git init
    git add .
    git commit -m "task-ai(library):init initialize library repository skeleton"
    echo "Library initialized with Git."
elif [[ $CHANGES -gt 0 ]]; then
    echo "Committing structure updates..."
    git add .
    if ! git diff --cached --quiet; then
        git commit -m "task-ai(library):init补缺 add missing structure"
    fi
    echo "Library structure updated."
else
    echo "Library structure complete. No changes needed."
fi
