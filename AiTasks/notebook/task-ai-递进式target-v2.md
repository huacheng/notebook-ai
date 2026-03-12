# 递进式 target v2 设计方案

> task-ai 渐进进化模型升级：convergence 方向门禁 + 自动回滚 + 异步需求缓冲 + .auto-signal 废弃
> 日期：2026-03-08
> 版本：v2
> 前置依赖：v1（已实现）、progressive-target.md、deferred merge（已实现）
> 基于：`task-ai-递进式target-v1.md` + 本次讨论

---

## 1. v2 scope

### 1.1 四项设计变更

| # | 变更 | 核心理念 |
|---|------|----------|
| 1 | **Convergence Score** | 用单一分数量化交付物与目标的接近程度 |
| 2 | **方向门禁 + 自动回滚** | 凡是不能让目标更近的阶段都回滚，无"正常/异常"之分 |
| 3 | **Pending Refinement Buffer** | auto 执行中异步捕获需求调整，不打断当前步骤 |
| 4 | **`.auto-signal` 废弃** | auto 和 daemon 统一读 `.status.json`，移除 signal 文件 |

### 1.2 不包含

- 前端 UI 变更（Esc 中断、进度面板等）
- `.auto-stop` 文件管理
- daemon 后端实现（未来 daemon 直接读 `.status.json`）

---

## 2. Convergence Score — 目标接近度

### 2.1 设计理念

D1-D6 衡量"做得好不好"（质量），convergence 衡量"方向对不对"（进度）。两个正交维度，缺一不可。

### 2.2 公式

```
convergence = Σ(wᵢ × cᵢ) / Σ(wᵢ)
```

### 2.3 三层计算

#### 第 1 层：需求原子化（target 职责）

从 `.target.md` Overall Objective + Requirements 提取原子需求项，每项可独立判定完成度。

**权重 wᵢ：**

| 级别 | 权重 | 判定依据 |
|------|------|----------|
| critical | 3 | 缺了就不算完成（核心功能） |
| important | 2 | 主要功能，但可降级 |
| optional | 1 | 锦上添花 |

**上限**：baseline 控制在 30 条 R# 以内。超过时合并粒度，将细粒度需求归组为粗粒度。

#### 第 2 层：逐项覆盖度评估（check 职责）

每项需求对照全量已有交付物评 cᵢ：

| 分值 | 含义 | 判定标准 |
|------|------|----------|
| 1.00 | 完全满足 | 功能实现 + 测试通过 + 无已知缺陷 |
| 0.75 | 基本满足 | 功能实现，有小瑕疵不影响使用 |
| 0.50 | 部分满足 | 核心路径可用，边界/异常未覆盖 |
| 0.25 | 初步涉及 | 有框架/桩代码，未真正实现 |
| 0.00 | 未覆盖 | 交付物中无任何相关内容 |

#### 第 3 层：加权计算

```
示例：
R1: w=3, c=1.00 → 3.00
R2: w=2, c=0.75 → 1.50
R3: w=2, c=0.00 → 0.00
R4: w=3, c=0.50 → 1.50
R5: w=1, c=1.00 → 1.00

convergence = (3.00+1.50+0.00+1.50+1.00) / (3+2+2+3+1) = 7.00/11 = 0.636
```

### 2.4 存储

**stage.history 条目**：
```json
{
  "stage": 2,
  "name": "OAuth集成",
  "completed_at": "2026-03-08T...",
  "commit": "abc1234",
  "convergence": 0.65
}
```

**评估明细**：`.analysis/<date>-convergence.md`，含逐项评分表。

### 2.5 评分锚定

评 convergence 时，读 `.analysis/` 中最近的 `*-convergence.md` 作为锚点：
- 对每个 R#，比较本次 cᵢ 与上次 cᵢ
- 确保评分有理有据，不因 LLM 上下文差异导致无理由波动

### 2.6 `.convergence-baseline.md` 格式

```markdown
# Convergence Baseline

Generated from: .target.md Overall Objective + Requirements
Updated: 2026-03-08T10:00:00Z

| # | Requirement | Weight | Source |
|---|------------|--------|--------|
| R1 | JWT 认证登录 | 3 | Objective |
| R2 | Refresh token 刷新 | 2 | Requirements §1 |
| R3 | OAuth Google 登录 | 2 | Requirements §2 |
| R4 | RBAC 权限控制 | 3 | Requirements §3 |
| R5 | 登录失败限流 | 1 | Constraints §1 |
```

---

## 3. 方向门禁 + 自动回滚

### 3.1 核心原则

**凡是不能向目标逼近的推进都要回滚。** 没有"正常推进"与"异常推进"之分——每个阶段都必须证明自己让目标更近了，否则就丢弃。

### 3.2 check post-exec 双门禁流程

```
check post-exec:
  D1-D6 < threshold → NEEDS_FIX（质量不够，修到通过）
  D1-D6 ≥ threshold → 评 convergence:
    ├─ convergence > 上次 → ACCEPT（保留，→ evolving）
    │    记录 commit hash + convergence 到 stage.history
    │
    └─ convergence ≤ 上次 → ROLLBACK（丢弃，→ evolving at 上阶段终点）
         1. 记录失败经验到 .analysis/ + highlight 归档
         2. git reset --hard <上一阶段 commit>
         3. 裁剪 stage.history
         4. status → evolving
         5. 输出失败原因 + convergence 变化
```

### 3.3 两道门禁对比

| 门禁 | 问题 | 通过 | 不通过 |
|------|------|------|--------|
| **D1-D6** | 做得好不好？ | 继续评方向 | NEEDS_FIX，修到通过 |
| **convergence** | 方向对不对？ | ACCEPT，保留 | ROLLBACK，丢弃，重来 |

### 3.4 失败经验闭环

```
rollback 时:
  1. highlight 记录失败经验:
     → .library/.memory/.experiences/<type>/<notebook>-stage-N-failed.md
     内容：方向、原因、convergence 变化（如 0.65 → 0.58）
  2. 回滚到上阶段 commit
  3. status → evolving
  4. 下次 target 定义时:
     research 读取失败经验
     → "stage N 尝试了 X 方向，convergence 下降，原因是..."
     → 用户/auto 基于此选择不同方向
```

### 3.5 stage.history 完整条目格式

```json
{
  "stage": 2,
  "name": "OAuth集成",
  "completed_at": "2026-03-08T14:30:00Z",
  "commit": "abc1234",
  "convergence": 0.65
}
```

字段说明：
- `commit`：阶段终点的 git commit hash，用于 rollback
- `convergence`：阶段完成时的目标接近度，用于趋势追踪和方向判断

---

## 4. Pending Refinement Buffer

### 4.1 问题

auto 执行中用户可能随时产生需求调整想法。当前设计下，用户发消息 = 等当前步骤完成后才处理，且处理方式是直接执行，可能打断执行流。

### 4.2 方案

异步缓冲：用户需求调整写入 buffer 文件，在自然检查点批量处理。

### 4.3 用户消息语义分类

| 用户说 | 分类 | auto 行为 |
|--------|------|-----------|
| "增加 OAuth 支持" | refinement | 写入 buffer → 确认回复 → 继续 |
| "这个错误什么意思？" | question | 回答 → 继续 |
| "跳过步骤 3" | directive | 调整 → 继续 |
| "继续" | continue | 继续 |

### 4.4 buffer 文件

路径：`.working/.pending-refinements.md`（git tracked，写入后 commit）

```markdown
- [2026-03-08 14:05] 增加 OAuth Google 登录支持
- [2026-03-08 14:12] 登录失败限流从5次改为10次
```

**Git commit**：`task-ai(<notebook>):auto buffer refinement`

**为什么 git tracked？** 如果 auto session 崩溃重启，buffer 内容不丢失。

### 4.5 确认与撤回

auto 检测到 refinement 后：
1. 写入 buffer
2. 回复：**"已记录需求调整：`<内容>`。如有误，请说'撤回'。"**
3. 用户下一条消息如果是"撤回/不是/取消" → 删除 buffer 最后一条
4. 否则 → 继续执行

不打断执行流，但给用户纠错窗口。

### 4.6 两级处理

**步骤间快检（exec step 之间）**：
```
if .pending-refinements.md 存在且非空:
    逐条扫描 → 标注影响范围（哪些 R#）
    if 影响当前正在执行的步骤:
        标记 needs_reassess = true（完成当前步骤后触发 mid-exec check）
    else:
        继续（留到 check 点批处理）
```

**check 检查点批处理（mid-exec / post-exec）**：
```
if .pending-refinements.md 存在且非空:
    1. 逐条调用 target --refine "..."
    2. 更新 .convergence-baseline.md（增/改 R#，调权重）
    3. 影响评估:
       - 纯增量（新 R# 不影响已完成步骤）→ 追加到 plan 尾部，继续
       - 修改已有 R#（权重/内容变）→ NEEDS_FIX 或 REPLAN
    4. 清空 buffer
```

### 4.7 影响评估分级

| 影响级别 | 判定 | 处理 |
|----------|------|------|
| 无影响 | 新增 R# 且与当前/已完成步骤无关 | plan 追加步骤，继续当前执行 |
| 轻微 | 修改了 optional R# 的细节 | 标记，post-exec 时处理 |
| 中度 | 修改了 important R# | 触发 mid-exec check |
| 重大 | 修改了 critical R# 或 Overall Objective | REPLAN |

---

## 5. `.auto-signal` 废弃

### 5.1 原因

`.auto-signal` 的两个角色都已被 `.status.json` 替代：

| 角色 | 旧方案 | 新方案 |
|------|--------|--------|
| auto 路由 | `.status.json`（本就如此） | `.status.json`（不变） |
| daemon 监控 | `.auto-signal` | `.status.json`（统一） |
| check 评分 | `.auto-signal` check_score | `.analysis/` 文件（已有） |

auto session 状态（iteration、compaction_count、retry_count、delegation_failures）改为内存变量，不持久化。session 崩溃重启后这些计数归零，通过 `.status.json` + `.summary.md` 恢复上下文。

### 5.2 清理范围

| 操作 | 涉及 |
|------|------|
| 移除 `.auto-signal` section | 所有 SKILL.md |
| 移除 signal 写入逻辑 | merge.sh, auto.sh, signal-writer.sh |
| 移除 `.auto-signal` gitignore 条目 | init.sh, task-ai.md |
| 移除 `SIGNAL_FILE` 变量 | merge.sh, auto.sh |
| 移除 signal-writer.sh | auto/scripts/ |
| 移除 Signal Validation 节 | auto/SKILL.md |

### 5.3 `.status.json` 扩展

daemon 需要的监控字段，由各子命令写入 `.status.json`：

```json
{
  "status": "executing",
  "stage": { "current": 2, "history": [...] },
  "completed_steps": 3,
  "updated": "2026-03-08T14:30:00Z"
}
```

daemon 通过 `fs.watch` 监控 `.status.json` 变化（替代原来监控 `.auto-signal`），通过 `updated` 时间戳检测心跳。

---

## 6. 子命令职责链

### 6.1 三文件协作

| 文件 | 职责 | 写入者 | 消费者 |
|------|------|--------|--------|
| `.target.md` | 人类可读目标描述 | target | plan, check, report |
| `.convergence-baseline.md` | 结构化原子需求 + 权重 | target | plan, check |
| `.plan.md` | 实现步骤 + R# 映射 | plan | exec, check |

### 6.2 target 改动

| 触发 | baseline 操作 |
|------|---------------|
| 首次 write（stage 1） | 从 `.target.md` 拆解 → 生成 baseline |
| `--refine` | 增量更新（追加/修改 R#） |
| stage advance（evolving → planning） | baseline 不变（Overall Objective 不变） |
| 修改 Overall Objective | 重新生成 baseline（保留已有评分记录） |
| satisfied re-enter（3c） | 重新生成 baseline（新的 Overall Objective） |

### 6.3 plan 改动

读 `.convergence-baseline.md`，每个计划步骤标注覆盖哪些 R#：

```markdown
## Step 3: 实现 JWT 中间件
覆盖: R1, R5
- 验证 token 签名...
- 失败限流逻辑...
```

### 6.4 check 改动

**post-plan 新增验证**：扫描 plan 步骤的 `覆盖: R#` 标注，baseline 中的 R# 未被任何步骤覆盖 → NEEDS_REVISION，指出遗漏项。

**post-exec 双门禁**：D1-D6 质量门禁 + convergence 方向门禁（见 §3.2）。

**convergence 评估输出**：写入 `.analysis/<date>-convergence.md`，含逐项 R# 评分明细表。

### 6.5 auto 改动

**refinement buffer**：语义分类 + 异步缓冲 + 检查点批处理（见 §4）。

**移除所有 `.auto-signal` 相关逻辑**（见 §5）。

**rollback routing**：check 返回 ROLLBACK 时，auto 执行回滚流程并路由到 evolving。

---

## 7. 涉及文件清单

| 操作 | 文件 | 变更要点 |
|------|------|----------|
| 修改 | `target/SKILL.md` | 新增 baseline 生成步骤 |
| 修改 | `target/scripts/target.sh` | baseline 生成/更新逻辑 |
| 修改 | `plan/SKILL.md` | 读 baseline、步骤映射 R# |
| 修改 | `check/SKILL.md` | post-plan R# 覆盖验证 + post-exec 双门禁 + convergence 评估 + 移除 `.auto-signal` section |
| 修改 | `auto/SKILL.md` | refinement buffer + ROLLBACK routing + 移除 signal 相关 |
| 修改 | `auto/scripts/auto.sh` | 移除 signal 写入 + 移除 signal-writer.sh 引用 |
| 修改 | `merge/SKILL.md` | 移除 `.auto-signal` section |
| 修改 | `merge/scripts/merge.sh` | 移除 signal 写入 |
| 删除 | `auto/scripts/signal-writer.sh` | 不再需要 |
| 修改 | `commands/task-ai.md` | schema: convergence 字段 + baseline 说明 + 移除 signal 引用 |
| 修改 | `commands/references/progressive-target.md` | convergence 趋势 + rollback 联动 |
| 修改 | `commands/references/state-matrix.md` | ROLLBACK 路径 |
| 修改 | `init/scripts/init.sh` | 移除 `.auto-signal` gitignore 条目 |
| 修改 | 其余 SKILL.md（exec, report, highlight, verify, annotate, cancel, list, research, read, security, library, summarize） | 移除 `.auto-signal` section |
| 同步 | `plugins/task-ai/` | publish 同步 |

---

## 8. 六维审查结果

| 维度 | 结果 | 关键发现 |
|------|------|----------|
| D2 安全性 | PASS | buffer 注入风险低，`--refine` 限制在 Refinements section |
| D1 正确性 | PASS | baseline 生成时机完整覆盖；双门禁流程闭环 |
| D3 可靠性 | PASS | buffer git tracked 防丢失；convergence 锚定防评分漂移 |
| D4 性能 | PASS | baseline ≤ 30 条 R#；buffer 两级处理不增额外开销 |
| D5 架构 | PASS | 三文件职责链清晰；`.auto-signal` 移除减少复杂度 |
| D6 可维护性 | PASS | convergence 公式简单可解释；评估含逐项明细表 |
