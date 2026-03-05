#!/usr/bin/env bash
# 修复 Claude 插件缓存
# 用法: ./fix-cache.sh

set -euo pipefail

CACHE_DIR="$HOME/.claude/plugins/cache/moonview/task-ai"
INSTALLED_JSON="$HOME/.claude/plugins/installed_plugins.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[fix-cache]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }

# 1. 找到最新版本
if [[ ! -d "$CACHE_DIR" ]]; then
    echo "无缓存目录，无需修复"
    exit 0
fi

LATEST=$(ls -1 "$CACHE_DIR" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
log "最新缓存版本: $LATEST"

# 2. 清除所有 .orphaned_at 标记，只保留最新版本
for v in "$CACHE_DIR"/*/; do
    ver=$(basename "$v")
    if [[ "$ver" == "$LATEST" ]]; then
        # 确保最新版本没有 orphaned 标记
        if [[ -f "${v}.orphaned_at" ]]; then
            rm -f "${v}.orphaned_at"
            log "移除 $ver 的 .orphaned_at 标记"
        fi
    else
        # 其他版本添加 orphaned 标记
        if [[ ! -f "${v}.orphaned_at" ]]; then
            date +%s > "${v}.orphaned_at"
            log "标记 $ver 为 orphaned"
        fi
    fi
done

# 3. 更新 installed_plugins.json
if [[ -f "$INSTALLED_JSON" ]]; then
    log "更新 installed_plugins.json..."
    # 使用 Python 更新 JSON
    python3 << EOF
import json

with open("$INSTALLED_JSON", "r") as f:
    data = json.load(f)

key = "task-ai@moonview"
if key in data:
    for entry in data[key]:
        entry["version"] = "$LATEST"
        entry["installPath"] = "$CACHE_DIR/$LATEST"

    with open("$INSTALLED_JSON", "w") as f:
        json.dump(data, f, indent=2)
    print(f"[fix-cache] 更新 installed_plugins.json 到 $LATEST")
EOF
fi

log "✅ 缓存修复完成"
log "请重启 Claude Code 以加载正确版本"
