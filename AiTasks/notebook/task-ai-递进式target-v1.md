# 递进式 target v1 设计方案

> task-ai 多阶段目标递进：同一 notebook 内分阶段执行，逐步实现复杂目标
> 日期：2026-02-27
> 版本：v1（manual 模式）
> 前置依赖：highlight 设计方案（已实现）
> 基于：`task-ai-递进式target-设计.md`（完整版），经讨论精简

---

## 1. v1 scope

### 1.1 包含

- 多阶段 target.md 格式（agent 生成，用户可读）
- `stage-done` 独立状态
- `mode: manual` — 阶段完成后 auto 停止，用户手动定义下一阶段
- target agent 主动分析目标复杂度，建议多阶段拆分
- .index.json stage schema
- merge / auto / target / plan / highlight 的阶段适配
- 单阶段（total: 1）完全向后兼容

### 1.2 不包含（留待 v2）

- `mode: ai-auto` — agent 自主生成下一阶段目标
- Phase 5 的 stage-advance 自动推进逻辑
- signal routing 中 `advanced` result
- max_stages 限制（manual 模式下用户自控节奏，不需要）

### 1.3 解决的问题

1. **目标过大时 plan 质量下降** — 一次性为复杂目标生成的 plan 步骤过多、依赖链过长
2. **无法渐进式学习** — 阶段性成果没有沉淀机制，后续阶段无法复用前序阶段经验

### 1.4 设计思路

```
Stage 1 目标 → auto(plan→exec→merge) → highlight 沉淀 → report → (stop)
    ↓ 用户定义下一阶段
Stage 2 目标 → auto(plan→exec→merge) → highlight 沉淀 → report → (stop)
    ↓ 用户定义下一阶段
Stage 3 目标 → auto(plan→exec→merge) → highlight 沉淀 → report → 全部完成
```

---

## 2. target 命令变更（映射到 target/SKILL.md）

### 2.1 核心变化

target 从"记录用户说的"变为"分析用户说的，必要时建议分阶段"。用户用自然语言描述目标，agent 主动判断是否适合拆分。

### 2.2 与现有 target/SKILL.md 的集成映射

当前 target/SKILL.md 结构（4 步）：

```
step 1: Context discovery
step 2: Write Mode（format → write → commit → thinking-raw）
step 3: Read Mode（read → display）
step 4: Validation
```

v1 变更映射：

| 现有步骤 | v1 变更 | 说明 |
|---------|---------|------|
| step 1 Context discovery | **扩展** | 增加读取 `.index.json` 的 `stage` 字段（缺省 total:1） |
| step 2 Write Mode | **重构为三分支** | 按 status 分支：正常写入 / stage-done 推进 / 首次多阶段分析 |
| step 3 Read Mode | **不变** | 用户打开 target.md 直接可读 |
| step 4 Validation | **不变** | — |
| State Transitions 表 | **新增一行** | `stage-done → planning` |
| Git 表 | **新增一行** | `target stage <N+1> defined` commit 类型 |

### 2.3 step 2 Write Mode 三分支

```
step 2: Write Mode（objective 已提供）

2a. 读取 .index.json 的 stage 字段和 status

2b. 分支路由:

  IF status == "stage-done":
    → [Stage Advance 模式] (§2.4)

  ELIF stage.total > 1:
    → [多阶段更新模式]
    更新当前 [ACTIVE] Stage 的内容
    写入 target.md + commit

  ELSE (正常模式，含首次定义):
    → [多阶段分析]
    评估目标复杂度:
      - 是否超出单次 plan→exec→merge 能力？
      - 是否有自然的阶段边界？
    IF 建议拆分:
      向用户输出建议（如 "建议拆为 3 阶段：1.基础认证 2.OAuth 3.RBAC"）
      用户确认/修改
      → agent 生成多阶段 target.md + 更新 .index.json stage
    ELSE:
      → agent 生成单阶段 target.md（简化格式）
    写入 target.md + 更新 .index.json + commit

2c. thinking-raw（不变）
```

### 2.4 Stage Advance 模式（status == stage-done）

```
/task-ai:target "下一阶段目标..."

1. 读取 target.md，定位下一个 [PENDING] Stage
2. 写入用户提供的目标到该 Stage 的 Objective/Requirements/Constraints
3. 标记切换：当前 Stage [PENDING] → [ACTIVE]
4. 更新 .index.json:
   - stage.current++
   - status → "planning"
   - completed_steps → 0
5. 归档: .plan.md → .plan-stage-<N>.md
        .plan-superseded.md → .plan-superseded-stage-<N>.md（如存在）
6. 清理: .bugfix/ 目录内容清空
7. Git commit: task-ai(<notebook>):target stage <N+1> defined
8. thinking-raw
```

### 2.5 State Transitions 更新

| Current Status | Result | Next Status | Checkpoint | Rationale |
|:---|:---|:---|:---|:---|
| `draft` | (updated) | `planning` | `post-target` | 不变 |
| `planning` | (updated) | `planning` | `re-plan` | 不变 |
| `executing` | (updated) | `executing` | `mid-exec` | 不变 |
| **`stage-done`** | **(updated)** | **`planning`** | **`stage-advance`** | **下一阶段目标已定义，进入规划** |

### 2.6 Git 更新

| Command | Type | Scope | Subject |
|:---|:---|:---|:---|
| `target` | `target` | `state` | `target update objective` |
| **`target`** | **`target`** | **`state`** | **`target stage <N+1> defined`** |

---

## 3. target.md 格式

### 3.1 设计原则

- **格式由 agent 生成**，用户不需要手写 Stage 结构
- **用户可读** — 打开 .target.md 能一目了然看到阶段划分、当前进度、各阶段目标
- **格式是 agent 内部协议** — SKILL.md 层面定义，用户通过对话式交互

### 3.2 单阶段（total: 1）

```markdown
## Objective
实现用户认证系统

## Requirements
- JWT token 认证
- 登录/登出 API

## Constraints
- 不引入新的数据库依赖
```

> 无需 `## Overall Objective` 或 `## Stage Advancement`。`total: 1` 时直接读取顶层 Objective/Requirements/Constraints。

### 3.3 多阶段格式（total > 1）

```markdown
## Overall Objective
构建完整的用户权限管理系统，从基础认证到细粒度权限控制。

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
> Stage 完成后由 agent 自动填写
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

### 3.4 格式规范

| 元素 | 规则 |
|------|------|
| `## Overall Objective` | 多阶段必须。跨阶段的总体目标 |
| `---`（水平线） | 阶段之间的分隔符 |
| `## Stage N: <name> [STATUS]` | STATUS：`COMPLETE` / `ACTIVE` / `PENDING` |
| `### Objective` | 本阶段目标（必须） |
| `### Requirements` | 本阶段需求（必须） |
| `### Constraints` | 本阶段约束（可选） |
| `### Results` | 阶段完成后由 agent 自动填写 |

**STATUS 规则：**
- 同时只能有一个 `[ACTIVE]` 阶段
- `[ACTIVE]` 之前的所有阶段必须是 `[COMPLETE]`
- `[ACTIVE]` 之后的阶段必须是 `[PENDING]`

### 3.5 格式检测（agent 内部）

```
if target.md contains "## Overall Objective" AND "## Stage 1:":
    多阶段 → 更新 stage.total/current
else:
    单阶段 → stage.total = 1, stage.current = 1
```

---

## 4. .index.json stage schema

### 4.1 字段定义

`init` 时即初始化 `stage` 字段。单阶段默认值：

```json
{
  "stage": {
    "current": 1,
    "total": 1,
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
| `stage.total` | integer | `1` = 单阶段，`>1` = 多阶段 |
| `stage.completed` | array | 已完成阶段记录 |
| `stage.completed[].stage` | integer | 阶段序号 |
| `stage.completed[].name` | string | 阶段名称 |
| `stage.completed[].completed_at` | string | 完成时间戳 |
| `stage.completed[].highlight_file` | string | 该阶段的 highlight 经验文件路径 |

> v1 不含 `advancement` 字段（v2 ai-auto 时引入）。v1 所有多阶段 notebook 均为 manual 模式。

### 4.2 缺省处理

已有 notebook 缺少 `stage` 字段时，各命令按 `{ current: 1, total: 1, completed: [] }` 缺省处理，无需迁移。

### 4.3 stage 字段初始化与升级

- **init 时**: 始终初始化 `stage`（默认 `total: 1`）
- **target 写入时**: 检测 target.md 格式 → 多阶段则更新 `stage.total/current`；单阶段则保持 `total: 1`
- **从单阶段升级**: agent 在 target 对话中建议拆分 → 用户确认 → agent 重写 target.md + 更新 stage

---

## 5. 状态机变更

### 5.1 新增状态：`stage-done`

非终端状态，表示"当前阶段已完成，等待用户定义下一阶段"。

**产生条件**：merge 成功时，`stage.current < stage.total`。

**如果 `stage.current == stage.total`**（含 `total: 1`）：merge 照常设置 `complete`。

### 5.2 stage-done 的状态转换

| Current Status | Command | Next Status | Condition |
|----------------|---------|-------------|-----------|
| `stage-done` | target | → `planning` | 用户定义了下一阶段目标 |
| `stage-done` | highlight | — (no change) | 阶段经验蒸馏 |
| `stage-done` | report | — (no change) | 阶段报告 |
| `stage-done` | cancel | → `cancelled` | 取消整个 notebook |
| `stage-done` | 其他命令 | ⊘ (rejected) | 不允许 |

### 5.3 state-matrix 变更

新增一行：

```
| `stage-done` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` | — |
```

修改 merge 列的 `executing` 行：

```
原来: executing + merge → complete / executing(conflict)
改为: executing + merge → complete / stage-done / executing(conflict)
                          ↑ current == total（含 total: 1）
                                    ↑ current < total
```

### 5.4 终端状态不变

终端：`complete` 和 `cancelled`。`stage-done` 非终端（→ planning 或 → cancelled）。

---

## 6. merge 变更

### 6.1 Phase 4 分支逻辑

merge SKILL.md 的 Phase 4（Post-Merge Finalization）增加分支：

```
On successful merge:

1. 读 .index.json 的 stage 字段
2. IF stage.current < stage.total:
     a. 更新 .index.json:
        - status → "stage-done"
        - stage.completed push { stage: current, name, completed_at, highlight_file: "" }
        - 保留 branch 和 worktree
     b. 更新 target.md:
        - 当前 Stage [ACTIVE] → [COMPLETE]
        - 填写 ### Results（从 .summary.md 提取成果摘要）
     c. Write .summary.md（阶段完成摘要）
     d. Git commit: task-ai(<notebook>):merge stage <N> completed
   ELSE (current == total，含 total: 1):
     a. 同现有逻辑：status → "complete"
     b. Git commit: task-ai(<notebook>):merge task completed
3. Write .auto-signal
```

### 6.2 .auto-signal

| 结果 | signal |
|------|--------|
| 成功（最终阶段/单阶段） | `{ "step": "merge", "result": "success", "next": "highlight", ... }` |
| 成功（阶段完成） | `{ "step": "merge", "result": "stage-done", "next": "highlight", ... }` |
| 冲突 | 不变 |

---

## 7. auto 循环变更

### 7.1 Phase 4 分支（v1 manual 模式）

```
Phase 4: Merge, Distillation & Report

merge ─── success ──→ highlight(complete) ──→ report → (stop)
  │          │        (current == total)
  │      stage-done ──→ highlight(complete) ──→ report → (stop)
  │      (current < total)     输出: "Stage <N> 完成。
  │                             请定义下一阶段目标后运行 /task-ai:auto"
  └── conflict → (stop)
```

> v1 无 Phase 5。stage-done 后 auto 统一 (stop)，等待用户手动 target → auto。

### 7.2 Result-Based Routing 新增

| step | result | next | Rationale |
|------|--------|------|-----------|
| merge | stage-done | highlight | 阶段完成，先蒸馏经验 |
| highlight | (distilled) | report | 蒸馏完成，生成阶段报告 |
| highlight | (skipped-idempotent) | report | 跳过蒸馏 |
| highlight | failed | report | 蒸馏失败，继续报告 |
| report | (generated) | (stop) | v1: 阶段报告后停止 |

### 7.3 Signal Validation 白名单新增

| Field | 新增允许值 |
|-------|----------|
| `result` | `stage-done` |

> `step`/`next` 不需新增 — highlight/report 已在白名单中。

### 7.4 Entry Point 更新

| Current Status | First Step |
|----------------|-----------|
| `stage-done` | highlight(complete) → report → (stop) |
| 其余 | 不变 |

### 7.5 Iteration 与 Context 管理

- **iteration 不重置** — 跨阶段继续累加，全局 max_iterations 仍有效
- **阶段推进时的 context**：target(stage-done → planning) 后重新运行 auto，新 session 从 `.summary.md` + 新 target 恢复上下文，天然无跨阶段 context 积累问题

---

## 8. plan 阶段感知

### 8.1 读取阶段信息

plan step 2（读取 .target.md）增加：

```
IF multi-stage mode:
  只读取当前 [ACTIVE] 阶段的 Objective/Requirements/Constraints
  同时读取前序 [COMPLETE] 阶段的 Results（作为已有能力的上下文）
  plan 范围限定在当前阶段
```

### 8.2 跨阶段经验复用

plan 的 library context 加载自然会读取前序阶段通过 highlight 沉淀的经验文件。前序阶段的实现/验证经验自动成为后续阶段 plan 的参考 — 这是 highlight 联动的直接收益。

---

## 9. highlight 联动

### 9.1 自动触发

阶段完成后 auto 调度 highlight(scope=complete)：

```
merge(stage-done) → highlight(complete, auto-complete) → report
```

auto-complete 模式（highlight §3.5）：
- 输入源为系统文件
- 执行 mtime 幂等检查
- 写入 `.experiences/<type>/<notebook>-stage-<N>-complete.md`

### 9.2 经验文件命名

| 场景 | 文件名 |
|------|--------|
| 阶段性蒸馏（stage-done） | `<notebook>-stage-<N>-complete.md` |
| 最终蒸馏（所有阶段完成） | `<notebook>-complete.md` |
| 阶段性 impl | `<notebook>-impl.md`（O_APPEND，所有阶段累积） |
| 阶段性 verify | `<notebook>-verify.md`（O_APPEND，所有阶段累积） |

### 9.3 highlight_file 回写

highlight(complete) 成功后，回写 `.index.json` 中 `stage.completed[current-1].highlight_file`。

### 9.4 最终蒸馏

最后一个阶段 merge → `complete` 时，highlight(complete) 读取所有阶段的 Results + 所有 `-stage-*-complete.md`，综合生成 `<notebook>-complete.md`。

---

## 10. 阶段推进中的文件管理

### 10.1 归档策略

| 文件 | 处理 | 理由 |
|------|------|------|
| `.plan.md` | → `.plan-stage-<N>.md` | 新阶段需全新 plan |
| `.plan-superseded.md` | 如存在 → `.plan-superseded-stage-<N>.md` | 同上 |
| `.analysis/` | 保留 | 历史评估对 check 有参考价值 |
| `.test/` | 保留 | 历史测试标准对 verify 有参考价值 |
| `.bugfix/` | 清空内容 | 上一阶段 bugfix 与新阶段无关 |
| `.notes/` | 保留 | 研究笔记可能跨阶段复用 |
| `.summary.md` | 被 report 已更新 | 新阶段 plan 会覆盖 |
| `.target.md` | 就地更新（标记切换） | 保留全部阶段定义 |
| `.index.json` | 更新 stage + 重置 completed_steps | — |

### 10.2 Git 分支

同一个 `task/<notebook>` 分支。merge 将当前阶段代码合并到 main，分支不删除，继续用于下一阶段。

### 10.3 manual 模式的用户工作流

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

| 动作 | Commit 消息 |
|------|------------|
| 阶段 merge | `task-ai(<notebook>):merge stage <N> completed` |
| 阶段性 highlight | `task-ai(<notebook>):highlight complete distillation` |
| 阶段推进（target） | `task-ai(<notebook>):target stage <N+1> defined` |
| Plan 归档 | 包含在阶段推进的 commit 中 |

Git log 呈现清晰的阶段边界：

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
```

---

## 12. 六维审查

### 12.1 正确性

| 审查点 | 评估 |
|--------|------|
| 状态机完整性 | ✅ `stage-done` 有退出路径（→ planning, → cancelled），无死锁 |
| 统一模板 | ✅ total: 1 等价单阶段；缺少 stage 字段时按 total: 1 缺省 |
| highlight 联动 | ✅ stage-done → highlight(auto-complete) + 幂等检查 + 三种 signal 均对齐 |
| target.md 解析 | ✅ 格式由 agent 生成，降低解析鲁棒性要求；agent 读取自己写的格式 |

### 12.2 安全性

| 审查点 | 评估 |
|--------|------|
| v1 manual only | ✅ 每个阶段推进都需用户介入，无自主目标生成风险 |
| iteration 限制 | ✅ 不重置，全局 max_iterations 有效 |

### 12.3 可靠性

| 审查点 | 评估 |
|--------|------|
| 阶段推进失败 | ✅ target 或归档失败时状态留在 stage-done，用户可手动处理后重试 |
| highlight 失败 | ✅ auto 继续到 report，经验缺失但流程可续 |
| 中途停止恢复 | ✅ stage-done 是持久状态，auto 重启后从 stage-done 入口恢复 |

### 12.4 性能

| 审查点 | 评估 |
|--------|------|
| 每阶段 overhead | ✅ 每阶段 merge + highlight + report，是必要开销 |
| context 管理 | ✅ v1 每阶段是独立 auto session，天然无 context 积累问题 |

### 12.5 架构

| 审查点 | 评估 |
|--------|------|
| 状态机扩展 | ✅ 仅新增 `stage-done`，不膨胀 |
| 命令改动范围 | ✅ 主要改 merge/auto/target，plan 只需读取阶段信息 |
| highlight 解耦 | ✅ 单向依赖，highlight 不知道 stage 概念 |

### 12.6 可维护性

| 审查点 | 评估 |
|--------|------|
| target.md 格式 | ✅ agent 生成 + 用户可读，双重满足 |
| stage 字段 | ✅ 嵌套在 `stage` 对象内，不污染顶层 |

---

## 13. 回归测试与红绿 TDD

递进式 target 的实施必须遵循 Red/Green TDD 流程 — 每项变更先写失败测试，再写最少量代码让测试通过，最后重构。

### 13.1 TDD 节奏

```
对于每个实施清单任务:
  1. Red   — 写测试描述预期行为 → 运行 → 确认失败
  2. Green — 写最少量变更 → 运行 → 确认通过
  3. Refactor — 在绿灯下清理一致性
```

> 递进式 target 涉及 SKILL.md 协议变更 + state.py 运行时代码。SKILL.md 部分用结构化验证脚本，state.py 部分用标准单元测试。

### 13.2 新功能测试（Red 先行）

| 功能模块 | 测试用例 | 验证点 |
|---------|---------|--------|
| target.md 格式 | `test-target-multistage-parse` | 多阶段格式解析正确（Overall Objective / Stage N 各节）；STATUS 标记识别（COMPLETE/ACTIVE/PENDING）；简化格式（无 Stage 头）解析为 total: 1 |
| .index.json stage | `test-index-stage-schema` | `stage` 字段始终存在（init 时创建）；结构完整（current/total/completed）；`total: 1` 时 completed 为空数组 |
| stage-done 状态 | `test-state-stage-done` | state.py 接受 `executing → stage-done` 转换；拒绝非法转换（如 `planning → stage-done`）；stage-done 为非终态（可转换到 `planning`） |
| merge 分支逻辑 | `test-merge-stage-branch` | 有后续 stage 时 → `stage-done`（非 `complete`）；无后续 stage（final stage）→ `complete`；stage-done 时不删除分支/worktree |
| auto 阶段路由 | `test-auto-stage-routing` | stage-done → highlight → report → (stop)；entry point 从 stage-done 正确路由 |
| plan 阶段感知 | `test-plan-stage-aware` | plan 读取当前 ACTIVE stage 的 Requirements/Constraints（非全局）；plan 输出引用 stage 序号 |
| highlight 联动 | `test-highlight-stage-naming` | stage-done 触发 highlight 时：使用 auto-complete 模式；经验文件名含 `-stage-<N>-` 前缀；final stage 无前缀（保持现有命名）；highlight_file 回写到 stage.completed 对应条目 |
| highlight 幂等 | `test-highlight-stage-idempotent` | 连续两次 stage-done → highlight 时，第二次因 mtime 幂等检查写 `(skipped-idempotent)` signal |
| target 主动分析 | `test-target-proactive-staging` | 复杂目标时 agent 建议多阶段拆分；简单目标时保持单阶段 |
| target stage-done 推进 | `test-target-stage-advance` | stage-done 上运行 target：Stage [PENDING] → [ACTIVE]、stage.current++、status → planning、plan 归档 |

### 13.3 回归测试（Green 保护）

确保 `total: 1`（单阶段）行为等价于升级前：

| 回归范围 | 测试用例 | 断言 |
|---------|---------|------|
| total:1 行为 | `regression-single-stage` | 简化格式 target.md 正常工作；stage.total=1 时所有命令行为与升级前一致 |
| total:1 缺省 | `regression-stage-missing` | 已有 notebook 缺少 `stage` 字段时，各命令按 total:1 缺省处理，不报错 |
| auto 全流程 | `regression-auto-single` | total:1 时 merge → highlight → report 路径不变；无 stage-done 中间状态 |
| merge 行为 | `regression-merge-single` | total:1 时 merge 直接 → complete（非 stage-done） |
| target 编辑 | `regression-target-edit` | 简化格式 target.md 编辑、保存、conversational define 不受影响 |
| state-matrix | `regression-state-transitions` | 现有全部状态转换路径不变（draft/planning/review/executing/complete/cancelled/blocked） |
| highlight 无 stage | `regression-highlight-no-stage` | total:1 的 highlight(complete) 不添加 stage 前缀；经验文件命名不变；幂等检查正常工作 |

### 13.4 实施顺序与 TDD 批次

按依赖关系分 4 批：

| 批次 | 任务 | TDD 要求 |
|------|------|---------|
| **Batch 0 — 基础兼容** | .index.json stage schema + state.py stage-done + target 多阶段格式 | Red: 新功能测试 + 单阶段回归测试全部就绪 → Green: 实现 → 回归全绿 |
| **Batch 1 — 流程集成** | merge stage-done 分支 + auto 路由 + plan 阶段感知 | Red: merge/auto/plan 测试就绪 → Green: 逐个实现 → 全绿 |
| **Batch 2 — 联动** | highlight stage 命名 + target 主动分析 + target stage-done 推进 | Red: 联动测试就绪 → Green: 实现 → 全绿 |
| **Batch 3 — 元数据** | state-matrix/git-details/signal whitelist 更新 | Red: 交叉引用一致性测试 → Green: 更新 → 全绿 |

---

## 14. 实施清单

| # | 任务 | 涉及文件 | 依赖 |
|---|------|---------|------|
| 1 | init 初始化 stage 字段（默认 total:1） | `skills/init/SKILL.md` | — |
| 2 | target 主动多阶段分析 + 多阶段格式生成 + stage-done 上的推进行为 | `skills/target/SKILL.md` | #1 |
| 3 | state.py 增加 stage-done 状态 + 合法转换 | `core/state.py` | — |
| 4 | merge 增加 stage-done 分支逻辑 | `skills/merge/SKILL.md` | #1, #3 |
| 5 | auto signal whitelist + routing + entry point + Phase 4 分支 | `skills/auto/SKILL.md` | #4 |
| 6 | plan 阶段感知（读取当前 ACTIVE stage） | `skills/plan/SKILL.md` | #2 |
| 7 | highlight 经验文件命名增加 stage 序号 + highlight_file 回写 | `skills/highlight/SKILL.md` | highlight 已实现 |
| 8 | state-matrix 增加 stage-done 行 + merge 列修改 | `commands/references/state-matrix.md` | #3 |
| 9 | git-details 增加阶段 commit 类型 | `commands/references/git-details.md` | — |
| 10 | 各命令 stage 缺省处理（缺少 stage 时按 total:1） | 所有读 .index.json 的 SKILL.md | #1 |

---

## 15. 与完整版设计的差异

| 完整版内容 | v1 处理 |
|-----------|---------|
| §6.1 Phase 5 stage-advance 自动推进 | 移除。stage-done 后统一 (stop) |
| §10 AI-auto 模式的阶段生成 | 移除整节 |
| §3.1 .index.json `advancement` 字段 | 移除。v1 均为 manual |
| §6.2 `stage-advance \| advanced \| plan` routing | 移除 |
| §6.2 `stage-advance \| manual-stop \| (stop)` routing | 移除（v1 无 stage-advance step） |
| §6.3 signal whitelist `advanced`/`manual-stop` | 移除 |
| §13 AI-auto 安全风险项 | 移除 |
| §10.2 阶段数量动态性 | 移除（v2 scope） |
| §8.3 stage-advance 中的 rebase | 移至 target(stage-done) 的推进逻辑中 |
