# Conversational Auto — 对话驱动的任务全流程

## 概述

将 task-ai 从"用户手动调度子命令"改为"对话驱动全流程"。前端只负责 `init`（创建 notebook），之后所有生命周期步骤由自然对话驱动 — Claude 读状态文件感知当前阶段，用户对话直接作用于当前阶段。可委托的子命令通过 subagent 执行以节省主会话上下文（详见 §Subagent 委托执行）。

## 核心原则

**不存在需要激活的 auto 模式。** notebook 的存在即上下文。Claude 每次对话时读取 `.index.json` + `.auto-signal` + `.target.md`，语义理解用户消息后执行当前阶段对应动作。

```
前端 UI: init（创建 notebook）→ .index.json status=draft
  │
  ▼
用户在对话窗说任何话
  │
  ▼
Claude 读状态文件 → 感知当前阶段
  │
  ▼
语义理解用户消息 → 执行阶段对应动作
```

## 四阶段流程

### 推进机制：Human-in-the-loop vs 自动审核

| 阶段 | 推进方式 | 原因 |
|------|---------|------|
| Phase 1 (Target) | **用户对话确认** | "做什么"只有用户能定，LLM 自审会自洽偏离 |
| Phase 2-4 (Plan/Exec/Final) | **LLM 自动审核** | "做得对不对"可通过 check(D1-D6) 客观评估 |

自动审核机制：
```
阶段交付物 + .target.md + .plan.md → check(D1-D6 多维打分) → 综合分 ≥ 阈值 → 自动推进
                                                            → 综合分 < 阈值 → 根据失分维度 replan + 重做
```

#### 阈值与重试上限

| 检查点 | 阈值 | 重试上限 | 超限行为 |
|--------|------|---------|---------|
| post-plan (Phase 2) | 0.70 | 3 次 replan | 停止，通知用户"计划反复未通过审核，需人工介入" |
| mid-exec (Phase 3 中间) | 0.60 | 2 次 fix | 停止当前步骤，通知用户 |
| post-exec (Phase 3 完成) | 0.75 | 3 次 fix/replan | 停止，通知用户 |
| pre-merge (Phase 4) | 0.80 | 不重试 | 不满足则回退到 Phase 3（retry_count 重置为 0，从 post-exec 失分维度对应步骤恢复） |

重试计数持久化到 `.auto-signal` 的 `retry_count` 字段，会话恢复时可读取。每个 stage 开始时（Phase 1 进入）`retry_count` 重置为 0，`delegation_failures` 清空（新 stage 是新上下文，旧失败记录不应继承）。

> **check 运行时错误处理：** check 本身执行失败（非低分，而是文件读取失败、state.py 异常等）不计入 retry_count，直接报错并停止当前步骤，等待用户介入。只有正常执行但分数低于阈值才触发重试。

### 交付物验收：三文件锚定审查

check 审核不是凭空评判交付物，而是以 `.target.md`（需求）和 `.plan.md`（设计）为锚定依据，逐维度比对：

| 维度 | 审查锚点 | 审查问题 |
|------|---------|---------|
| D1 正确性 | .target.md 需求条目 | 交付物是否实现了每条需求？有无遗漏？ |
| D2 安全性 | .target.md 安全约束 | 交付物是否满足需求中的安全要求？ |
| D3 可靠性 | .plan.md 边界条件标注 | 交付物是否覆盖了计划中标注的边界/异常场景？ |
| D4 性能 | .target.md 性能指标 | 交付物是否满足需求中的性能要求？ |
| D5 架构 | .plan.md 架构设计 | 交付物结构是否与计划的模块/接口设计一致？ |
| D6 可维护性 | .plan.md 模块划分 | 交付物是否按计划的模块组织？命名/约定是否一致？ |

这确保了审查有据可依——分数反映的是"交付物 vs 需求+计划"的偏差程度，而不是 LLM 的主观判断。

> **Phase 2 特例：二文件审查。** Phase 2 的交付物是 `.plan.md` 本身，此时 D3/D5/D6 审查锚点不引用 `.plan.md`（自引用无意义），而是审查计划的内在质量：D3 看边界条件是否充分标注、D5 看模块划分是否合理、D6 看步骤描述是否清晰。Phase 3/4 才是完整的三文件锚定。

> **已知局限：自我服务偏差。** check 由 LLM 执行，审核对象也由 LLM 产出，存在"自己评自己"的结构性偏差（倾向给高分）。v1 通过三文件锚定（将评判标准锚定在 .target.md 和 .plan.md 的客观条目上）缓解此问题。长期方案：引入外部验证信号（测试覆盖率、lint 结果、用户反馈）作为分数校准源。

用户在任何阶段都可以对话干预，但 Phase 2-4 不干预时全自动推进。

### 流程详情

```
Phase 1: Target Definition (status=draft) — 人在回路
  - 读 .target.md，空则引导用户描述目标
  - 用户对话直接 refine .target.md
  - 多阶段研究（O1→O2→O3）每阶段完成后：
    - 向用户展示研究结果 / [PROPOSED] 需求项
    - 等待用户对话确认或调整
    - 用户不确认就不推进
  - 用户确认所有需求后 → 门控检查：.target.md 无残留 [PROPOSED] 标记 → Phase 2
    - 若仍有 [PROPOSED] → 提示用户确认或移除后再推进

Phase 2: Planning (status=planning) — 全自动 + 可干预
  - 可选：research 收集技术参考（实现层面，非目标研究）
  - 执行 plan → check(post-plan)（此阶段无代码产出，不需要 verify）
  - check D1-D6 打分 ≥ 阈值 → 自动推进 Phase 3
  - 打分 < 阈值 → 根据失分维度自动 replan → 重新 check
  - 用户可干预："第 3 步不需要" → 修改 .plan.md，重新 check

Phase 3: Execution (status=executing) — 全自动 + 可干预
  - 执行 exec 逐步推进
  - 关键节点触发 verify → check(mid-exec)：遇到显著问题、或每 3 步定期检查（可按 .plan.md 步骤总数动态调整）
  - 全部步骤完成后 → verify → check(post-exec)
  - check 打分 ≥ 阈值 → 继续/推进 Phase 4
  - 打分 < 阈值 → 根据失分维度自动修复 → 重新 verify + check
  - 超过重试上限 → 停止，通知用户
  - 用户可干预："这个报错怎么回事" → 解释 + 修复，继续

Phase 4: Finalization (status=complete/stage-done) — 全自动
  - check(pre-merge, 阈值 0.80) → 不满足则回退 Phase 3
  - 满足后：merge → highlight → report → done
```

## 对话行为

### 对话即动作（无路由层）

不做意图分类或规则匹配。Claude 读当前阶段 SKILL.md + 用户消息，通过语义理解直接行动 — 如同结对编程中的人类搭档。

Phase 1 (Target) 示例 — 人在回路，必须用户确认：

| 用户说 | Claude 做 |
|--------|----------|
| "我要 WebSocket 认证，支持 token 刷新" | 写入/更新 .target.md |
| "还要向后兼容" | 追加需求到 .target.md |
| (O1 研究完成) "方向对的" | 确认 O1，推进 O2 |
| (O2 完成) "不要考虑降级方案" | 调整后确认 O2，推进 O3 |
| (O3 完成) "第 2 条改成 Y" / "OK 都确认" | [PROPOSED] → [CONFIRMED]，进入 Phase 2 |
| 静默 | **不推进** — 等待用户确认 |

Phase 2 (Planning) 示例 — 全自动，用户可干预：

| 用户说 | Claude 做 |
|--------|----------|
| "第 3 步不需要" | 修改 .plan.md，重新 check |
| "测试策略改成集成测试" | 更新 .plan.md 测试部分，重新 check |
| 静默 | 全自动：plan → check → 推进/replan |

Phase 3 (Execution) 示例：

| 用户说 | Claude 做 |
|--------|----------|
| "跳过迁移那步" | 调整执行策略，标记跳过 |
| "这个报错什么意思" | 解释 + 修复，继续 |
| "再跑一次测试" | 触发 verify |
| "继续" / 静默 | 继续下一步 exec |

Phase 4 (Finalization) 示例 — 全自动，通常无需干预：

| 用户说 | Claude 做 |
|--------|----------|
| "先不合并" | 暂停 merge，等待后续指令 |
| 静默 | 全自动：check(pre-merge) → merge → highlight → report → done |

### 显式干预（子命令覆盖）

用户通过两种等价方式干预：
- **对话输入**: `/task-ai:check`
- **前端 toolbar 按钮**: 点击 [check]

两者语义等价 — 都是对当前阶段的显式覆盖。

行为：
1. auto 让出控制权（当前步骤完成后，不在步骤中途让出）
2. 子命令独立执行完整流程
3. 子命令写 `.auto-signal` / 更新 `.index.json`
4. auto 下次被触发时（用户发消息/daemon continuation），读取最新状态文件
5. auto 根据新状态重新路由，从新状态恢复

注：auto 只在步骤间隙读取状态文件，不会在子命令执行中途读到中间态。这是自然的原子性保证 — 每个子命令是完整执行的，写完状态文件才算结束。

前端 toolbar 按钮不是"驱动 auto"，而是用户干预行为。

## 会话恢复

用户中断后回来说"继续"：

1. 读 `.auto-signal` → iteration, step, next, retry_count, delegation_failures
   - 若 `.auto-signal` 不存在 → 从 `.index.json` status 做 entry-point 路由（同现有 auto 状态机）
2. 读 `.index.json` → status, stage
3. 读 `.summary.md` → 上下文摘要
   - 若 `.summary.md` 不存在 → 读 `.target.md` + `.plan.md` 重建最小上下文
4. 从中断点恢复

### "静默继续"机制

Claude Code 是请求-响应模式，用户不发消息 Claude 不会主动执行。Phase 2-4 的"无干预自动推进"实际上是：
- **在同一轮对话中**，Claude 执行完一个子命令后，不等待用户输入，直接继续执行下一个子命令（单次请求内的连续执行）
- **跨轮对话时**，需要用户说"继续"或任何消息触发下一轮执行
- Backend daemon 可作为触发源：检测到步骤完成但无后续动作时，自动发送 continuation prompt
- **竞态防护**：daemon 发送 continuation 前检查 `.auto-signal` 的 `timestamp` 是否仍是触发时的值（CAS 语义）。若 timestamp 已变（用户消息已触发新执行），则放弃发送，避免双重触发

## 前端状态条

### 信号扩展

`.auto-signal` 新增字段：

```json
{
  "step": "exec",
  "result": "(step-3)",
  "next": "verify",
  "phase": "execution",
  "phase_progress": 0.45,
  "iteration": 3,
  "stage": { "current": 2, "total": 3 },
  "check_score": {
    "overall": 0.85,
    "d1_correctness": 0.90,
    "d2_security": 0.80,
    "d3_reliability": 0.85,
    "d4_performance": 0.88,
    "d5_architecture": 0.82,
    "d6_maintainability": 0.85
  },
  "retry_count": 1,
  "delegation_failures": ["verify@iter3"],
  "timestamp": "..."
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `phase` | string | `target` / `planning` / `execution` / `finalization` |
| `phase_progress` | float 0-1 | 当前阶段内的进度 |
| `stage` | object | `{ current, total }` 多阶段位置 |
| `check_score` | object | 最近一次 check 的 D1-D6 分项 + 综合分，无审核时为 null |
| `retry_count` | integer | 当前检查点已重试次数，超过上限则停止通知用户 |
| `delegation_failures` | string[] | subagent 失败记录（格式 `"cmd@iterN"`），用于避免重复委托 |

### UI 渲染

多阶段任务完整视图：

```
┌─ Stage 1/3: auth-backend ─────────────────── ✓ complete ── 0.92 ─┐
│  [target ✓] → [plan ✓] → [exec ✓] → [merge ✓] → [report ✓]     │
└──────────────────────────────────────────────────────────────────┘
┌─ Stage 2/3: auth-frontend ──────────────────── ● executing ──────┐
│  [target ✓] → [plan ✓] → [exec ●━━━━45%] → [merge] → [report]  │
└──────────────────────────────────────────────────────────────────┘
┌─ Stage 3/3: auth-integration ───────────────── ○ pending ────────┐
│  [target] → [plan] → [exec] → [merge] → [report]                │
└──────────────────────────────────────────────────────────────────┘
```

综合分点击展开六维明细：

```
0.92 ▼
  ┌────────────────────────────────┐
  │ D1 Correctness      0.95 ████▉│
  │ D2 Security          0.88 ████▍│
  │ D3 Reliability       0.90 ████▌│
  │ D4 Performance       0.92 ████▌│
  │ D5 Architecture      0.90 ████▌│
  │ D6 Maintainability   0.93 ████▋│
  └────────────────────────────────┘
```

### 数据流

- check 执行完毕 → 写 D1-D6 分项到 `.auto-signal` 的 `check_score`
- Backend daemon `fs.watch` 捕获 → WebSocket 推送
- 前端渲染：stage 列表 + 每 stage 进度条 + 综合分（可展开六维）

### 信号文件职责划分

`.auto-signal` 字段较多，按职责分组确保可维护性：

| 分组 | 字段 | 写入方 |
|------|------|--------|
| 进度 | `step`, `result`, `next`, `phase`, `phase_progress`, `iteration` | auto 每步写入 |
| 多阶段 | `stage` | auto 从 .index.json 同步 |
| 审核 | `check_score`, `retry_count` | check 完成时写入 |
| 委托 | `delegation_failures` | subagent 失败时追加 |
| 时间 | `timestamp` | auto 每步写入 |

所有字段共用一个文件（原子写入），但逻辑上分组清晰。若未来字段继续增长，可考虑拆分为 `.auto-signal`（进度）+ `.auto-check`（审核）+ `.auto-delegation`（委托）。

## 变更范围

### v1 改动项

| 组件 | 变更 |
|------|------|
| **auto SKILL.md** | 重写：去掉激活概念，定义对话驱动四阶段逻辑、阈值、重试上限 |
| **.auto-signal schema** | 新增 `phase`, `phase_progress`, `stage`, `check_score`, `retry_count`, `delegation_failures` 字段 |
| **check 子命令** | 扩展：输出 D1-D6 分项分数到 `.auto-signal`，支持三文件锚定审查 |
| **前端** | 新增多阶段状态条组件 + 六维分数展开面板 |
| **后端 API** | 扩展 WebSocket 推送：phase/progress/stage/check_score |
| **Signal 校验** | 白名单扩展所有新字段 |
| **Subagent 委托** | 动态判定机制 + 容错 fallback + delegation_failures 持久化 |

### 不变项

| 组件 | 状态 |
|------|------|
| 18 个子命令 SKILL.md | 不变，仍可独立调用 |
| .index.json 状态模型 | 不变 |
| state.py 状态转换 | 不变（`phase` 不是独立状态字段，而是从 `.index.json` status 派生：draft→target, planning/re-planning→planning, review/executing→execution, blocked→execution（停滞）, complete/stage-done→finalization） |
| Shell 脚本 (merge.sh 等) | 不变 |
| Backend daemon 核心 (fs.watch, stall detection) | 不变 |
| init（前端驱动） | 不变 |

### v1 不做

- 多任务排队/切换（仅支持单任务）
- 对话流实时可视化
- 前端 auto 按钮（不需要 — 对话本身即接口）

### v1.1 快速跟进

- 多任务排队/切换

## Subagent 委托执行

### 动机

对话驱动模式下主会话是长生命周期的，所有阶段 inline 执行会导致上下文快速膨胀。将可委托的阶段交给 subagent 执行，主会话只保留决策上下文。

### 委托判定：动态而非静态

SKILL.md 中的 `auto_delegatable` 和 `model_tier` 仅作为**默认提示**，实际委托决策由 auto 主会话根据上下文动态判定。

#### 判定因素与信号源

每个判定因素都有明确的**可读信号源**，LLM 不凭感觉判断：

| 因素 | 信号源 | 判定逻辑 | 示例 |
|------|--------|---------|------|
| **当前阶段** | `.index.json` status 字段 | 直接读取，不同 status 下同一子命令委托策略不同 | status=draft 时 research 不委托（O1/O2/O3 需对话）；status=planning 时 research 可委托 |
| **上下文依赖度** | ① 本轮对话是否有未持久化的决策（主会话内存 vs 文件）<br>② `.summary.md` 最后更新时间 vs 当前步骤间隔<br>③ 前序步骤是否修改了多个文件（`git diff --stat`） | 若存在未写入文件的决策、或 .summary.md 过期、或前序步骤改动面大 → 不委托 | exec 刚重构 5 个文件 + 对话中讨论了取舍 → verify 不委托；exec 改了 1 个文件 + 无对话讨论 → verify 可委托 |
| **任务复杂度** | ① `.plan.md` 当前步骤的描述长度和涉及文件数<br>② 测试类型标注（unit / integration / e2e）<br>③ `.target.md` 中对应需求的复杂度标记 | 步骤涉及文件 ≤2 且为 unit test → light；涉及文件 >5 或 integration/e2e → medium/heavy | verify 跑 lint → haiku；verify 跑 e2e 集成测试 → sonnet |
| **执行历史** | `.auto-signal` 新增 `delegation_failures` 数组 | 同一子命令 subagent 失败过 → 该子命令后续全部 inline | `"delegation_failures": ["verify@iter3"]` → verify 后续不再委托 |

`delegation_failures` 字段详见 §前端状态条 > 信号扩展。会话恢复时从 `.auto-signal` 读取，避免重复委托已知会失败的子命令。

#### 判定流程

```
auto 准备执行子命令时：
  │
  ├─ 读 SKILL.md auto_delegatable（默认提示）
  │
  ├─ 评估四因素：
  │   1. 当前阶段是否允许委托？
  │   2. 前序步骤是否产生了强上下文依赖？
  │   3. 本次执行的复杂度如何？→ 决定 model_tier
  │   4. 该子命令 subagent 是否失败过？
  │
  ├─ 综合判定 → 委托 / inline
  │
  └─ 若委托：动态选择 model_tier（可能与 SKILL.md 默认值不同）
```

#### 各子命令默认提示与动态覆盖场景

SKILL.md 中的 `auto_delegatable` 和 `model_tier` 作为默认提示值，auto 运行时可动态覆盖。

**heavy (→ opus)**

| 子命令 | 默认 delegatable | 默认 tier | 动态覆盖场景 |
|--------|-----------------|-----------|-------------|
| auto | — | heavy | 主会话本身，不涉及委托 |
| target | false | heavy | 始终 inline（对话交互） |
| research | true | heavy | target 阶段 O1/O2/O3 → inline（需对话上下文）；plan 阶段收集参考 → 可委托 |
| plan | false | heavy | 始终 inline（需决策上下文） |
| check | false | heavy | 始终 inline（需全局上下文做三文件锚定审查） |
| exec | false | heavy | 始终 inline（逐步执行需主会话上下文） |
| security | true | heavy | 通常可委托；涉及上下文相关的安全分析 → inline |

**medium (→ sonnet)**

| 子命令 | 默认 delegatable | 默认 tier | 动态覆盖场景 |
|--------|-----------------|-----------|-------------|
| verify | true | medium | exec 有复杂上下文依赖 → inline；简单 lint → tier 降为 light |
| merge | true | medium | 有复杂冲突历史 → inline |
| highlight | true | medium | 通常可委托 |
| report | true | medium | 通常可委托 |
| read | true | medium | 通常可委托 |
| annotate | true | medium | 通常可委托 |

**light (→ haiku)**

| 子命令 | 默认 delegatable | 默认 tier | 动态覆盖场景 |
|--------|-----------------|-----------|-------------|
| init | true | light | 前端已执行，auto 不涉及 |
| list | true | light | 只读查询，通常可委托 |
| cancel | true | light | 通常可委托 |
| summarize | true | light | 通常可委托 |
| library | true | light | 通常可委托 |

### 执行模型

```
主会话（长生命周期，保持决策上下文）
  │
  ├─ 不可委托阶段 → inline 执行（target, plan, check, exec）
  │
  └─ 可委托阶段 → subagent 执行
       │
       ▼
     ┌──────────────────────────────────┐
     │  Subagent (独立会话)              │
     │  输入: SKILL.md + .summary.md    │
     │        + .index.json + 相关文件   │
     │  模型: tier_to_model(model_tier)  │
     │  输出: .auto-signal + 产出文件    │
     └──────────────────────────────────┘
       │
       ▼
     主会话读取 subagent 产出 → 继续决策
```

### 模型映射

```
model_tier → model
  heavy  → opus
  medium → sonnet
  light  → haiku
```

### 容错

- Subagent 超时 → 主会话 fallback 为 inline 执行
  - 超时阈值按 model_tier 区分：light 2 分钟 / medium 5 分钟 / heavy 10 分钟
- Subagent 执行失败 → 主会话 fallback 为 inline 执行
- Subagent 产出文件缺失 → 主会话报警 + fallback
- Subagent 写入意外字段 → 主会话读取 `.auto-signal` 后只信任 subagent 职责范围内的字段（产出文件 + `result`/`next`），`phase`/`retry_count`/`check_score` 等由主会话自身维护

### 上下文节省

典型全流程 token 消耗对比：

```
全 inline:    target(对话) + plan + check + exec + verify*N + check*N + merge + highlight + report
              → 主会话上下文持续膨胀，可能触发多次 compaction

委托模式:     target(对话) + plan + check + exec + [verify→subagent] + check + [merge→subagent] + [highlight→subagent] + [report→subagent]
              → 主会话只保留决策路径，可委托阶段的输出以摘要形式回流
```

### 与自动审核的配合

```
exec 完成 → verify(subagent) → 结果回流主会话 → check(inline, post-exec D1-D6 打分)
  → 分数 ≥ 0.75 → check(inline, pre-merge D1-D6 打分)
    → 分数 ≥ 0.80 → merge(subagent) → highlight(subagent) → report(subagent) → done
    → 分数 < 0.80 → 回退 Phase 3，针对失分维度修复
  → 分数 < 0.75 → 根据失分维度 replan(inline) → 重新 exec(inline)
```

check 始终 inline 执行——它需要全局上下文做审核决策，不适合委托。

### 主会话 compaction 策略

对话驱动模式下主会话生命周期较长，Claude Code 会自动压缩早期消息。为确保 compaction 后审查仍有效：
- 三文件锚定审查不依赖对话历史，而是每次从磁盘读取 `.target.md` + `.plan.md` + 交付物文件
- auto 在关键里程碑（阶段转换、check 完成后）主动调用 summarize，将当前决策上下文持久化到 `.summary.md`
- compaction 发生后，主会话从 `.summary.md` 恢复决策上下文（同会话恢复流程）
