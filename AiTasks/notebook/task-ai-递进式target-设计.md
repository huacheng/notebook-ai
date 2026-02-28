# 递进式 target 设计方案

> task-ai 多阶段目标递进：同一 notebook 内分阶段执行，逐步实现复杂目标
> 日期：2026-02-26
> 前置依赖：highlight 设计方案

---

## 1. 定位与目标

### 1.1 解决的问题

当前 task-ai 的 target.md 是一个扁平的目标定义（Objective / Requirements / Constraints），整个 notebook 从头到尾只追求一个目标。这对复杂任务有两个局限：

1. **目标过大时 plan 质量下降** — 一次性为复杂目标生成的 plan 往往步骤过多、依赖链过长，exec 中途容易因连锁问题触发反复 REPLAN
2. **无法渐进式学习** — 阶段性成果没有沉淀机制，后续阶段无法复用前序阶段的经验。整个任务要么全部成功（走到 report），要么中途放弃（只有 provisional 碎片）

### 1.2 设计思路

在同一个 notebook 内支持多阶段（stage）目标：

```
Stage 1 目标 → auto(plan→exec→merge) → highlight 沉淀 → report
    ↓ 阶段推进
Stage 2 目标 → auto(plan→exec→merge) → highlight 沉淀 → report
    ↓ 阶段推进
Stage 3 目标 → auto(plan→exec→merge) → highlight 沉淀 → report → 全部完成
```

每个阶段走完整的 plan→exec→merge 周期，阶段之间通过 highlight 沉淀经验，形成知识复利。

### 1.3 统一模板（硬升级）

不做向后兼容。所有 notebook 统一使用递进式模板：

- `init` 时即初始化 `stage` 字段（`current: 1, total: 1`）
- `total: 1` 等价于当前单阶段模式（merge → complete，无 Phase 5）
- `total > 1` 时启用多阶段推进（merge → stage-done → Phase 5）
- 已有 notebook 无需迁移 — 缺少 `stage` 字段时各命令按 `total: 1` 缺省处理

---

## 2. target.md 格式

### 2.1 单阶段（total: 1）

单阶段时 target.md 使用简化格式 — 等价于只有一个 Stage 的递进式模板：

```markdown
## Objective
实现用户认证系统

## Requirements
- JWT token 认证
- 登录/登出 API

## Constraints
- 不引入新的数据库依赖
```

> 无需 `## Overall Objective` 或 `## Stage Advancement` 头。`total: 1` 时各命令直接读取顶层 Objective/Requirements/Constraints，与多阶段格式的 Stage 1 等价。

### 2.2 多阶段格式（total > 1）

```markdown
## Overall Objective
构建完整的用户权限管理系统，从基础认证到细粒度权限控制。

## Stage Advancement
mode: manual

---

## Stage 1: 基础认证 [COMPLETE]

### Objective
实现 JWT 认证的登录/登出

### Requirements
- JWT token 签发与验证
- 登录/登出 REST API
- Token 过期与刷新

### Constraints
- 使用现有 SQLite 数据库

### Results
> Stage 完成后由 auto/agent 自动填写
- 实现了 JWT 中间件 + /auth/login, /auth/logout 端点
- Token 刷新采用滑动窗口方案

---

## Stage 2: OAuth 集成 [ACTIVE]

### Objective
支持 GitHub 和 Google OAuth 登录

### Requirements
- OAuth 2.0 授权码流程
- 账号关联（OAuth 账号绑定已有用户）
- 回调处理

### Constraints
- 复用 Stage 1 的 JWT 机制签发 token

---

## Stage 3: 权限系统 [PENDING]

### Objective
实现 RBAC 角色权限控制

### Requirements
- 角色定义（admin/editor/viewer）
- 路由级权限守卫
- 权限继承

### Constraints
- 基于 Stage 1-2 的认证基础
```

### 2.3 格式规范

| 元素 | 规则 |
|------|------|
| `## Overall Objective` | 必须。跨阶段的总体目标，AI-auto 模式下 agent 据此拆解后续阶段 |
| `## Stage Advancement` | 必须。`mode: manual` 或 `mode: ai-auto` |
| `---`（水平线） | 阶段之间的分隔符 |
| `## Stage N: <name> [STATUS]` | STATUS 取值：`COMPLETE`、`ACTIVE`、`PENDING`。N 为从 1 开始的序号 |
| `### Objective` | 本阶段目标（必须） |
| `### Requirements` | 本阶段需求（必须） |
| `### Constraints` | 本阶段约束（可选） |
| `### Results` | 阶段完成后填写的成果摘要（auto/agent 自动填写） |

**STATUS 规则：**
- 同时只能有一个 `[ACTIVE]` 阶段
- `[ACTIVE]` 之前的所有阶段必须是 `[COMPLETE]`
- `[ACTIVE]` 之后的阶段必须是 `[PENDING]`

### 2.4 阶段模式判定

各命令通过 `.index.json` 的 `stage.total` 判定行为：

```
if stage.total == 1:
    单阶段行为 — target.md 使用简化格式，merge → complete
elif stage.total > 1:
    多阶段行为 — target.md 使用多阶段格式，merge → stage-done（非最后阶段）
```

**target 命令写入时的格式检测**（用于从简化格式升级到多阶段格式）：

```
if target.md contains "## Stage Advancement" AND "## Stage 1:":
    解析为多阶段 → 更新 stage.total/current
else:
    解析为单阶段 → stage.total = 1, stage.current = 1
```

---

## 3. .index.json schema 变更

### 3.1 stage 字段（始终存在）

`init` 时即初始化 `stage` 字段。单阶段默认值：

```json
{
  "name": "auth-system",
  "status": "executing",
  "type": "software",
  "...": "...existing fields...",

  "stage": {
    "current": 1,
    "total": 1,
    "advancement": "manual",
    "completed": []
  }
}
```

多阶段示例：

```json
{
  "stage": {
    "current": 2,
    "total": 3,
    "advancement": "manual",
    "completed": [
      {
        "stage": 1,
        "name": "基础认证",
        "completed_at": "2026-02-25T10:00:00Z",
        "highlight_file": ".memory/.experiences/software/auth-system-stage-1-complete.md"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `stage.current` | integer | 当前阶段序号（1-based） |
| `stage.total` | integer | 阶段总数。`1` = 单阶段（等价旧行为），`>1` = 多阶段 |
| `stage.advancement` | string | `"manual"` 或 `"ai-auto"` |
| `stage.completed` | array | 已完成阶段的记录（单阶段时为空数组） |
| `stage.completed[].stage` | integer | 阶段序号 |
| `stage.completed[].name` | string | 阶段名称 |
| `stage.completed[].completed_at` | string | 完成时间戳 |
| `stage.completed[].highlight_file` | string | 该阶段的 highlight 经验文件路径 |

### 3.2 缺省处理

已有 notebook 可能缺少 `stage` 字段。各命令遇到缺失时按 `{ current: 1, total: 1, advancement: "manual", completed: [] }` 缺省处理，无需迁移脚本。

### 3.3 stage 字段初始化与升级

- **init 时**: 始终初始化 `stage` 字段（默认 `total: 1`）
- **target 写入时**: 检测 target.md 格式，如包含多阶段标记 → 解析并更新 `stage.total/current`；如为简化格式 → 保持 `total: 1`
- **从单阶段升级到多阶段**: 用户编辑 target.md 加入 Stage 格式后，运行 target 命令会检测并更新 `stage.total`

---

## 4. 状态机变更

### 4.1 新增状态：`stage-done`

`stage-done` 是一个**非终端状态**，表示"当前阶段已完成，等待推进到下一阶段"。

**产生条件**：merge 成功时，如果 `stage.current < stage.total`。

**如果 `stage.current == stage.total`**（含 `total: 1` 单阶段）：merge 照常设置 `complete`。

### 4.2 stage-done 的状态转换

| Current Status | Command | Next Status | Condition |
|----------------|---------|-------------|-----------|
| `stage-done` | target | → `planning` | 推进到下一阶段 |
| `stage-done` | highlight | — (no change) | 阶段经验蒸馏 |
| `stage-done` | report | — (no change) | 阶段报告 |
| `stage-done` | cancel | → `cancelled` | 取消整个 notebook |
| `stage-done` | 其他命令 | ⊘ (rejected) | 不允许 |

### 4.3 完整 state-matrix 变更

在现有矩阵中增加一行：

```
| `stage-done` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` | — |
```

并修改 merge 列的 `executing` 行：

```
原来: executing + merge → complete / executing(conflict)
改为: executing + merge → complete / stage-done / executing(conflict)
                          ↑ stage.current == stage.total（含 total: 1）
                                    ↑ stage.current < stage.total
```

### 4.4 终端状态不变

终端状态仍为 `complete` 和 `cancelled`。`stage-done` 是非终端状态（有退出路径：→ planning 或 → cancelled）。

**验证性质保持：**
- 每个非终端状态有 ≥1 个退出路径 ✅
- `stage-done` → `planning`（通过 target）或 → `cancelled`（通过 cancel）✅
- 无死锁 ✅

---

## 5. merge 变更

### 5.1 Phase 4 分支逻辑

merge SKILL.md 的 Phase 4（Post-Merge Finalization）增加分支：

```
Phase 4: Post-Merge Finalization

On successful merge:

1. 读 .index.json 的 stage 字段
2. IF stage.current < stage.total:
     a. 更新 .index.json:
        - status → "stage-done"
        - stage.completed push { stage: current, name, completed_at, highlight_file: "" }
          （highlight_file 留空，由后续 highlight(complete) 执行后回写）
        - 更新 timestamp
        - 保留 branch 和 worktree
     b. 更新 target.md:
        - 当前 Stage 的 [ACTIVE] → [COMPLETE]
        - 填写 ### Results（从 .summary.md 提取阶段成果摘要）
     c. Write .summary.md（阶段完成摘要）
     d. Git commit: task-ai(<notebook>):merge stage <N> completed
   ELSE (current == total，含 total: 1 单阶段):
     a. 同现有逻辑：status → "complete"
     b. Git commit: task-ai(<notebook>):merge task completed
3. Write .auto-signal
4. Report result
```

### 5.2 State Transitions 更新

| Current Status | After Merge | Condition |
|----------------|-------------|-----------|
| `executing` | `complete` | current == total（含 total: 1 单阶段） |
| `executing` | `stage-done` | current < total |
| `executing` | `executing` | Merge conflict unresolvable |

### 5.3 .auto-signal 更新

| 结果 | signal |
|------|--------|
| 成功（非多阶段/最终阶段） | `{ "step": "merge", "result": "success", "next": "highlight", ... }` |
| 成功（阶段完成） | `{ "step": "merge", "result": "stage-done", "next": "highlight", ... }` |
| 冲突 | 不变 |

---

## 6. auto 循环变更

### 6.1 新增 Phase 5: Stage Advancement

```
AUTO LOOP (5 phases)

Phase 1-3: 不变 (Planning → Execution → Post-Exec Verification)

Phase 4: Merge & Distillation
  merge ─── success ──→ highlight(complete) ──→ report
    │          │        (current == total)
    │      stage-done ──→ highlight(complete) ──→ report(summary) ──→ [Phase 5]
    │      (current < total)
    └── conflict → (stop)

Phase 5: Stage Advancement (仅 current < total 时进入)
  IF stage.advancement == "manual":
    → (stop) — 输出 "Stage <N> 完成。请定义下一阶段目标后运行 /task-ai:auto"

  IF stage.advancement == "ai-auto":
    → stage-advance:
      1. 读 Overall Objective + 已完成阶段的 Results
      2. 读 library 中前序阶段的经验（通过 highlight 已沉淀）
      3. 生成下一阶段的 Objective/Requirements/Constraints
      4. 更新 target.md：下一 Stage [PENDING] → [ACTIVE]
      5. 更新 .index.json: stage.current++, status → "planning"
      6. 归档当前 plan: .plan.md → .plan-stage-<N>.md
      7. 重置: completed_steps → 0, 清空 .bugfix/, 保留 .test/ 和 .analysis/ 历史
      8. Git commit: task-ai(<notebook>):target stage <N+1> defined
      9. → [Phase 1] (回到 Planning，进入下一阶段)
```

### 6.2 Result-Based Routing 新增

| step | result | next | checkpoint | Rationale |
|------|--------|------|------------|-----------|
| merge | stage-done | highlight | — | 阶段完成，先蒸馏经验 |
| highlight | (distilled) | report | — | 蒸馏完成，生成阶段报告 |
| highlight | (skipped-idempotent) | report | — | 输入无更新，跳过蒸馏（见 highlight §3.5 幂等检查） |
| highlight | failed | report | — | 蒸馏失败，跳过继续报告（见 highlight §5.3） |
| report | (generated) | stage-advance | — | 报告完成，检查是否推进 |
| stage-advance | advanced | plan | — | AI-auto: 下一阶段目标已定义，开始规划 |
| stage-advance | manual-stop | (stop) | — | manual: 等待用户介入 |

### 6.3 Signal Validation 更新

auto/SKILL.md 的 Signal Validation 白名单新增：

| Field | 新增允许值 |
|-------|----------|
| `step` | `highlight`, `stage-advance` |
| `result` | `(distilled)`, `(skipped-idempotent)`, `failed`, `stage-done`, `advanced`, `manual-stop` |
| `next` | `highlight`, `stage-advance` |

### 6.4 Entry Point 更新

| Current Status | First Step |
|----------------|-----------|
| `stage-done` | highlight(complete) → report → stage-advance |
| 其余 | 不变 |

`stage-done` 作为 auto 入口点：当用户在 manual 模式下定义了下一阶段目标后重新运行 `/task-ai:auto`，auto 从 `stage-done` 状态路由到 highlight → report → stage-advance → Phase 1。

### 6.5 Iteration 与 Context 管理

**iteration 跨阶段是否重置？**

不重置。iteration 是本次 auto session 的全局计数器，用于 daemon 的 max_iterations 限制和 stall detection。跨阶段继续累加，确保安全上限仍然有效。

**context 跨阶段的处理：**

阶段推进时（stage-advance step 7），auto 执行一次 proactive compaction：
- 压缩当前上下文（前序阶段的实现细节不再需要）
- `.summary.md` 已由 report 更新，包含阶段成果摘要
- 新阶段从 `.summary.md` + 新 target 恢复上下文

这避免了多阶段执行时 context window 过早耗尽。

---

## 7. target 命令变更

### 7.1 Write Mode 增强

target write mode 增加多阶段解析：

```
target write 流程:

1. 读取用户提供的 objective 内容
2. 检测格式:
   - 包含 "## Stage Advancement" + "## Stage 1:" → 多阶段格式
   - 否则 → 单阶段格式（等价 total: 1）
3. IF 多阶段格式:
   a. 解析所有 stage（序号、名称、状态）
   b. 验证:
      - 只有一个 [ACTIVE]
      - [COMPLETE] 在 [ACTIVE] 之前
      - [PENDING] 在 [ACTIVE] 之后
      - Stage Advancement mode 合法（manual | ai-auto）
   c. 更新 .index.json: stage.total/current/advancement
   d. 写入 target.md
   e. Git commit
4. IF 单阶段格式:
   a. 确保 .index.json: stage.total = 1, stage.current = 1
   b. 写入 target.md（简化格式）
   c. Git commit
```

### 7.2 State Transitions 更新

| Current Status | Result | Next Status | Checkpoint | Rationale |
|:---|:---|:---|:---|:---|
| `stage-done` | (updated) | `planning` | `stage-advance` | 下一阶段目标已定义，进入规划 |
| 其余 | 不变 | 不变 | 不变 | — |

### 7.3 stage-done 上的 target 行为

当 notebook 处于 `stage-done` 状态时：

```
/task-ai:target "下一阶段目标..."
  → 更新 target.md：下一 Stage [PENDING] → [ACTIVE]，写入用户提供的目标
  → 更新 .index.json: stage.current++, status → "planning"
  → 归档: .plan.md → .plan-stage-<N>.md
  → 重置: completed_steps → 0
  → Git commit: task-ai(<notebook>):target stage <N+1> defined
```

这是 manual 模式下用户推进到下一阶段的标准路径。

---

## 8. 阶段推进中的文件管理

### 8.1 归档策略

阶段推进时，部分文件需要归档以避免下一阶段与上一阶段的产物混淆：

| 文件 | 处理 | 理由 |
|------|------|------|
| `.plan.md` | 重命名为 `.plan-stage-<N>.md` | 新阶段需要全新的 plan |
| `.plan-superseded.md` | 如存在，重命名为 `.plan-superseded-stage-<N>.md` | 同上 |
| `.analysis/` | **保留不动** | 历史评估记录对 check 有参考价值 |
| `.test/` | **保留不动** | 历史测试标准和结果对 verify 有参考价值 |
| `.bugfix/` | **清空目录内容** | 上一阶段的 bugfix 与新阶段无关 |
| `.notes/` | **保留不动** | 研究笔记可能跨阶段复用 |
| `.summary.md` | 被 report 已更新为包含阶段成果 | 新阶段 plan 会覆盖 |
| `.target.md` | 就地更新（标记切换） | 保留全部阶段定义的完整性 |
| `.index.json` | 更新 stage + 重置 completed_steps | — |
| `.type-profile.md` | **保留不动** | 类型信息跨阶段稳定 |

### 8.2 Git 分支

**同一个 branch**。多阶段 notebook 始终在 `task/<notebook>` 分支上工作。merge 将当前阶段的代码合并到 main，但分支不删除，继续用于下一阶段。

### 8.3 阶段间 merge 行为

每个阶段完成后都 merge 到 main。这意味着：
- 阶段 1 的代码已在 main 上
- 阶段 2 从 main 的新基础开始（可能需要先 rebase task branch）
- 每个阶段 merge 后 main 都有完整的可运行代码

**stage-advance 中的 rebase**（在 stage-advance step 7 中）：

```
阶段推进时:
  1. 确保当前在 task/<notebook> 分支
  2. git rebase main（将 task branch 更新到最新 main）
  3. 如果 rebase 有冲突 → 尝试解决（最多 3 次）
  4. 解决失败 → (stop)，报告需手动处理
```

---

## 9. highlight 联动

### 9.1 自动触发

阶段完成（merge → stage-done）后，auto 循环自动调度 highlight(scope=complete)：

```
merge(stage-done) → highlight(complete, auto-complete) → report(summary)
```

此处 highlight 以 **auto-complete 模式** 执行（见 highlight 设计 §3.5）：
- 输入源为**系统文件**（无对话上下文，agent 独立启动）
- 执行 mtime 幂等检查 — 输入文件无更新时跳过蒸馏，写 signal `(skipped-idempotent)`
- 写入 `.experiences/<type>/<notebook>-stage-<N>-complete.md`
- 文件名含阶段序号，与最终的 `-complete.md` 区分

用户也可手动触发 `/task-ai:highlight <notebook>`，此时以 **manual-complete 模式** 执行（对话上下文为首要输入，不做幂等检查）。

### 9.2 经验文件命名

| 场景 | 文件名 |
|------|--------|
| 阶段性蒸馏（stage-done） | `<notebook>-stage-<N>-complete.md` |
| 最终蒸馏（所有阶段完成） | `<notebook>-complete.md` |
| 阶段性 impl | `<notebook>-impl.md`（O_APPEND，所有阶段累积） |
| 阶段性 verify | `<notebook>-verify.md`（O_APPEND，所有阶段累积） |

### 9.3 highlight_file 回写

highlight(complete) 执行成功后，回写 `.index.json` 中对应 stage.completed 条目的 `highlight_file` 字段：

```
stage.completed[current-1].highlight_file =
    ".memory/.experiences/<type>/<notebook>-stage-<N>-complete.md"
```

> 此回写由 highlight 负责（非 merge），因为 merge 执行时 highlight 文件尚未生成。

### 9.4 最终蒸馏

最后一个阶段 merge → `complete`（非 `stage-done`）时，highlight(complete) 执行最终蒸馏：
- 读取所有阶段的 Results、所有 `.plan-stage-*.md`
- 读取所有阶段的 highlight 经验文件（`-stage-*-complete.md`）
- 综合生成 `<notebook>-complete.md`，覆盖所有阶段的累积经验
- 这是 auto-complete 模式（见 highlight §3.5），输入源为系统文件

---

## 10. AI-auto 模式的阶段生成

### 10.1 Agent 生成下一阶段的协议

当 `stage.advancement == "ai-auto"` 时，stage-advance 步骤中 agent 需自主生成下一阶段的目标：

```
Step 1: 读取上下文
  - Overall Objective（总体目标）
  - 已完成阶段的 Results（各阶段成果）
  - 当前代码状态（git diff main 或关键文件概览）
  - library 中本 notebook 的经验文件

Step 2: 差距分析
  - Overall Objective 要求了什么？
  - 已完成阶段实现了什么？
  - 还缺什么？

Step 3: 下一阶段目标生成
  - 基于差距分析，定义下一阶段的 Objective/Requirements/Constraints
  - 粒度原则：一个阶段应在 auto 的 max_iterations (默认 20) 内可完成
  - 如果剩余工作过大 → 拆分为多个 PENDING 阶段

Step 4: 验证
  - 下一阶段不与已完成阶段重复
  - 下一阶段的 Constraints 引用前序阶段的成果
  - 阶段粒度合理（不过大也不过小）

Step 5: 写入
  - 更新 target.md（新阶段 [PENDING] → [ACTIVE]，如需要还可追加新 [PENDING] 阶段）
  - 更新 .index.json
```

### 10.2 阶段数量动态性

AI-auto 模式下，`stage.total` 可以在推进过程中增加：
- 初始时用户可能只定义了 Stage 1 + Overall Objective
- Agent 在推进时发现需要更多阶段 → 在 target.md 中追加新的 PENDING stage
- 更新 `stage.total`

也可以减少：
- Agent 发现剩余工作可以在一个阶段内完成 → 合并 PENDING stages
- 更新 `stage.total`

### 10.3 manual 模式的用户交互

manual 模式下，auto 在 stage-done 后停止。用户推进的典型工作流：

```
1. auto 完成 stage 1，停止并报告：
   "Stage 1 '基础认证' 完成。请定义下一阶段目标：
    /task-ai:target '下一阶段目标描述'
    或直接编辑 .target.md 后运行 /task-ai:auto"

2. 用户运行:
   /task-ai:target "实现 OAuth 集成，支持 GitHub 和 Google"

3. target 命令:
   - 更新 target.md Stage 2 内容
   - Stage 2: [PENDING] → [ACTIVE]
   - status: stage-done → planning
   - stage.current: 1 → 2

4. 用户运行:
   /task-ai:auto <notebook>
   → auto 从 planning 状态开始 Phase 1
```

---

## 11. Git 约定

### 11.1 新增 Commit 类型

| 动作 | Commit 消息 |
|------|------------|
| 阶段 merge | `task-ai(<notebook>):merge stage <N> completed` |
| 阶段性 highlight | `task-ai(<notebook>):highlight complete distillation`（与 highlight §8 一致，不含 stage 序号） |
| 阶段推进（target） | `task-ai(<notebook>):target stage <N+1> defined` |
| 阶段推进（ai-auto） | `task-ai(<notebook>):target stage <N+1> auto-generated` |
| Plan 归档 | 包含在阶段推进的 commit 中 |

> highlight commit 不含 stage 序号 — highlight 不知道阶段概念（见 highlight §8），阶段信息体现在文件名（`-stage-<N>-complete.md`）中。

### 11.2 Git Log 可追溯性

多阶段 notebook 的 git log 呈现清晰的阶段边界：

```
task-ai(auth):target stage 3 defined
task-ai(auth):report stage summary generated          ← stage 2 报告
task-ai(auth):highlight complete distillation         ← stage 2 经验蒸馏
task-ai(auth):merge stage 2 completed
task-ai(auth):exec step 3/3 done
...
task-ai(auth):report stage summary generated          ← stage 1 报告
task-ai(auth):highlight complete distillation         ← stage 1 经验蒸馏
task-ai(auth):merge stage 1 completed
task-ai(auth):exec step 2/2 done
...
task-ai(auth):plan generate implementation plan
task-ai(auth):init initialize task module
```

---

## 12. plan 命令的阶段感知

plan 在多阶段模式下需要感知阶段上下文：

### 12.1 读取阶段信息

plan step 2（读取 .target.md）增加：

```
IF multi-stage mode:
  只读取当前 [ACTIVE] 阶段的 Objective/Requirements/Constraints
  同时读取前序 [COMPLETE] 阶段的 Results（作为已有能力的上下文）
  plan 的范围限定在当前阶段
```

### 12.2 跨阶段经验复用

plan step 9-11（Load library context）自然会读取前序阶段通过 highlight 沉淀的经验文件。这是 highlight 联动的直接收益 — 前序阶段的实现经验、验证经验自动成为后续阶段 plan 的参考。

---

## 13. 六维审查

### 13.1 正确性

| 审查点 | 评估 |
|--------|------|
| 状态机完整性 | ✅ `stage-done` 有退出路径（→ planning, → cancelled），无死锁 |
| 统一模板 | ✅ 硬升级到递进式模板，total: 1 等价单阶段；已有 notebook 缺少 stage 字段时按 total: 1 缺省处理 |
| highlight 联动 | ✅ stage-done → highlight 使用 auto-complete 协议（highlight §3.5）；幂等检查 + 三种 signal result 均对齐；highlight_file 回写职责明确归 highlight |
| target.md 解析 | ⚠️ 需要鲁棒的 markdown 解析。用户可能格式不严格（缺少 `---` 分隔、STATUS 拼写错误）。agent 应容错解析 + 提示修正 |
| completed_steps 重置 | ✅ 阶段推进时重置为 0，新 plan 重新计数 |
| merge 分支行为 | ✅ 每阶段 merge 到 main，下阶段 rebase 保持基础最新 |

### 13.2 安全性

| 审查点 | 评估 |
|--------|------|
| AI-auto 阶段生成 | ⚠️ agent 自主生成的阶段目标可能偏离用户意图。缓解：AI-auto 模式下每次阶段推进写入 git commit，用户可事后审查。严格模式可考虑加确认步骤（未来增强） |
| iteration 限制跨阶段 | ✅ iteration 不重置，全局 max_iterations 仍然有效，防止无限循环 |
| stage.total 动态变化 | ⚠️ AI-auto 可增加阶段数量。配合 iteration 限制可防止无限膨胀。可考虑增加 max_stages 限制（如默认 10） |

### 13.3 可靠性

| 审查点 | 评估 |
|--------|------|
| 阶段推进失败 | ✅ 如果 rebase 或 target 更新失败 → (stop)，状态留在 stage-done，用户可手动处理后重试 |
| context window | ✅ 阶段推进时 proactive compaction，避免多阶段累积上下文溢出 |
| highlight 失败 | ✅ highlight 失败时 auto 继续到 report，阶段推进不受阻（经验缺失但流程可续） |
| 中途停止恢复 | ✅ stage-done 是持久状态，auto 重启后从 stage-done 入口恢复 |

### 13.4 性能

| 审查点 | 评估 |
|--------|------|
| 每阶段 merge overhead | 中等。每阶段 merge 一次 + highlight 一次 + report 一次。但这是必要开销（阶段性知识沉淀的代价）|
| plan 归档文件累积 | ✅ `.plan-stage-*.md` 文件会累积，但每个文件读取是按需的，不影响性能 |
| 阶段间 rebase | ⚠️ 如果 main 上有其他变更（其他 task merge），rebase 可能产生冲突。但这与现有单次 merge 的冲突风险一致，没有额外增加 |

### 13.5 架构

| 审查点 | 评估 |
|--------|------|
| 状态机扩展 | ✅ 只加一个 `stage-done` 状态，不膨胀 |
| 命令改动范围 | ✅ 主要改 merge（分支逻辑）、auto（Phase 5）、target（stage-done 处理）。exec/verify/check/plan 只需在读取 target 时感知阶段，改动最小 |
| 与 highlight 的耦合 | ✅ 单向依赖：递进式 target → highlight（触发蒸馏）。highlight 不知道阶段概念，只做蒸馏 |
| depends_on 兼容 | ✅ 多阶段 notebook 对外仍是一个 notebook，其他 notebook 的 depends_on 指向它时，需 status == complete（所有阶段完成）才满足依赖 |

### 13.6 可维护性

| 审查点 | 评估 |
|--------|------|
| target.md 格式复杂度 | ⚠️ 多阶段格式比单阶段复杂。需在 target/SKILL.md 中增加格式说明和验证规则 |
| stage 字段在 .index.json | ✅ 嵌套在 `stage` 对象内，不污染顶层字段 |
| 文档量 | 中等。需修改 merge/auto/target 三个 SKILL.md + state-matrix + git-details |

### 13.7 审查总结

| 维度 | 判定 | 遗留项 |
|------|------|--------|
| 正确性 | ✅ | target.md 格式解析需容错 |
| 安全性 | ✅ | 可选：增加 max_stages 限制（如默认 10） |
| 可靠性 | ✅ | — |
| 性能 | ✅ | — |
| 架构 | ✅ | — |
| 可维护性 | ✅ | target.md 格式需文档化 |

---

## 14. 回归测试与红绿 TDD

递进式 target 的实施必须遵循 Red/Green TDD 流程 — 每项变更先写失败测试，再写最少量代码让测试通过，最后重构。

### 14.1 TDD 节奏

```
对于每个实施清单任务:
  1. Red   — 写测试描述预期行为 → 运行 → 确认失败
  2. Green — 写最少量变更 → 运行 → 确认通过
  3. Refactor — 在绿灯下清理一致性
```

> 递进式 target 涉及 SKILL.md 协议变更 + state.py 运行时代码。SKILL.md 部分用结构化验证脚本，state.py 部分用标准单元测试。

### 14.2 新功能测试（Red 先行）

| 功能模块 | 测试用例 | 验证点 |
|---------|---------|--------|
| target.md 格式 | `test-target-multistage-parse` | 多阶段格式解析正确（Overall Objective / Stage Advancement / Stage N 各节）；STATUS 标记识别（COMPLETE/ACTIVE/PENDING）；简化格式（无 Stage 头）解析为 total: 1 |
| .index.json stage | `test-index-stage-schema` | `stage` 字段始终存在（init 时创建）；结构完整（current/total/advancement/completed）；`advancement` 仅接受 manual/ai-auto 两值；`total: 1` 时 completed 为空数组 |
| stage-done 状态 | `test-state-stage-done` | state.py 接受 `executing → stage-done` 转换；拒绝非法转换（如 `planning → stage-done`）；stage-done 为非终态（可转换到 `planning`） |
| merge 分支逻辑 | `test-merge-stage-branch` | 有后续 stage 时 → `stage-done`（非 `complete`）；无后续 stage（final stage）→ `complete`；stage-done 时不删除分支/worktree |
| auto Phase 5 | `test-auto-stage-advance` | stage-done 后：ACTIVE stage 标记 COMPLETE → 下一 PENDING 标记 ACTIVE → 状态回 `planning` → 触发新 plan；ai-auto 模式自动生成下一阶段 Requirements |
| plan 阶段感知 | `test-plan-stage-aware` | plan 读取当前 ACTIVE stage 的 Requirements/Constraints（非全局）；plan 输出引用 stage 序号 |
| highlight 联动 | `test-highlight-stage-naming` | stage-done 触发 highlight 时：使用 auto-complete 模式（非 manual）；经验文件名含 `-stage-<N>-` 前缀；final stage 无前缀（保持现有命名）；highlight_file 回写到 stage.completed 对应条目 |
| highlight 幂等 | `test-highlight-stage-idempotent` | 连续两次 stage-done → highlight 时，第二次因 mtime 幂等检查写 `(skipped-idempotent)` signal |
| highlight 三 signal | `test-highlight-stage-signals` | auto routing 正确处理 highlight 的三种 result（distilled/skipped-idempotent/failed）均路由到 report |
| ai-auto 阶段生成 | `test-aiauto-stage-gen` | AI 生成的 stage 含完整 Requirements/Constraints；生成后 stage 总数不超过 max_stages |

### 14.3 回归测试（Green 保护）

确保 `total: 1`（单阶段）行为等价于升级前：

| 回归范围 | 测试用例 | 断言 |
|---------|---------|------|
| total:1 行为 | `regression-single-stage` | 简化格式 target.md 正常工作；stage.total=1 时所有命令行为与升级前一致 |
| total:1 缺省 | `regression-stage-missing` | 已有 notebook 缺少 `stage` 字段时，各命令按 total:1 缺省处理，不报错 |
| auto 全流程 | `regression-auto-single` | total:1 时 auto 不触发 Phase 5；merge → highlight → report 路径不变 |
| merge 行为 | `regression-merge-single` | total:1 时 merge 直接 → complete（非 stage-done） |
| target 编辑 | `regression-target-edit` | 简化格式 target.md 编辑、保存、conversational define 不受影响 |
| state-matrix | `regression-state-transitions` | 现有全部状态转换路径不变（draft/planning/review/executing/complete/cancelled/blocked） |
| highlight 无 stage | `regression-highlight-no-stage` | total:1 的 highlight(complete) 不添加 stage 前缀；经验文件命名不变；幂等检查正常工作；三种 signal result 均正确路由 |

### 14.4 实施顺序与 TDD 批次

按依赖关系分 4 批：

| 批次 | 任务 | TDD 要求 |
|------|------|---------|
| **Batch 0 — 基础兼容** | target.md 多阶段格式 + .index.json stage schema + state.py stage-done | Red: 新功能测试 + 单阶段回归测试全部就绪 → Green: 实现格式解析和状态定义 → 回归全绿 |
| **Batch 1 — 流程集成** | merge stage-done 分支 + auto Phase 5 + plan 阶段感知 | Red: merge/auto/plan 测试就绪 → Green: 逐个实现 → 新功能+回归全绿 |
| **Batch 2 — 联动** | highlight stage 命名 + ai-auto 阶段生成 | Red: 联动测试就绪 → Green: 实现 → 全绿 |
| **Batch 3 — 元数据** | state-matrix/git-details/signal whitelist 更新 | Red: 交叉引用一致性测试 → Green: 更新 → 全绿 |

---

## 15. 实施清单

| # | 任务 | 涉及文件 | 依赖 |
|---|------|---------|------|
| 1 | init 初始化 stage 字段（默认 total:1） | `skills/init/SKILL.md`, `commands/task-ai.md` (.index.json schema) | — |
| 2 | target.md 多阶段格式定义 + 解析逻辑 + 单阶段简化格式兼容 | `skills/target/SKILL.md` | #1 |
| 3 | merge 增加 stage-done 分支逻辑（current < total） | `skills/merge/SKILL.md` | #1, #2 |
| 4 | auto 增加 Phase 5: Stage Advancement | `skills/auto/SKILL.md` | #3 |
| 5 | auto signal validation 白名单更新 | `skills/auto/SKILL.md` | #4 |
| 6 | auto entry point 增加 stage-done 路由 | `skills/auto/SKILL.md` | #4 |
| 7 | state-matrix 增加 stage-done 行 | `commands/references/state-matrix.md` | #3 |
| 8 | git-details 增加阶段相关 commit 类型 | `commands/references/git-details.md` | — |
| 9 | plan 阶段感知（读取当前 ACTIVE stage） | `skills/plan/SKILL.md` | #2 |
| 10 | highlight 经验文件命名增加 stage 序号 | `skills/highlight/SKILL.md` | highlight 设计 |
| 11 | core/state.py 增加 stage-done 状态 | `core/state.py` | #7 |
| 12 | 各命令 stage 缺省处理（已有 notebook 缺少 stage 字段时按 total:1） | 所有读取 .index.json 的 SKILL.md | #1 |
| 13 | 可选：max_stages 安全限制 | `commands/task-ai.md`, `skills/auto/SKILL.md` | — |

---

## 16. 与 highlight 设计的关系

| 维度 | 说明 |
|------|------|
| 依赖方向 | 递进式 target → highlight（单向）。递进式 target 在阶段边界触发 highlight，但 highlight 不知道 stage 概念 |
| 执行模式 | stage-done → highlight 使用 auto-complete 模式（highlight §3.5）：输入源为系统文件，执行 mtime 幂等检查 |
| signal 对齐 | 本文档的 signal routing（§6.2）覆盖 highlight 的三种 result：`(distilled)` / `(skipped-idempotent)` / `failed`，均路由到 report |
| highlight 的改动 | 经验文件命名增加 `-stage-<N>-` 前缀（stage-done 触发时）+ highlight_file 回写 stage.completed 条目。协议和内容结构不变 |
| 可独立实施 | highlight 可先行实施（无 stage 概念时照常运行）。递进式 target 在 highlight 就绪后实施 |
| 实施顺序建议 | highlight 先 → 递进式 target 后 |
