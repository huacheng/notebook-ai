#!/usr/bin/env bash
# task-ai contract testing shared library
# shellcheck disable=SC2034

TASK_AI_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEV_ROOT="$TASK_AI_ROOT/.dev"
FIXTURES="$DEV_ROOT/fixtures"
PASS=0; FAIL=0; WARN=0

# --- Output helpers ---

emit_pass() { echo "[PASS] $1"; ((PASS++)); }
emit_fail() { echo "[FAIL] $1"; ((FAIL++)); }
emit_warn() { echo "[WARN] $1"; ((WARN++)); }

emit_json() {
  local test="$1" status="$2" detail="$3"
  # Escape double quotes in detail
  detail="${detail//\"/\\\"}"
  echo "{\"test\":\"$test\",\"status\":\"$status\",\"detail\":\"$detail\"}"
}

# --- File reading helpers ---

safe_read() {
  while IFS= read -r line; do
    echo "$line"
  done < "$1"
}

# Strip markdown fenced code blocks, preserving line alignment (empty lines where code was)
strip_code_blocks() {
  local in_fence=0
  while IFS= read -r line; do
    if [[ "$line" =~ ^\`\`\` ]]; then
      in_fence=$((1 - in_fence))
      echo ""
    elif [[ $in_fence -eq 0 ]]; then
      echo "$line"
    else
      echo ""
    fi
  done
}

# Extract content under ## Execution Steps (stops at next ##, excluding ###)
extract_steps() {
  local file="$1" in_section=0
  strip_code_blocks < "$file" | while IFS= read -r line; do
    if [[ "$line" =~ ^##[[:space:]]+Execution[[:space:]]+Steps ]]; then
      in_section=1; continue
    fi
    if [[ "$in_section" -eq 1 && "$line" =~ ^##[[:space:]] && ! "$line" =~ ^### ]]; then
      break
    fi
    [[ "$in_section" -eq 1 ]] && echo "$line"
  done
}

# Extract YAML frontmatter (between --- delimiters)
extract_frontmatter() {
  local file="$1" in_fm=0 started=0
  while IFS= read -r line; do
    if [[ "$line" == "---" ]]; then
      if [[ $started -eq 0 ]]; then
        started=1; in_fm=1; continue
      elif [[ $in_fm -eq 1 ]]; then
        break
      fi
    fi
    [[ $in_fm -eq 1 ]] && echo "$line"
  done < "$file"
}

# Extract a markdown section by heading (level-aware, stops at same or higher level)
extract_section() {
  local file="$1" heading="$2" in_section=0
  local level
  level=$(echo "$heading" | grep -o '^#*' | wc -c)
  ((level--))
  while IFS= read -r line; do
    if [[ "$line" =~ ^${heading}[[:space:]]*$ ]]; then
      in_section=1; continue
    fi
    if [[ $in_section -eq 1 ]]; then
      # Check for heading at same or higher level
      local line_hashes
      line_hashes=$(echo "$line" | grep -o '^#*' | wc -c)
      ((line_hashes--))
      if [[ $line_hashes -ge 1 && $line_hashes -le $level ]]; then
        break
      fi
      echo "$line"
    fi
  done < "$file"
}

# --- File discovery helpers ---

find_skills() {
  find "$TASK_AI_ROOT/skills" -name "SKILL.md" -type f | sort
}

find_references() {
  find "$TASK_AI_ROOT/commands/references" -name "*.md" -type f 2>/dev/null | sort
}

find_all_md() {
  find "$TASK_AI_ROOT" -name "*.md" -type f \
    -not -path "*/.dev/*" \
    -not -path "*/node_modules/*" \
    -not -path "*/.git/*" | sort
}

find_skill_references() {
  find "$TASK_AI_ROOT/skills" -path "*/references/*.md" -type f | sort
}

# --- Context Discovery ---

# Identifies the current notebook based on CWD or Git branch.
# Sets NB_NOTEBOOK and NB_WORKING. Returns 0 if found, 1 otherwise.
find_nb_context() {
  # 1. Path-based discovery: look for .working/ in current or parent directories
  local cur="$PWD"
  while [[ "$cur" != "/" && "$cur" != "." ]]; do
    if [[ -d "$cur/.working" && -f "$cur/.working/.status.json" ]]; then
      export NB_WORKING="$cur/.working"
      export NB_NOTEBOOK=$(basename "$cur")
      return 0
    fi
    cur=$(dirname "$cur")
  done

  # 2. Branch-based discovery: check if current branch matches task/<name>
  local branch
  branch=$(git branch --show-current 2>/dev/null)
  if [[ "$branch" =~ ^task/ ]]; then
    export NB_NOTEBOOK="${branch#task/}"
    # In branch mode, we might not be in the notebook directory.
    # We try to find the directory via its unique name under NB_WORKSPACES_ROOT.
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
    nb_dir=$(find "$nb_root" -name "$notebook" -type d | head -n 1)
    if [[ -z "$nb_dir" ]]; then
      echo "[ERROR] Notebook directory '$notebook' not found under $nb_root" >&2
      exit 1
    fi
    export WORK_DIR="$nb_dir/.working"
  fi
  export NB_NOTEBOOK="$notebook"
}

# --- Summary ---

summary() {
  echo "---"
  echo "Summary: $PASS passed, $FAIL failed, $WARN warnings"
  local exit_code=$FAIL
  [[ $exit_code -gt 255 ]] && exit_code=255
  return $exit_code
}
