# Auto 模式子阶段目标自动生成（v3）

> task-ai 递进式 target 升级：废弃 manual/ai-auto 区分，子阶段目标由 LLM 基于 convergence 差距自动生成
> 日期：2026-03-09
> 前置依赖：v2（convergence score + 方向门禁 + rollback + pending refinement buffer）

---

## 1. 核心变更

废弃 `stage.advancement`（`manual`/`ai-auto`）区分。auto 模式统一行为：

- **人工只参与 Overall Objective 的对话式 refine**
- **子阶段目标全部由 LLM 基于 convergence 差距 + 综合推理自动生成**
- **auto 成为默认交互入口**，子命令（target/plan/exec/check 等）保留为高级手动旁路

---

## 2. 改造后的 auto 四阶段循环

```
Phase 1: Overall Objective (status=draft) — 人工对话
  用户提供 Overall Objective → 对话式 refine
  → LLM 自决是否 research（不逐轮确认，一次性完成）
  → 自动生成 convergence baseline（R# 拆解）
  → 自动生成 Stage 1 目标 → planning

Phase 2: Planning (auto) — 不变
  plan → check(post-plan) → ...

Phase 3: Execution (auto) — 不变
  exec → check(mid-exec/post-exec) → ...

Phase 4: Acceptance + 自动推进 (auto)
  check post-exec ACCEPT → convergence gate:
    ├─ convergence > previous → ACCEPT
    │   → highlight → report → status → evolving
    │   → evolving 入口决策：
    │     ├─ convergence ≥ 0.95 → 停下等用户
    │     │   报告"目标基本达成"
    │     │   用户 --satisfy 结束 / 对话式 refine Overall Objective 继续
    │     └─ convergence < 0.95 → 自动生成下一子阶段目标 → planning → Phase 2
    │
    └─ convergence ≤ previous → ROLLBACK
        记录失败经验到 .experiences/*-failed.md
        → 重新生成子阶段目标（从 -failed.md 提取排除清单） → Phase 2
```

---

## 3. 子阶段目标生成机制

> **执行者**：auto 内联步骤（在 `evolving` 状态入口执行），调用 target 子命令写入 `.target.md` 和更新 `.status.json`。不是独立子命令。

### 3.1 输入（数据层）

| 输入 | 来源 | 用途 |
|------|------|------|
| 未满足 R# 集合 | `.convergence-baseline.md` + `.analysis/*-convergence.md` | cᵢ < 1.0 的 R# + 权重 |
| 覆盖度趋势 | `.analysis/*-convergence.md` 历史 | 进度方向 |
| 已完成阶段成果 | `.target.md` 各 Stage Results | 已有基础 |
| 失败排除清单 | `.experiences/<type>/*-failed.md`（语义化命名，frontmatter 按 notebook 过滤，见 §6 + §13） | 已失败方向 + 原因，硬约束排除 |
| 交付物状态 | `.deliverables/` + git diff | 当前代码/文件实际状态 |

### 3.2 推理（LLM 层）

```
1. 从未满足 R# 中按领域相关性聚类
2. 选择下一阶段要推进的 R# 子集：
   - 优先权重高(critical) + 覆盖度低的聚类
   - 考虑逻辑依赖（先基础后上层）
   - 考虑预期 convergence 收益
3. 对照失败排除清单：
   - 显式说明与已失败方向的区别
   - 如果所有可选方向都在排除清单中 → 停下报告用户
4. 可自主决定是否需要 research
5. 粒度控制：预估步骤数 ≤ max_iterations 可完成
```

### 3.3 输出

| 输出 | 内容 |
|------|------|
| Stage N+1 定义 | Objective / Requirements / Constraints |
| 预期覆盖 R# | 本阶段计划推进的 R# 列表 |
| 选择理由 | 为什么选这个方向（写入 `.notes/`） |
| 与失败方向区别 | 如有 rollback 历史，说明差异 |

### 3.4 生成后流程

子阶段目标生成后**直接进入 planning**，不等人工确认：

```
生成 Stage N+1 →
  更新 .target.md（追加新 Stage [ACTIVE]）→
  更新 .status.json（stage.current++, status → planning）→
  归档 .plan.md → .plan-stage-<N>.md →
  重置 completed_steps → 0 →
  Git commit: task-ai(<notebook>):target stage <N+1> auto-generated →
  进入 Phase 2 (Planning)
```

---

## 4. Phase 1：Overall Objective 定义

### 4.1 对话式 refine

用户在 Phase 1 通过自然对话定义和修改 Overall Objective。LLM 引导用户澄清目标，可多轮 refine。

### 4.2 Research

LLM 自主判断是否需要 research：
- 目标清晰、领域熟悉 → 跳过 research
- 目标模糊或领域陌生 → 自动完成 research，一次性呈现结果给用户 refine
- 用户可主动要求"先研究一下"

**废弃 O1→O2→O3 逐轮人工确认**。如触发 research，LLM 自主完成全流程，最终结果融入 Overall Objective 呈现给用户做一次性确认。

### 4.3 Convergence Baseline 生成

Overall Objective 确认后，由 **target** 子命令负责（沿用 v2 设计）拆解原子需求 → 生成 `.convergence-baseline.md`（R# 列表 + 权重）。auto Phase 1 对话确认后调用 target 写入 `.target.md` + 生成 baseline。此步骤不需人工介入。

### 4.4 Stage 1 自动生成

与后续子阶段一视同仁 — 用子阶段目标生成机制（§3）从 R# 中选择第一批推进目标，生成 Stage 1。

**Stage 1 输入降级**：Stage 1 时 §3.1 的多项输入为空（无已完成 Results、无 convergence 历史、无排除清单、无交付物），这是正常状态。LLM 从全量 R# 中直接选择第一批推进目标，跳过空输入项。

---

## 5. Convergence ≥ 0.95 停止后的交互

auto 停在 `evolving`，回到类似 Phase 1 的对话模式：

```
auto 报告:
  "convergence 0.96，目标基本达成。
   如满意: /task-ai:target --satisfy
   如需继续: 告诉我还需要什么"

用户响应路由:
  ├─ "--satisfy" / "完成了"
  │   → satisfied → merge（交付物合并到 main） → 最终 report → 停止
  ├─ "还需要 X" → 识别为 Overall Objective refine:
  │   更新 .target.md Overall Objective
  │   更新 .convergence-baseline.md（新增/修改 R#）
  │   convergence 因新 R# 下降（如 0.96 → 0.72）
  │   自动生成下一子阶段目标 → 继续循环
  └─ 沉默 → 保持 evolving，不自动推进

从 satisfied 状态 refine 重入:
  用户在 satisfied 状态发起 refine（"还需要 X"）→
    satisfied → evolving（状态回退）→
    更新 .target.md Overall Objective →
    更新 .convergence-baseline.md →
    convergence 下降 →
    自动生成下一子阶段目标 → planning → Phase 2
```

### 5.1 Merge 时机

**阶段之间不 merge** — 所有子阶段的交付物累积在 task 分支上。**仅在 `--satisfy` 后执行 merge**，将 `.deliverables/` 合并到 main。状态保持 `satisfied`（非终态，用户可 refine 重新进入）。唯一终态为 `cancelled`。

---

## 6. Rollback 后的显式排除机制

### 6.1 失败经验记录（单一数据源）

convergence gate 失败触发 rollback 时，highlight 记录失败经验到 `.experiences/<type>/<semantic>-failed.md`（语义化命名，见 §13）：

```markdown
---
semantic_name: rbac-before-auth
type: software
sources:
  - notebook: auth-system
    project: /home/ubuntu/project-a
    stage: 3
    date: 2026-03-09
---

# Failed: <方向描述>

- **方向**: <尝试的方向>
- **原因**: <失败原因分析>
- **Convergence 变化**: <previous> → <current>（如 0.65 → 0.58）
```

**不新增 `.failed-directions.md` 文件** — 子阶段目标生成时从 `.experiences/*-failed.md` 文件中按 frontmatter `sources.notebook` 过滤当前任务的排除清单，避免数据源重复。

### 6.2 重新生成约束

子阶段目标生成时，读取所有 `*-failed.md` 文件并按 frontmatter `sources.notebook` 过滤当前任务的失败记录，提取失败方向作为硬约束注入：

```
LLM 生成 prompt 中包含:
  "以下方向已失败，不可重复：
   - Stage 3: '先做权限再做认证'，原因：缺认证基础
   请说明新方向与上述失败方向的区别。"
```

如果所有可选方向都在排除清单中 → 停下报告用户，请求 refine Overall Objective 或手动指定方向。

---

## 7. auto 作为默认交互入口

### 7.1 路由机制

```
用户开始对话 → auto 读 .status.json → 根据状态路由:
  draft       → Phase 1（对话式定义 Overall Objective）
  planning    → Phase 2（plan → check）
  re-planning → Phase 2（plan → check，带 check 反馈）
  review      → Phase 3（post-plan 已通过，exec）
  executing   → Phase 3（exec → check）
  evolving    → Phase 4（convergence < 0.95 自动推进 / ≥ 0.95 等用户）
  satisfied   → 报告完成状态，用户可 refine → evolving → 自动生成子阶段 → planning
  blocked     → 报告阻塞原因，等用户干预
  cancelled   → 报告任务已取消（终态）

用户中途发消息 → 语义分类:
  refinement → pending refinement buffer → checkpoint 批处理
  question   → 回答 → 继续
  directive  → 调整执行 → 继续
```

### 7.2 子命令保留为手动旁路

用户可直接输入 `/task-ai:plan`、`/task-ai:check` 等绕过 auto 路由。适用于调试、单步控制、特殊场景。

---

## 8. 废弃项

| 废弃 | 原因 | 清理范围 |
|------|------|---------|
| `stage.advancement` 字段 | 不再区分 manual/ai-auto | `.status.json` schema, auto/SKILL.md, target/SKILL.md |
| O1→O2→O3 逐轮人工确认 | LLM 自决 research，一次性完成 | research/SKILL.md, auto/SKILL.md Phase 1 |
| `evolving` 等用户定义下一阶段 | 自动生成子阶段目标 | auto/SKILL.md Phase 4 |
| `[PROPOSED]` 标记门禁 | research 不再逐轮确认 | research/SKILL.md, auto/SKILL.md |
| `stage-done` 状态（v1 设计） | 已被 `evolving` 替代（v2） | 确认不在当前实现中 |

---

## 9. 人工介入点汇总

| 介入点 | 方式 | 时机 |
|--------|------|------|
| Overall Objective 定义 | Phase 1 对话 | 首次 auto 启动 |
| Overall Objective refine | 对话 + pending refinement buffer | 任意时刻（执行中异步缓冲，停下时直接对话） |
| 终止确认 | `--satisfy` 或 "完成了" | convergence ≥ 0.95 停下后 |
| 紧急干预 | 直接发消息 | 任意时刻（stop/skip/question） |

---

## 10. 安全兜底

| 机制 | 作用 |
|------|------|
| convergence 方向门禁 | 不逼近目标则 rollback |
| 失败经验排除 | rollback 后从 `-failed.md` 提取排除清单，不重复失败方向 |
| max_iterations | 单次 session 迭代上限 |
| convergence ≥ 0.95 自动停止 | 防止过度优化，停在 evolving 等用户 |
| 所有方向穷尽检测 | 排除清单覆盖所有方向时停下报告 |
| 不设 max_stages / 不设停滞检测 | 靠 convergence 自然收敛，后期增量小是正常的 |
| 跨 session 恢复 | `.status.json` + `.summary.md` + `.experiences/*-failed.md` 均持久化，新 session 可完整恢复上下文 |

---

## 11. 与 v2 设计的关系

本设计建立在 v2 基础上，v2 的以下机制**不变**：

| v2 机制 | 状态 |
|---------|------|
| Convergence Score 公式 | 不变 |
| 方向门禁 + 自动回滚 | 不变 |
| Pending Refinement Buffer | 不变 |
| `.auto-signal` 废弃 | 不变 |
| D1-D6 质量门禁 | 不变 |
| `.convergence-baseline.md` 格式 | 不变 |

本设计**新增/修改**：

| 变更 | 内容 |
|------|------|
| 废弃 `stage.advancement` | 统一 auto 行为 |
| 子阶段目标自动生成 | §3 完整机制 |
| Phase 1 research 自主化 | LLM 自决，不逐轮确认 |
| Stage 1 自动拆解 | 与后续子阶段一视同仁 |
| convergence ≥ 0.95 停止交互 | §5 对话模式 |
| 显式排除清单 | §6 rollback 防重复 |
| auto 默认入口 | §7 路由机制 |
| 经验文件语义化命名 | §13 highlight/library 改动 |

---

## 12. 涉及文件变更清单

### 12.1 auto（核心改动）

| 文件 | 变更要点 |
|------|---------|
| `auto/SKILL.md` | Phase 1：去掉 O1→O2→O3 逐轮确认，LLM 自决 research；Phase 4：evolving 入口自动生成子阶段目标（§3）；convergence ≥ 0.95 停下等用户（§5）；ROLLBACK 后从 `-failed.md` 提取排除清单重新生成；路由表补全（§7.1）；移除 `stage.advancement` 相关逻辑 |

### 12.2 target

| 文件 | 变更要点 |
|------|---------|
| `target/SKILL.md` | 移除 `stage.advancement` 字段处理；evolving 状态下接受 auto 内联调用写入子阶段目标；convergence ≥ 0.95 evolving 时接受用户对话式 refine Overall Objective |

### 12.3 research

| 文件 | 变更要点 |
|------|---------|
| `research/SKILL.md` | 移除 O1→O2→O3 三阶段逐轮确认流程；改为 LLM 自主完成全流程一次性输出；移除 `[PROPOSED]` 标记门禁逻辑 |

### 12.4 check

| 文件 | 变更要点 |
|------|---------|
| `check/SKILL.md` | 读取经验文件时适配语义化命名（§13）；post-exec convergence 评估不变 |

### 12.5 plan

| 文件 | 变更要点 |
|------|---------|
| `plan/SKILL.md` | 多阶段感知不变；读取经验文件时适配语义化命名 |

### 12.6 highlight

| 文件 | 变更要点 |
|------|---------|
| `highlight/SKILL.md` | 写入逻辑改为语义化命名（§13）：生成语义名称 → 三级确定性匹配（精确→索引→新建） → 追加或新建；维护 `.naming-index.md` |
| `highlight/references/scope-impl-spec.md` | frontmatter 模板增加 `semantic_name` + `sources` |
| `highlight/references/scope-verify-spec.md` | 同上 |
| `highlight/references/scope-complete-spec.md` | 同上；移除 `-stage-<N>-` 文件名前缀 |

### 12.7 library

| 文件 | 变更要点 |
|------|---------|
| `library/SKILL.md` | 索引和搜索适配语义化命名；按 frontmatter `sources.notebook` 过滤支持 |

### 12.8 schema 和引用文档

| 文件 | 变更要点 |
|------|---------|
| `commands/task-ai.md` | `.status.json` schema：移除 `stage.advancement` 字段 |
| `commands/references/progressive-target.md` | 更新：evolving 状态自动生成子阶段目标；移除 manual/ai-auto 区分 |
| `commands/references/state-matrix.md` | 确认 `evolving → planning` 转换路径；移除 `stage-done` 残留引用 |

### 12.9 其余 SKILL.md

| 文件 | 变更要点 |
|------|---------|
| `exec/SKILL.md` | 读取经验文件时适配语义化命名（如有引用） |
| `merge/SKILL.md` | 确认：仅 `--satisfy` 后触发 merge，阶段间不 merge |
| `report/SKILL.md` | 读取经验文件时适配语义化命名（如有引用） |
| `init/SKILL.md` | 移除 `stage.advancement` 初始化 |

---

## 13. 经验文件语义化命名（highlight/library 改动）

### 13.1 问题

当前经验文件以 notebook 名命名（`.experiences/<type>/<notebook>-impl.md`），导致：
- 不同项目的相似任务经验按**任务实例**隔离，无法跨项目复用
- 不同项目碰巧同名 notebook 可能意外冲突

### 13.2 方案

所有经验文件名从 notebook 名解耦，改由 LLM 根据经验内容定义**语义化名称**：

| 当前命名 | 改为 |
|---------|------|
| `<notebook>-impl.md` | `<semantic>-impl.md` |
| `<notebook>-verify.md` | `<semantic>-verify.md` |
| `<notebook>-complete.md` / `<notebook>-stage-<N>-complete.md` | `<semantic>-complete.md`（O_APPEND 聚合，stage 信息在 frontmatter sources 中）|
| `<notebook>-stage-<N>-failed.md` | `<semantic>-failed.md` |

- highlight 写入经验时，LLM 根据经验的核心知识领域选择语义名称
- 同一领域的经验自然聚合（不同 notebook 做 JWT 认证 → 同一个文件 O_APPEND）
- notebook 名记录在文件内的 frontmatter `sources` 中（溯源用），不体现在文件名

### 13.3 命名规则

```
语义名称生成:
  1. LLM 从经验内容提取核心知识领域关键词
  2. 组合为 kebab-case 名称（如 jwt-sliding-window-auth）
  3. 确定性匹配流程（三级）：
     a. 精确匹配：检查 .experiences/<type>/ 下是否有同名文件
        - 命中 → 追加到该文件（知识聚合）
     b. 索引匹配：读取 .experiences/<type>/.naming-index.md
        查找 semantic_name 列是否有语义等价条目（同义词、词序变体）
        - 命中 → 使用索引中的规范名称，追加到对应文件
     c. 无匹配 → 新建文件，同时追加条目到 .naming-index.md
  4. 名称应描述**知识领域**而非任务实例
     - 好: jwt-sliding-window-auth, react-virtual-scroll, sqlite-wal-concurrency
     - 坏: proj-a-auth, ticket-1234-fix, sprint-3-task
```

#### `.naming-index.md` 格式

```markdown
| semantic_name | aliases | file |
|---------------|---------|------|
| jwt-sliding-window-auth | jwt-auth-sliding-window, jwt-token-refresh | jwt-sliding-window-auth-impl.md |
| react-virtual-scroll | virtual-list-react, react-virtualized-scroll | react-virtual-scroll-impl.md |
```

- highlight 写入经验时维护此索引（O_APPEND 新条目）
- aliases 由 LLM 在新建时预生成 2-3 个常见变体，后续匹配失败但人工判定等价时可追加

### 13.4 Frontmatter 溯源

```yaml
---
semantic_name: jwt-sliding-window-auth
type: software
sources:
  - notebook: proj-a-auth-v2
    project: /home/ubuntu/project-a
    stage: 1
    date: 2026-03-09
  - notebook: api-gateway-auth
    project: /home/ubuntu/project-b
    stage: 2
    date: 2026-03-15
quality_status: provisional
---
```

### 13.5 对子阶段目标生成的影响

§3.1 失败排除清单的来源从 `<notebook>-stage-*-failed.md` 变为语义化命名。失败经验同样使用语义名称：

```
当前: .experiences/software/auth-system-stage-3-failed.md
改为: .experiences/software/rbac-before-auth-failed.md
```

frontmatter 中的 `sources` 记录来自哪个 notebook 的哪个 stage，子阶段目标生成时按 notebook 过滤即可获取当前任务的排除清单。
