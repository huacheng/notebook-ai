#!/usr/bin/env bash
# Library Status Script
# Usage: status.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_PY="${AUDIT_PY:-$SCRIPT_DIR/audit-library.py}"
LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"

export NB_WORKSPACES_LIBRARY="$LIB_PATH"

if [[ ! -d "$LIB_PATH" ]]; then
    echo "[ERROR] Library not found."
    exit 1
fi

# 1. Run Python Deep Audit
if [[ -f "$AUDIT_PY" ]]; then
    python3 "$AUDIT_PY"
else
    echo "[ERROR] audit-library.py missing."
    exit 1
fi

# 2. Check Git Repository Status
echo -e "
--- Repository Status ---"
cd "$LIB_PATH" || { echo "[ERROR] Cannot access library at $LIB_PATH" >&2; exit 1; }
if [[ -d ".git" ]]; then
    git status -s
    echo -e "
Last 3 commits:"
    git log -n 3 --oneline
else
    echo "[WARN] Library is not a Git repository."
fi

# 3. Check for Active Locks
echo -e "
--- Active Locks ---"
find "$LIB_PATH" -maxdepth 4 -name ".lock" 2>/dev/null
