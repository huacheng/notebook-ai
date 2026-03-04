# Skill 生命周期管理设计

> 日期: 2026-03-04
> 状态: 设计中

## 一、核心问题

1. **构造决策**: 何时需要（重新）构造 skill？
2. **升级机制**: T1→T2→T3→T4 的自动化路径
3. **降级机制**: 问题发现后的快速响应
4. **版本管理**: 变更追踪与回滚能力

---

## 二、Skill 元数据扩展

### 2.1 SKILL.md Frontmatter 扩展

```yaml
---
# 基础信息
name: my-skill
description: A skill for doing X
version: 1.2.0                    # 语义化版本

# 生命周期状态
lifecycle:
  trust_tier: T3                  # 当前信任等级
  promoted_at: 2026-03-01         # 晋升到当前 tier 的时间
  last_reviewed_at: 2026-03-01    # 最近审查时间
  review_ttl_days: 90             # 审查有效期
  usage_count: 47                 # 调用次数
  error_count: 2                  # 错误次数
  error_rate: 0.042               # 错误率

# 来源追踪
provenance:
  source_type: experience         # experience | manual | imported
  source_ref: .memory/.experiences/2026-02/task-123.md
  source_hash: sha256:abc123...   # 源文件哈希，用于检测变更

# 依赖声明
dependencies:
  tools: [Bash, Read, Write]      # 依赖的工具
  apis: []                        # 依赖的外部 API
  skills: []                      # 依赖的其他 skills

# 审查记录
audit_trail:
  - date: 2026-03-01
    action: promote
    from_tier: T2
    to_tier: T3
    reviewer: auto
    composite_score: 0.82
  - date: 2026-02-15
    action: create
    from_tier: null
    to_tier: T1
    reviewer: highlight
---
```

### 2.2 skill-registry.json（集中管理）

```json
{
  "skills": {
    "my-skill": {
      "current_version": "1.2.0",
      "trust_tier": "T3",
      "location": "skills/my-skill/SKILL.md",
      "last_reviewed": "2026-03-01",
      "next_review_due": "2026-05-30",
      "flags": []
    }
  },
  "deprecated": {
    "old-skill": {
      "reason": "Replaced by new-skill",
      "deprecated_at": "2026-02-01",
      "removal_scheduled": "2026-05-01"
    }
  }
}
```

---

## 三、构造决策逻辑

### 3.1 检测是否需要重新构造

```bash
# library skill-check <skill-name>
# 返回: CURRENT | OUTDATED | NEEDS_REVIEW | DEPRECATED

check_skill_freshness() {
    local skill_name="$1"
    local skill_md="$SKILLS_DIR/$skill_name/SKILL.md"

    # 1. 检查源文件是否变更
    local current_hash=$(get_source_hash "$skill_md")
    local source_ref=$(get_frontmatter "$skill_md" "provenance.source_ref")
    local source_hash=$(get_frontmatter "$skill_md" "provenance.source_hash")

    if [[ -f "$source_ref" ]]; then
        local actual_source_hash=$(sha256sum "$source_ref" | cut -d' ' -f1)
        if [[ "$source_hash" != "$actual_source_hash" ]]; then
            echo "OUTDATED:source_changed"
            return
        fi
    fi

    # 2. 检查审查是否过期
    local last_reviewed=$(get_frontmatter "$skill_md" "lifecycle.last_reviewed_at")
    local ttl_days=$(get_frontmatter "$skill_md" "lifecycle.review_ttl_days")
    local days_since=$(days_since "$last_reviewed")

    if [[ $days_since -gt $ttl_days ]]; then
        echo "NEEDS_REVIEW:ttl_expired"
        return
    fi

    # 3. 检查错误率
    local error_rate=$(get_frontmatter "$skill_md" "lifecycle.error_rate")
    if (( $(echo "$error_rate > 0.10" | bc -l) )); then
        echo "NEEDS_REVIEW:high_error_rate"
        return
    fi

    # 4. 检查依赖
    # TODO: 实现依赖变更检测

    echo "CURRENT"
}
```

### 3.2 触发重新构造的流程

```
源 experience 变更
       │
       ▼
┌─────────────────┐
│ library skill-  │
│ check my-skill  │
└────────┬────────┘
         │ OUTDATED
         ▼
┌─────────────────┐
│ highlight       │
│ scope=promote   │
│ --force         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 新版本进入      │
│ .candidates/    │
│ 版本号 +1       │
└────────┬────────┘
         │
         ▼
    正常审查流程
```

---

## 四、升级机制

### 4.1 自动升级（T1→T2→T3）

```bash
# library promote-skill <skill-name> [--auto]
promote_skill() {
    local skill_name="$1"
    local auto_mode="${2:-false}"

    local current_tier=$(get_trust_tier "$skill_name")

    case "$current_tier" in
        T1)
            # T1→T2: 通过 L1 静态分析
            if run_l1_scan "$skill_name"; then
                update_tier "$skill_name" "T2"
                log_audit "$skill_name" "promote" "T1" "T2" "auto"
            fi
            ;;
        T2)
            # T2→T3: 通过 L2 六维审查 (>=0.70)
            local score=$(run_l2_review "$skill_name")
            if (( $(echo "$score >= 0.70" | bc -l) )); then
                update_tier "$skill_name" "T3"
                log_audit "$skill_name" "promote" "T2" "T3" "auto"
            fi
            ;;
        T3)
            # T3→T4: 需要人工审核
            if [[ "$auto_mode" == "true" ]]; then
                echo "[WARN] T3→T4 requires human review"
                return 1
            fi
            # 人工审核流程
            request_human_review "$skill_name"
            ;;
    esac
}
```

### 4.2 批量升级检查

```bash
# library promote-all --dry-run
# 检查所有 skill，输出可升级列表

promote_all() {
    local dry_run="${1:-false}"

    for skill_dir in "$SKILLS_DIR"/*/; do
        local skill_name=$(basename "$skill_dir")
        local current_tier=$(get_trust_tier "$skill_name")
        local eligible=$(check_promotion_eligible "$skill_name")

        if [[ "$eligible" == "true" ]]; then
            if [[ "$dry_run" == "true" ]]; then
                echo "[DRY-RUN] $skill_name: $current_tier → $(next_tier $current_tier)"
            else
                promote_skill "$skill_name"
            fi
        fi
    done
}
```

---

## 五、降级机制

### 5.1 自动降级触发

```bash
# 在 skill 执行后调用
record_skill_execution() {
    local skill_name="$1"
    local success="$2"  # true | false

    # 更新统计
    increment_usage_count "$skill_name"
    if [[ "$success" == "false" ]]; then
        increment_error_count "$skill_name"
    fi

    # 计算错误率
    local usage=$(get_usage_count "$skill_name")
    local errors=$(get_error_count "$skill_name")
    local error_rate=$(echo "scale=3; $errors / $usage" | bc)
    update_error_rate "$skill_name" "$error_rate"

    # 检查是否触发降级
    if (( $(echo "$error_rate > 0.10" | bc -l) )); then
        auto_demote "$skill_name" "high_error_rate"
    fi
}
```

### 5.2 手动降级

```bash
# library demote-skill <skill-name> --reason <reason>
demote_skill() {
    local skill_name="$1"
    local reason="$2"

    local current_tier=$(get_trust_tier "$skill_name")
    local new_tier=$(prev_tier "$current_tier")

    # 降级
    update_tier "$skill_name" "$new_tier"
    log_audit "$skill_name" "demote" "$current_tier" "$new_tier" "manual" "$reason"

    # 如果是安全问题，立即禁用
    if [[ "$reason" == "security_vulnerability" ]]; then
        disable_skill "$skill_name"
        notify_admins "$skill_name" "SECURITY: Skill disabled due to vulnerability"
    fi
}
```

### 5.3 降级矩阵

| 当前 Tier | 触发条件 | 目标 Tier | 动作 |
|----------|---------|----------|------|
| T4 | 安全漏洞 | T1 + 禁用 | 立即禁用，等待修复 |
| T4 | 错误率 >10% | T3 | 移回 .drafts/，待修复 |
| T4 | 依赖废弃 | T2 | 标记需更新 |
| T4 | 180天未使用 | T3 | 标记冷存档 |
| T3 | 审查过期 | T2 | 需要重新审查 |
| T2 | L1 扫描失败 | T1 | 需要修复后重新提交 |

---

## 六、版本管理

### 6.1 语义化版本规则

```
MAJOR.MINOR.PATCH

MAJOR: 破坏性变更（步骤流程大改、依赖更换）
MINOR: 功能增强（新增步骤、优化说明）
PATCH: 小修复（typo、格式调整）
```

### 6.2 版本历史追踪

```
$SKILLS_DIR/my-skill/
├── SKILL.md              # 当前版本
├── .versions/
│   ├── 1.0.0.md          # 历史版本归档
│   ├── 1.1.0.md
│   └── 1.2.0.md
└── CHANGELOG.md          # 变更日志
```

### 6.3 回滚命令

```bash
# library rollback-skill <skill-name> <version>
rollback_skill() {
    local skill_name="$1"
    local target_version="$2"

    local archive="$SKILLS_DIR/$skill_name/.versions/$target_version.md"
    if [[ ! -f "$archive" ]]; then
        echo "[ERROR] Version $target_version not found"
        return 1
    fi

    # 备份当前版本
    local current_version=$(get_version "$skill_name")
    cp "$SKILLS_DIR/$skill_name/SKILL.md" \
       "$SKILLS_DIR/$skill_name/.versions/$current_version.md"

    # 回滚
    cp "$archive" "$SKILLS_DIR/$skill_name/SKILL.md"

    # 记录
    log_audit "$skill_name" "rollback" "$current_version" "$target_version" "manual"

    # 降级到 T2，需要重新审查
    demote_skill "$skill_name" "rollback"
}
```

---

## 七、library 命令扩展

### 7.1 新增命令清单

```bash
# 查询
library skill-list [--tier T1|T2|T3|T4] [--outdated] [--needs-review]
library skill-check <name>              # 检查是否需要更新
library skill-history <name>            # 查看版本历史

# 生命周期管理
library promote-skill <name> [--auto]   # 升级
library demote-skill <name> --reason    # 降级
library rollback-skill <name> <version> # 回滚
library archive-skill <name>            # 归档（冷存储）

# 批量操作
library promote-all --dry-run           # 检查可升级的 skill
library review-due                      # 列出需要审查的 skill
library cleanup-orphans                 # 清理无源的 skill
```

### 7.2 与现有命令集成

```
highlight scope=promote
    │
    ▼ 自动创建版本号
library promote-skill
    │
    ▼ 更新 trust_tier
check --checkpoint skill-review
    │
    ▼ 记录 audit_trail
library skill-list --tier T3
```

---

## 八、实施路线

| 阶段 | 内容 | 依赖 |
|------|------|------|
| Phase 5a | Frontmatter 扩展设计 | 无 |
| Phase 5b | skill-registry.json 实现 | 5a |
| Phase 5c | skill-check 命令 | 5b |
| Phase 5d | promote/demote 命令 | 5c |
| Phase 5e | 版本管理 + 回滚 | 5d |
| Phase 5f | 批量操作 + 定时任务 | 5e |

---

## 九、与 highlight 的集成

### 9.1 experience 变更检测

```bash
# highlight 写入新 experience 时，检查是否有依赖的 skill
on_experience_updated() {
    local experience_path="$1"

    # 查找依赖此 experience 的 skill
    for skill_dir in "$SKILLS_DIR"/*/; do
        local source_ref=$(get_frontmatter "$skill_dir/SKILL.md" "provenance.source_ref")
        if [[ "$source_ref" == "$experience_path" ]]; then
            local skill_name=$(basename "$skill_dir")
            mark_skill_outdated "$skill_name"
            echo "[LIFECYCLE] Skill '$skill_name' marked outdated (source changed)"
        fi
    done
}
```

### 9.2 重新构造流程

```
experience 更新
       │
       ▼
on_experience_updated()
       │
       ▼ 标记 OUTDATED
skill-registry.json 更新
       │
       ▼ 用户主动或定时触发
highlight scope=promote --source <experience>
       │
       ▼ 生成新版本
.candidates/<skill>-v2.0.0/
       │
       ▼ 审查流程
promote-skill → T2 → T3 → T4
```

---

## 十、决策树总结

```
                    ┌─────────────────┐
                    │ Skill 存在吗？   │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │ 否                          │ 是
              ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │ highlight       │           │ skill-check     │
    │ scope=promote   │           │ <skill-name>    │
    │ (首次构造)      │           │                 │
    └─────────────────┘           └────────┬────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │ CURRENT              │ OUTDATED             │ NEEDS_REVIEW
                    ▼                      ▼                      ▼
              ┌──────────┐          ┌──────────────┐       ┌──────────────┐
              │ 无需操作  │          │ highlight    │       │ check        │
              │          │          │ --force      │       │ skill-review │
              └──────────┘          │ (重新构造)   │       │ (重新审查)   │
                                    └──────────────┘       └──────────────┘
```
