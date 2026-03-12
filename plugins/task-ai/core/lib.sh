#!/usr/bin/env bash
# task-ai production runtime library
# Provides context discovery and workdir resolution for skill scripts.
# shellcheck disable=SC2034

set -euo pipefail

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- Environment Variable Normalization ---
# Default NB_WORKSPACES_ROOT to current directory if not set
if [[ -z "${NB_WORKSPACES_ROOT:-}" ]]; then
    export NB_WORKSPACES_ROOT="$(pwd)"
fi

# Library directory: $NB_WORKSPACES_ROOT/.library
export NB_WORKSPACES_LIBRARY="${NB_WORKSPACES_LIBRARY:-$NB_WORKSPACES_ROOT/.library}"

# --- Library Initialization ---

# Ensures library directory structure exists (idempotent).
# Calls init-lib.sh if library is missing or incomplete.
ensure_library() {
  local lib_path="${NB_WORKSPACES_LIBRARY:-$NB_WORKSPACES_ROOT/.library}"
  local init_script="$TASK_AI_ROOT/skills/library/scripts/init-lib.sh"

  # Quick check: if core structure exists, skip
  if [[ -d "$lib_path/.memory/.experiences" && -f "$lib_path/.master-index.md" ]]; then
    return 0
  fi

  # Run init-lib.sh (idempotent)
  # D3: init-lib.sh call with error handling
  if [[ -f "$init_script" ]]; then
    if ! bash "$init_script" 2>&1; then
      echo "[WARN] init-lib.sh failed, library may be incomplete" >&2
    fi
  else
    echo "[WARN] init-lib.sh not found at $init_script" >&2
  fi
}

# --- Context Discovery ---

# Resolves notebook context from CWD, git branch, or explicit name.
# Sets (exported):
#   NB_NOTEBOOK  - notebook name (without task- prefix)
#   NB_WORK_DIR  - notebook root: <project>/.worktrees/task-<notebook>/
#   TASKAI_WORK_DIR     - task-ai system files: $NB_WORK_DIR/.working/
# Usage:
#   resolve_nb_workdir           # auto-detect from CWD or branch
#   resolve_nb_workdir "name"    # explicit notebook name
# Exits on failure.
resolve_nb_workdir() {
  local notebook="${1:-}"
  local nb_dir=""

  if [[ -z "$notebook" ]]; then
    # Auto-detect from CWD
    local cur="$PWD"
    while [[ "$cur" != "/" && "$cur" != "." ]]; do
      if [[ -d "$cur/.working" && -f "$cur/.working/.status.json" ]]; then
        nb_dir="$cur"
        local dir_name="$(basename "$cur")"
        notebook="${dir_name#task-}"
        break
      fi
      cur="$(dirname "$cur")"
    done

    # Fallback: detect from git branch
    if [[ -z "$nb_dir" ]]; then
      local branch
      branch=$(git branch --show-current 2>/dev/null || true)
      if [[ -n "$branch" && "$branch" =~ ^task/ ]]; then
        notebook="${branch#task/}"
        if [[ "$notebook" =~ ^[a-zA-Z0-9_-]+$ ]]; then
          nb_dir=$(find "$NB_WORKSPACES_ROOT" -maxdepth 4 -path "*/.worktrees/task-$notebook" -type d -print -quit 2>/dev/null || true)
        fi
      fi
    fi

    if [[ -z "$nb_dir" ]]; then
      echo "[ERROR] No active task context detected. Enter a notebook directory or specify a name." >&2
      exit 1
    fi
  else
    if [[ ! "$notebook" =~ ^[a-zA-Z0-9_-]+$ ]]; then
      echo "[ERROR] Invalid notebook name." >&2
      exit 1
    fi
    local nb_root="${NB_WORKSPACES_ROOT:-$(pwd)}"
    nb_dir=$(find "$nb_root" -maxdepth 4 -path "*/.worktrees/task-$notebook" -type d -print -quit 2>/dev/null)
    if [[ -z "$nb_dir" ]]; then
      echo "[ERROR] Notebook directory '$notebook' not found under $nb_root" >&2
      exit 1
    fi
  fi

  export NB_NOTEBOOK="$notebook"
  export NB_WORK_DIR="$nb_dir"
  export TASKAI_WORK_DIR="$nb_dir/.working"
}
