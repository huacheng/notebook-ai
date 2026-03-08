#!/usr/bin/env bash
# task-ai 插件发布脚本
# 用法: ./publish.sh [version]
# 示例: ./publish.sh 0.9.9
#       ./publish.sh        # 自动 patch 版本 +1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NOTEBOOK_AI_ROOT="$(cd "$TASK_AI_ROOT/.." && pwd)"
PLUGINS_DIR="$NOTEBOOK_AI_ROOT/plugins/task-ai"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[publish]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1" >&2; exit 1; }

# 1. 确定版本号
CURRENT_VERSION=$(grep '"version"' "$TASK_AI_ROOT/plugin.json" | sed 's/.*"version": "\([^"]*\)".*/\1/')
log "当前版本: $CURRENT_VERSION"

if [[ -n "${1:-}" ]]; then
    NEW_VERSION="$1"
else
    # 自动 patch +1
    IFS='.' read -ra PARTS <<< "$CURRENT_VERSION"
    PATCH=$((PARTS[2] + 1))
    NEW_VERSION="${PARTS[0]}.${PARTS[1]}.$PATCH"
fi
log "新版本: $NEW_VERSION"

# 2. 更新开发目录版本（plugin.json + marketplace.json 保持一致）
log "更新 task-ai/plugin.json..."
sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" "$TASK_AI_ROOT/plugin.json"

log "更新 task-ai/marketplace.json..."
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$TASK_AI_ROOT/marketplace.json"

# 3. 同步到 plugins/task-ai/
log "同步到 plugins/task-ai/..."
rsync -av --delete \
    --exclude='.dev/' \
    --exclude='tests/' \
    --exclude='scripts/publish.sh' \
    --exclude='__pycache__/' \
    "$TASK_AI_ROOT/" "$PLUGINS_DIR/" > /dev/null

# 4. Clone moonview 并更新
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

log "克隆 moonview 仓库..."
git clone --depth 1 https://github.com/huacheng/moonview.git "$TEMP_DIR" 2>&1 | grep -v "^Cloning"

# 5. 同步插件文件
log "同步插件文件到 moonview..."
rsync -av --delete \
    --exclude='__pycache__/' \
    "$PLUGINS_DIR/" "$TEMP_DIR/plugins/task-ai/" > /dev/null

# 6. 更新两个 marketplace.json (关键!)
log "更新 marketplace.json (根级)..."
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$TEMP_DIR/marketplace.json"

log "更新 .claude-plugin/marketplace.json (Claude 读取)..."
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$TEMP_DIR/.claude-plugin/marketplace.json"

log "更新 .claude-plugin/plugin.json (市场包版本)..."
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$TEMP_DIR/.claude-plugin/plugin.json"

# 7. 验证版本一致性
log "验证版本一致性..."
V1=$(grep '"version"' "$TEMP_DIR/plugins/task-ai/plugin.json" | grep -o '"[0-9.]*"' | tr -d '"')
V2=$(grep '"version"' "$TEMP_DIR/marketplace.json" | head -1 | grep -o '"[0-9.]*"' | tr -d '"')
V3=$(grep '"version"' "$TEMP_DIR/.claude-plugin/marketplace.json" | head -1 | grep -o '"[0-9.]*"' | tr -d '"')
V4=$(grep '"version"' "$TEMP_DIR/.claude-plugin/plugin.json" | grep -o '"[0-9.]*"' | tr -d '"')

if [[ "$V1" != "$NEW_VERSION" ]] || [[ "$V2" != "$NEW_VERSION" ]] || [[ "$V3" != "$NEW_VERSION" ]] || [[ "$V4" != "$NEW_VERSION" ]]; then
    error "版本不一致! plugin.json=$V1, marketplace.json=$V2, .claude-plugin/marketplace.json=$V3, .claude-plugin/plugin.json=$V4"
fi
log "✅ 所有版本文件一致: $NEW_VERSION"

# 8. 提交并推送
cd "$TEMP_DIR"
git add -A
git commit -m "chore: release task-ai v$NEW_VERSION

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

log "推送到远程..."
git push origin master

log "✅ 发布完成: v$NEW_VERSION"

# 9. 提示刷新 Claude 缓存
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}发布成功! 请执行以下命令刷新 Claude 缓存:${NC}"
echo ""
echo "  claude /plugin update task-ai@moonview"
echo ""
echo "或重启 Claude Code 后自动检测更新"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
