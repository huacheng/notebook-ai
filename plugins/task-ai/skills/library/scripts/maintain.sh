#!/usr/bin/env bash
# Library Maintain Script
# Usage: maintain.sh [--rebuild-index] [--rebuild-relations] [--compact]

set -uo pipefail

# 动态获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 允许通过环境变量覆盖脚本路径
REBUILD_INDEX_PY="${REBUILD_INDEX_PY:-$SCRIPT_DIR/rebuild-index.py}"
REBUILD_RELATIONS_PY="${REBUILD_RELATIONS_PY:-$SCRIPT_DIR/rebuild-relations.py}"

LIB_PATH="${NB_WORKSPACES_LIBRARY:-${NB_WORKSPACES_ROOT:-.}/.library}"
export NB_WORKSPACES_LIBRARY="$LIB_PATH"

while [[ $# -gt 0 ]]; do
  START_TIME=$(date +%s%3N)
  CMD="$1"
  case "$1" in
    --rebuild-index)
      python3 "$REBUILD_INDEX_PY"
      shift ;;
    --rebuild-relations)
      python3 "$REBUILD_RELATIONS_PY"
      shift ;;
    --compact)
      CHANGELOG="$LIB_PATH/.changelog"
      if [[ -f "$CHANGELOG" ]] && [[ $(wc -l < "$CHANGELOG") -gt 2000 ]]; then
          ARCHIVE_DIR="$LIB_PATH/.changelog-archive"
          mkdir -p "$ARCHIVE_DIR"
          DATE_STR=$(date +%Y-%m)
          mv "$CHANGELOG" "$ARCHIVE_DIR/$DATE_STR.md"
          touch "$CHANGELOG"
          echo "Changelog compacted to $ARCHIVE_DIR/$DATE_STR.md"
      fi
      shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  END_TIME=$(date +%s%3N)
  ELAPSED=$((END_TIME - START_TIME))
  echo "[PERF] $CMD took ${ELAPSED}ms"
done

# Git 提交逻辑：同步图书馆中所有受控文件
cd "$LIB_PATH" || { echo "[ERROR] Cannot access library at $LIB_PATH" >&2; exit 1; }

# 使用 git add . 配合完善的 .gitignore 是最稳健的策略
# 确保所有 .md 和索引文件都被跟踪
git add . 

if ! git diff --cached --quiet; then
    git commit -m "task-ai(library):maintain sync files and indices"
    echo "Library files and indices synced and committed."
fi
