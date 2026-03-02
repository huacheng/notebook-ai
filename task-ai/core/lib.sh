#!/usr/bin/env bash
# task-ai production runtime library
# Provides context discovery and workdir resolution for skill scripts.
# shellcheck disable=SC2034

TASK_AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- Context Discovery ---

# Identifies the current notebook based on CWD or Git branch.
# Sets NB_NOTEBOOK and NB_WORKING. Returns 0 if found, 1 otherwise.
find_nb_context() {
  local cur="$PWD"
  while [[ "$cur" != "/" && "$cur" != "." ]]; do
    if [[ -d "$cur/.working" && -f "$cur/.working/.index.json" ]]; then
      export NB_WORKING="$cur/.working"
      export NB_NOTEBOOK=$(basename "$cur")
      return 0
    fi
    cur=$(dirname "$cur")
  done

  local branch
  branch=$(git branch --show-current 2>/dev/null)
  if [[ "$branch" =~ ^task/ ]]; then
    export NB_NOTEBOOK="${branch#task/}"
    local root="${NB_WORKSPACES_ROOT:-$(pwd)}"
    local nb_dir
    nb_dir=$(find "$root" -maxdepth 3 -name "$NB_NOTEBOOK" -type d -print -quit 2>/dev/null)
    if [[ -n "$nb_dir" ]]; then
      export NB_WORKING="$nb_dir/.working"
      return 0
    fi
  fi

  return 1
}

# --- Notebook Workdir Resolution ---

# Resolves NOTEBOOK and WORK_DIR from argument or context.
# Usage: resolve_workdir "$1"
# Sets: NB_NOTEBOOK, WORK_DIR (exported)
# Exits on failure.
resolve_workdir() {
  local notebook="${1:-}"
  if [[ -z "$notebook" ]]; then
    if ! find_nb_context; then
      echo "[ERROR] No active task context detected. Enter a notebook directory or specify a name." >&2
      exit 1
    fi
    notebook="$NB_NOTEBOOK"
    export WORK_DIR="$NB_WORKING"
  else
    if [[ ! "$notebook" =~ ^[a-zA-Z0-9_-]+$ ]]; then
      echo "[ERROR] Invalid notebook name." >&2
      exit 1
    fi
    local nb_root="${NB_WORKSPACES_ROOT:-$(pwd)}"
    local nb_dir
    nb_dir=$(find "$nb_root" -maxdepth 3 -name "$notebook" -type d -print -quit 2>/dev/null)
    if [[ -z "$nb_dir" ]]; then
      echo "[ERROR] Notebook directory '$notebook' not found under $nb_root" >&2
      exit 1
    fi
    export WORK_DIR="$nb_dir/.working"
  fi
  export NB_NOTEBOOK="$notebook"
}
