#!/usr/bin/env bash
# Library Status Script
# Usage: status.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_PY="${AUDIT_PY:-$SCRIPT_DIR/audit-library.py}"
LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"

export NB_WORKSPACES_LIBRARY="$LIB_PATH"

if [[ ! -d "$LIB_PATH" ]]; then
    echo "[ERROR] Library not found at $LIB_PATH" >&2
    exit 1
fi

# 1. Run Python Deep Audit
if [[ -f "$AUDIT_PY" ]]; then
    python3 "$AUDIT_PY"
else
    echo "[ERROR] audit-library.py not found at $AUDIT_PY" >&2
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
LOCK_COUNT=0
while IFS= read -r lockfile; do
    [[ -z "$lockfile" ]] && continue
    ((LOCK_COUNT++)) || true
    # D3: Show lock holder info and whether PID is still alive
    lock_info=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(f'pid={d.get(\"pid\",\"?\")} session={d.get(\"session\",\"?\")} ts={d.get(\"timestamp\",\"?\")}')" "$lockfile" 2>/dev/null || echo "unreadable")
    # D3: Use sed instead of grep -P for macOS compatibility
    lock_pid=$(echo "$lock_info" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
    if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
        echo "  [ACTIVE] $lockfile ($lock_info)"
    else
        echo "  [STALE]  $lockfile ($lock_info)"
    fi
done < <(find "$LIB_PATH" -maxdepth 4 -name ".lock" 2>/dev/null)
if [[ $LOCK_COUNT -eq 0 ]]; then
    echo "  (none)"
fi
