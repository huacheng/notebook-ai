#!/usr/bin/env bash
# Publish task-ai development files to plugins/task-ai/ (the plugin marketplace directory)
# Usage: .dev/publish.sh [--dry-run]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$TASK_AI_ROOT" && git rev-parse --show-toplevel)"
PLUGIN_DIR="$REPO_ROOT/plugins/task-ai"
DRY_RUN=0

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# Run L1 validation first (excluding publish-sync itself to avoid chicken-and-egg)
echo "--- Running L1 validation (pre-publish) ---"
PRE_FAIL=0
for script in step-numbering.sh sub-step-numbering.sh script-reachability.sh deleted-files.sh cross-refs.sh signal-whitelist.sh naming-conventions.sh frontmatter-validation.sh git-commit-conventions.sh; do
  [[ ! -f "$SCRIPT_DIR/contracts/$script" ]] && continue
  if ! bash "$SCRIPT_DIR/contracts/$script" > /dev/null 2>&1; then
    echo "FAIL: $script"
    PRE_FAIL=1
  fi
done
if [[ $PRE_FAIL -eq 1 ]]; then
  echo "ERROR: L1 validation failed. Fix issues before publishing."
  exit 1
fi
echo "L1 pre-publish validation passed."

echo "--- Publishing to $PLUGIN_DIR ---"

# Publishable directories and files
SYNC_DIRS=(skills commands core)
SYNC_FILES=(REFERENCE-INDEX.md plugin.json)

for dir in "${SYNC_DIRS[@]}"; do
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] rsync -av --delete $TASK_AI_ROOT/$dir/ $PLUGIN_DIR/$dir/"
  else
    rsync -avc --delete \
      --exclude='.dev' \
      --exclude='docs' \
      --exclude='__pycache__' \
      "$TASK_AI_ROOT/$dir/" "$PLUGIN_DIR/$dir/"
  fi
done

for f in "${SYNC_FILES[@]}"; do
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] cp $TASK_AI_ROOT/$f $PLUGIN_DIR/$f"
  else
    cp "$TASK_AI_ROOT/$f" "$PLUGIN_DIR/$f"
  fi
done

echo "--- Publish complete ---"
if [[ $DRY_RUN -eq 0 ]]; then
  # Verify sync
  bash "$SCRIPT_DIR/contracts/publish-sync.sh"
fi
