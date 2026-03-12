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

# Skills promotion pipeline (highlight promote scope)
# - .candidates/: T1 — promote.sh writes candidate skill files here
# - .drafts/: T2 — L2 skill-review >= 0.70, pending L3 deep review
# - .active/: T3/T4 — L3 skill-deep-review >= 0.85 (T3), production-validated (T4)
ensure_dir .skills/.candidates
ensure_dir .skills/.drafts
ensure_dir .skills/.active

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

# Test corpus for precision calculation (labeled samples)
# - positive/: samples that SHOULD match the rule (true positives)
# - negative/: samples that should NOT match (true negatives)
for domain in security sanitization audit; do
    ensure_dir ".test-corpus/$domain/positive"
    ensure_dir ".test-corpus/$domain/negative"
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

# Skills subsystem .gitkeep
ensure_file .skills/.candidates/.gitkeep
ensure_file .skills/.drafts/.gitkeep
ensure_file .skills/.active/.gitkeep

for domain in security sanitization audit; do
    ensure_file ".evolving-rules/$domain/candidates/.gitkeep"
    ensure_file ".evolving-rules/$domain/active/.gitkeep"
    ensure_file ".evolving-rules/$domain/review/.gitkeep"
    ensure_file ".evolving-rules/$domain/deprecated/.gitkeep"
done

# Test corpus .gitkeep
for domain in security sanitization audit; do
    ensure_file ".test-corpus/$domain/positive/.gitkeep"
    ensure_file ".test-corpus/$domain/negative/.gitkeep"
done

# Copy intel sources template if not exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTEL_TEMPLATE="$SCRIPT_DIR/../templates/audit-intel-sources.yaml"
if [[ -f "$INTEL_TEMPLATE" && ! -f ".audit-intel-sources.yaml" ]]; then
    # D3: cp with error handling
    if ! cp "$INTEL_TEMPLATE" ".audit-intel-sources.yaml" 2>/dev/null; then
        echo "[WARN] Failed to copy intel template" >&2
    else
        echo "[+] Created: .audit-intel-sources.yaml (from template)"
        CHANGES=1
    fi
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
    # D1: seed all types from seed-types/.summary.md
    SEED_DATE=$(date -u +"%Y-%m-%d")
    cat > .type-registry.md <<EOF
# Task Type Registry

| Type | Added | Source Task |
|------|-------|-------------|
| software | $SEED_DATE | seed |
| science | $SEED_DATE | seed |
| documentation | $SEED_DATE | seed |
| data-pipeline | $SEED_DATE | seed |
| infrastructure | $SEED_DATE | seed |
| ml | $SEED_DATE | seed |
| ai-skill | $SEED_DATE | seed |
| image-processing | $SEED_DATE | seed |
| video-production | $SEED_DATE | seed |
| dsp | $SEED_DATE | seed |
| literary | $SEED_DATE | seed |
| screenwriting | $SEED_DATE | seed |
| mechatronics | $SEED_DATE | seed |
| chip-design | $SEED_DATE | seed |
EOF
    echo "[+] Created: .type-registry.md"
    CHANGES=1
fi

if [[ ! -f .gitignore ]]; then
    cat > .gitignore <<EOF
.changelog
.changelog.lock
.changelog-archive/.lock
.memory/.thinking/raw/
.memory/.thinking/patterns/.lock
.inconsistency.log
.ioc.md
.plugin-registry.md
.last-maintained
.last-compact
.last-scheduled
.scheduled.log
**/.library-state.json
**/.lock
**/.lock.stale.*
**/.last-scan*
EOF
    echo "[+] Created: .gitignore"
    CHANGES=1
fi

# --- Git initialization ---
# D3: git commands with error handling
if [[ ! -d ".git" ]]; then
    echo "Initializing Git repository..."
    if ! git init; then
        echo "[WARN] git init failed" >&2
    elif ! git add .; then
        echo "[WARN] git add failed" >&2
    elif ! git commit -m "task-ai(library):init initialize library repository skeleton"; then
        echo "[WARN] git commit failed" >&2
    else
        echo "Library initialized with Git."
    fi
elif [[ $CHANGES -gt 0 ]]; then
    echo "Committing structure updates..."
    if ! git add .; then
        echo "[WARN] git add failed during structure update" >&2
    elif ! git diff --cached --quiet; then
        git commit -m "task-ai(library):init add missing structure" || echo "[WARN] git commit failed" >&2
    fi
    echo "Library structure updated."
else
    echo "Library structure complete. No changes needed."
fi
