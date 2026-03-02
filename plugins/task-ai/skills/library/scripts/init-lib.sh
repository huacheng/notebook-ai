#!/usr/bin/env bash
# Library Initialization Script
# Implements: Library Repository Protocol

set -euo pipefail

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"

echo "Checking Library at: $LIB_PATH"

if [[ ! -d "$LIB_PATH" ]]; then
    echo "Creating library directory..."
    mkdir -p "$LIB_PATH"
fi

cd "$LIB_PATH" || { echo "[ERROR] Cannot access library at $LIB_PATH" >&2; exit 1; }

if [[ ! -d ".git" ]]; then
    echo "Initializing Git repository for Library..."
    git init
    
    # Create Skeleton
    touch .changelog
    cat > .master-index.md <<EOF
# Library Master Index

| Topic | Type | Keywords | File Path | Source |
|-------|------|----------|-----------|--------|
EOF
    
    cat > .type-registry.md <<EOF
# Task Type Registry

| Type | Added | Source Task |
|------|-------|-------------|
| software | 2024-01-01 | seed |
| documentation | 2024-01-01 | seed |
EOF

    # Setup gitignore
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
EOF

    git add .
    git commit -m "task-ai(library):init initialize library repository skeleton"
    echo "Library initialized successfully."
else
    echo "Library repository already exists."
fi
