# highlight 设计方案

> task-ai 命令集新增 skill：经验蒸馏与知识沉淀引擎
> 日期：2026-02-26

---

## 1. 定位与目标

### 1.1 解决的问题

当前 task-ai 的知识沉淀存在三个缺陷：

1. **经验写入逻辑分散** — exec/verify/report/check/plan 各自内联实现图书馆写入，格式定义散落在 5 个 SKILL.md 中，修改协议需要同步改 5 处
2. **蒸馏只在终点发生** — 综合性经验蒸馏仅在 report（任务完成后）执行。中途停止的任务只有 provisional 碎片，无法得到综合性知识沉淀
3. **非生命周期经验无法捕获** — ad-hoc 对话中的调试经验、手动操作发现的模式没有沉淀路径

### 1.2 highlight 的双重角色

| 角色 | 说明 |
|------|------|
| **协议定义者** | 统一定义经验/思维类图书馆写入的格式、字段、质量模型、写入步骤。exec/verify/check/plan 在内联写入时遵循此协议 |
| **独立 skill** | 作为 auto 循环中的独立步骤执行综合蒸馏（complete）；可手动触发对任意 notebook 的蒸馏；可在无 notebook 的情况下捕获对话经验（adhoc） |

### 1.3 替代关系

highlight 替代 `light`。原 `light` 的快速内联编辑功能不再保留（该功能使用频率低，且与其他 skill 有大量重叠）。

---

## 2. 架构分层

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 0: Library Write Protocol                              │
│  (commands/references/library-write-protocol.md)              │
│  lock 序列 · changelog 格式 · 原子写 · index 更新规则        │
│  所有图书馆写入的基础设施层，不含业务逻辑                     │
├──────────────────────────────┬───────────────────────────────┤
│  Layer 1a: highlight         │  Layer 1b: 现有 skill         │
│  经验 + 思维业务层           │  外部知识 + 安全层             │
│                              │                               │
│  管辖目标:                   │  管辖目标:                     │
│  · .memory/.experiences/     │  · .memory/.references/        │
│  · .memory/.thinking/        │    ← research, read            │
│  · .memory/.type-profiles/   │  · .type-registry.md           │
│    (complete 蒸馏时同步)     │    ← research                  │
│  · quality_status 生命周期   │  · .plugin-registry.md         │
│                              │    ← research                  │
│                              │  · quarantine                  │
│                              │    ← security                  │
├──────────────────────────────┴───────────────────────────────┤
│  调用方 (内联执行 highlight 协议)                              │
│  高价值: target·research·plan·exec·check·verify               │
│  中价值: merge·security·annotate                               │
└──────────────────────────────────────────────────────────────┘
```

**依赖方向（单向向下）：**
- target/research/plan/exec/check/verify/merge/security/annotate → highlight 协议（引用）
- highlight → Library Write Protocol（调用）
- research/read → Library Write Protocol（调用，.references/ 写入不经 highlight）
- security → Library Write Protocol（调用，quarantine 写入不经 highlight）
- 无循环依赖

### 2.1 .type-profiles/ 分工边界

`.memory/.type-profiles/` 由两个 skill 写入，职责不同：

| skill | 写入时机 | 语义 |
|-------|---------|------|
| **research** | 类型发现（step 10.6）和后续精炼 | 知识采集：创建和更新类型档案 |
| **highlight** | complete 蒸馏时 | 经验回写：将任务级精炼同步回共享档案 |

两者都遵循 Library Write Protocol（acquire `.type-profiles/.lock` → 原子写 → release），通过 lock 保证并发安全。

---

## 3. Scope 定义与协议

highlight 定义 7 个 scope，覆盖所有经验/思维类图书馆写入。

### 3.1 scope=impl — 实现经验

**调用方**: exec（内联，step 9 全步骤完成后）
**独立执行**: 否

#### 触发条件

exec 全部 plan 步骤执行完成。

#### 内容提取

从 exec 当前上下文中提取：
- 关键实现决策及理由
- 使用的工具/框架模式
- 发现的 workarounds 和陷阱
- 与 plan 的偏差及原因

#### 写入规范

| 字段 | 值 |
|------|---|
| 目标文件 | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<notebook>-impl.md` |
| 写入方式 | O_APPEND + `---` 分隔符（文件不存在则创建） |
| lock | `.memory/.experiences/.lock` |
| quality_status | `provisional` |
| completeness | `partial` |
| source | `highlight-exec` |

#### Frontmatter

```yaml
---
quality_status: provisional
completeness: partial
source: highlight-exec
type: <from .index.json>
notebook: <notebook-name>
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2]
---
```

#### 内容结构

```markdown
## Implementation Experience — <notebook> (<date>)

### Decisions
- <decision 1>: <rationale>

### Patterns
- <pattern/technique discovered>

### Pitfalls
- <pitfall/workaround>

### Deviations from Plan
- <what changed and why>
```

#### 写入步骤

1. acquire `.memory/.experiences/.lock`
2. O_APPEND 写入 `<notebook>-impl.md`（文件头有 frontmatter 则追加在末尾，用 `---` 分隔）
3. acquire `.changelog.lock` → append: `<ts> | experience | .memory/.experiences/<type>/<notebook>-impl.md | quality_status:provisional | source:highlight-exec` → release `.changelog.lock`
4. update `<type>/.index.md`（覆盖匹配行或追加新行）
5. release `.memory/.experiences/.lock`

#### 故障隔离

> 内联调用失败不阻塞 exec 主流程。exec 的代码实现、状态转换、.auto-signal 写入不受影响。失败时 log warning 继续。

---

### 3.2 scope=verify — 验证经验

**调用方**: verify（内联，step 12）
**独立执行**: 否

#### 触发条件

verify checkpoint 完成且 checkpoint != quick。

#### 内容提取

从 verify 当前上下文中提取（类型自适应，非仅限 software）：
- 测试结果摘要（pass/fail/partial）
- 领域验证模式（什么验证方法对本类型有效）
- 阈值发现（合理的指标范围）
- 类型特定验证模式：
  - software: VFP 周期（测试框架效果、VH stub 技术、常见 VH→HS 失败原因、重构模式）
  - data-pipeline: schema 验证策略、数据质量阈值、采样方法
  - image/video: SSIM/PSNR 阈值、视觉对比方法、感知质量评估
  - audio/dsp: SNR 阈值、频谱分析方法
  - document: 结构完整性检查、内容验证方法
  - 其他类型: 根据 `.type-profile.md` 的 "Verification Standards" 提取适用的验证模式

#### 写入规范

| 字段 | 值 |
|------|---|
| 目标文件 | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<notebook>-verify.md` |
| 写入方式 | O_APPEND + `---` 分隔符 |
| lock | `.memory/.experiences/.lock` |
| quality_status | `provisional` |
| completeness | `partial` |
| source | `highlight-verify` |

#### Frontmatter

```yaml
---
quality_status: provisional
completeness: partial
source: highlight-verify
type: <from .index.json>
notebook: <notebook-name>
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2]
---
```

#### 内容结构

```markdown
## Verification Experience — <notebook> (<date>)

### Test Results
- <outcome summary>

### Effective Methods
- <what verification approaches worked>

### Thresholds
- <discovered metric ranges>

### VFP Patterns (software types)
- <VH stub techniques, CGG results, refactoring patterns>
```

#### 写入步骤

同 scope=impl（步骤 1-5），文件名和 source 字段不同。

#### 故障隔离

> 同 scope=impl。内联调用失败不阻塞 verify 主流程。

---

### 3.3 scope=thinking-raw — 原始思维捕获

**调用方（9 个命令，分两级）**:

| 级别 | 命令 | 调用点 | 说明 |
|------|------|--------|------|
| **高价值** | target | 目标分析时 | 目标拆解与约束推理 |
| **高价值** | research | 研究完成时 | 技术选型与可行性推理 |
| **高价值** | plan | step 24 | 方案设计与权衡推理 |
| **高价值** | exec | 步骤执行后 | 实现决策与问题解决推理 |
| **高价值** | check | step 16 | 质量判定与 ACCEPT/REPLAN 决策推理 |
| **高价值** | verify | 验证完成时 | 验证策略选择与结果分析推理 |
| **中价值** | merge | 冲突解决时 | 冲突解决策略推理（仅有冲突时） |
| **中价值** | security | 安全审计时 | 威胁模型与风险评估推理 |
| **中价值** | annotate | 标注处理时 | 交叉影响评估推理 |

**独立执行**: 否

#### 触发条件

调用方的执行过程涉及复杂推理或新颖领域判断（optional, encouraged）。高价值命令应积极捕获；中价值命令仅在推理复杂度明显高于常规时捕获。

#### 写入规范

| 字段 | 值 |
|------|---|
| 目标文件 | `$NB_WORKSPACES_LIBRARY/.memory/.thinking/raw/<notebook>-<caller>-<YYYY-MM-DD>.md` |
| 写入方式 | O_APPEND（无 lock，文件名唯一不冲突） |
| 索引 | O_APPEND `.memory/.thinking/raw/.index.md` |

#### Frontmatter

```yaml
---
source: highlight-<caller>
notebook: <notebook-name>
created_at: <ISO-8601>
quality:
  thinking: <H|M|L>
  justification: "<1-sentence reason>"
---
```

#### 内容结构

遵循 `library/references/quality-rubric.md` 的 H/M/L 自评标准。

```markdown
## CoT Capture — <caller> phase (<date>)

### Problem
<what was being reasoned about>

### Reasoning Chain
<key reasoning steps>

### Conclusion
<what was decided>

### Quality Self-Assessment
<H/M/L with justification>
```

#### 写入步骤

1. O_APPEND 写入 `<notebook>-<caller>-<YYYY-MM-DD>.md`
2. O_APPEND 追加一行到 `.memory/.thinking/raw/.index.md`
3. 无 lock 需求（文件名含 notebook + caller + date，天然唯一）

#### 故障隔离

> 同前。CoT 捕获是 optional 操作，失败不影响 plan/check 主流程。

---

### 3.4 scope=quality-update — 质量状态变更

**调用方**: check（内联，step 12）
**独立执行**: 否

#### 触发条件

| check 判定 | 动作 |
|-----------|------|
| ACCEPT (post-exec) | 同 notebook 的 `provisional` 经验文件 → `quality_status: verified` |
| REPLAN | 误导性经验文件 → `quality_status: invalidated` |

#### 写入规范

| 字段 | 值 |
|------|---|
| 目标文件 | `.memory/.experiences/` 下已有的 `-impl.md` 或 `-verify.md` |
| 写入方式 | frontmatter 字段覆盖（原子: 读 → 改 → .tmp → rename） |
| lock | `.memory/.experiences/.lock` |

#### 写入步骤（promotion）

1. acquire `.memory/.experiences/.lock`
2. 读取目标文件 frontmatter
3. 修改 `quality_status: provisional → verified`
4. 原子写（.tmp → rename）
5. acquire `.changelog.lock` → append: `<ts> | experience | <path> | quality_status:verified | promoted-by:check` → release
6. release `.memory/.experiences/.lock`

#### 写入步骤（invalidation）

同 promotion，但 `quality_status: provisional → invalidated`，changelog 标记 `invalidated-by:check`。

#### 关联操作 — failure_count 更新

check REPLAN 同时可能需要更新 `.memory/.references/` 的 `failure_count`。此操作**不属于 highlight 协议**，因为 `.references/` 归 research/read 管辖。check 直接按 Library Write Protocol 操作：

1. acquire `.memory/.references/.lock`
2. 读 frontmatter → `failure_count++`
3. 原子写
4. append changelog: `<ts> | reference | <path> | failure_count:<n>`
5. release `.memory/.references/.lock`

---

### 3.5 scope=complete — 综合蒸馏

**调用方**: 无（不内联）
**独立执行**: **是** — auto 循环中作为 merge 后的独立步骤；手动调用

这是 highlight 最核心的 scope，承载了当前 report step 13-15 的全部逻辑。

#### 触发条件与双模式

scope=complete 有两种执行模式，输入源和触发方式不同：

| 模式 | 触发方式 | 主输入源 | 辅助输入 |
|------|---------|---------|---------|
| **auto-complete** | auto 循环中 merge 后自动调度 | 系统文件（见下表） | 无（无对话上下文可用） |
| **manual-complete** | 用户运行 `/task-ai:highlight <notebook>` | **当前对话上下文**（用户指令、讨论、调试过程） | 系统文件（作为结构化补充） |

- auto-complete：agent 独立启动，无对话历史，只能从文件系统读取
- manual-complete：用户在对话中触发，对话上下文包含丰富的决策过程和推理细节，应作为首要蒸馏来源
- 手动触发时不限制 notebook 状态 — 任何状态都可以执行蒸馏（executing 中途、blocked、cancelled 均可）

#### 幂等检查（auto-complete 模式）

auto-complete 模式执行前检查是否有必要蒸馏：

```
input_files = [.target.md, .plan.md, .summary.md, *-impl.md, *-verify.md, ...]
latest_input_mtime = max(mtime(f) for f in input_files if exists(f))
existing_complete = .memory/.experiences/<type>/<notebook>-complete.md

if existing_complete exists AND mtime(existing_complete) >= latest_input_mtime:
    log "No new content since last distillation, skipping"
    write .auto-signal { step: "highlight", result: "(skipped-idempotent)", next: "report" }
    return
```

manual-complete 模式**不做幂等检查** — 用户显式触发即执行，因为对话上下文是新的输入。

#### 输入文件（auto-complete 的完整来源 / manual-complete 的辅助来源）

| 输入文件 | 用途 |
|---------|------|
| `.index.json` | 任务元数据（type, status, completed_steps） |
| `.target.md` | 目标定义 |
| `.plan.md` | 实现方案 |
| `.summary.md` | 任务上下文概要 |
| `.analysis/` | 评估历史（全部文件） |
| `.test/` | 验证标准与结果（全部文件） |
| `.bugfix/` | 问题历史（全部文件） |
| `.notes/` | 研究笔记（全部文件） |
| `.memory/.thinking/raw/<nb>-*.md` | 原始 CoT 记录 |
| `.type-profile.md` | 任务级类型档案 |
| 已有 provisional 经验文件 | `-impl.md`、`-verify.md`（如存在则吸收整合） |

#### 输出（三类写入）

**输出 A — 经验蒸馏**

| 字段 | 值 |
|------|---|
| 目标文件 | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type-segment>/<notebook>-complete.md` |
| 写入方式 | **覆盖**（.tmp → rename）— 最终版替代所有 provisional 版 |
| lock | `.memory/.experiences/.lock` |
| quality_status | `verified` |
| completeness | `complete` |
| source | `highlight-complete` |

对多 type（如 `data-pipeline|ml`）的每个 pipe segment 都写一份。segment 做 directory-safe transform（`:` → `-`）。

Frontmatter:

```yaml
---
quality_status: verified
completeness: complete
source: highlight-complete
type: <full type string>
notebook: <notebook-name>
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2, ...]
---
```

内容结构:

```markdown
# Experience: <notebook>

## Context
<task background, objective summary>

## What Worked
- <successful approaches, decisions, tools>

## What Didn't Work
- <failed attempts, dead ends, and why>

## Key Decisions
- <decision>: <rationale and outcome>

## Patterns Discovered
- <reusable patterns/techniques>

## Tools & Techniques
- <specific tools, configurations, commands that proved useful>

## Lessons Learned
- <high-level takeaways for future tasks>
```

**输出 B — Thinking Patterns 蒸馏**

| 字段 | 值 |
|------|---|
| 目标文件 | `$NB_WORKSPACES_LIBRARY/.memory/.thinking/patterns/<problem-type>.md` |
| 写入方式 | 覆盖（.tmp → rename） |
| lock | `.memory/.thinking/patterns/.lock` |

步骤：
1. 读 `.memory/.thinking/raw/<notebook>-*.md` 全部文件
2. 过滤 `quality.thinking: H` 的条目
3. 对每个识别出的推理模式：
   - acquire `.thinking/patterns/.lock`
   - write/update `patterns/<problem-type>.md`
   - update `.thinking/patterns/.index.md`（state: `draft` 新建 / `active` 已有）
   - release lock
4. 扫描 git REPLAN 历史：`git log --grep="REPLAN"` 在本 notebook 的提交中
5. 对每个 REPLAN，如果 `.plan.md` 引用了某个 pattern，increment 该 pattern 的 `failure_count`
6. changelog append: `<ts> | pattern | .memory/.thinking/patterns/<problem-type>.md | source:<notebook>`

**输出 C — Type-profiles 同步**

| 字段 | 值 |
|------|---|
| 目标文件 | `$NB_WORKSPACES_LIBRARY/.memory/.type-profiles/<primary-type>.md` |
| 写入方式 | merge 覆盖 |
| lock | `.memory/.type-profiles/.lock` |

步骤：
1. 读任务级 `.type-profile.md`
2. acquire `.type-profiles/.lock`
3. 如果共享 profile 已存在 → merge（以日期更新、置信度更高的信息为准）
4. 如果不存在 → 直接写入
5. append changelog
6. update `.type-profiles/.index.md`
7. release lock

#### 完整执行步骤

1. **读取** `.index.json` — 获取 type, status, notebook 元数据
2. **读取** 全部输入文件（见上表）
3. **吸收** 已有 provisional 经验（`-impl.md`、`-verify.md`），整合进最终蒸馏
4. **输出 A** — 经验蒸馏，per type segment 写入
   - 4a. `mkdir -p .memory/.experiences/<segment>/`
   - 4b. acquire `.memory/.experiences/.lock`
   - 4c. write `<notebook>-complete.md`（覆盖）
   - 4d. changelog append (per segment)
   - 4e. update `<segment>/.index.md`（覆盖匹配行或追加）
   - 4f. overwrite `<segment>/.summary.md`（蒸馏模式 + 条目索引表）
   - 4g. overwrite top-level `.memory/.experiences/.summary.md`
   - 4h. release `.memory/.experiences/.lock`
5. **输出 B** — Thinking Patterns 蒸馏
6. **输出 C** — Type-profiles 同步
7. **library maintain --compact**（仅检查 `.changelog` 是否超过 2000 行阈值）
8. **Git commit**: `task-ai(<notebook>):highlight complete distillation`
9. **Write .auto-signal**（仅 auto 循环内执行时写入）:
   ```json
   { "step": "highlight", "result": "(distilled)", "next": "report", "checkpoint": "", "timestamp": "..." }
   ```

---

### 3.6 scope=adhoc — 对话经验捕获

**调用方**: 无
**独立执行**: **是** — 纯手动触发，用于 auto 生命周期之外

#### 用法

```
/task-ai:highlight "<自然语言指令>"
```

示例：
- `/task-ai:highlight "总结下上面成功的操作经验"`
- `/task-ai:highlight "这次调试 WebSocket 连接的方法很有效，记录下来"`
- `/task-ai:highlight "记录这次 CSS 布局问题的解决思路"`

#### 执行协议

**Step 1 — 指令理解**

从用户自然语言中识别：
- 要总结的内容范围（哪些对话片段、哪些操作）
- 为什么有价值（解决了什么问题、发现了什么模式）
- 如果指令模糊（无法确定要总结什么）→ 向用户澄清后再继续

**Step 2 — Type 确定**

```
if 当前在 notebook 上下文中（CWD 有 .working/.index.json）:
    type = .index.json 中的 type 字段
elif 用户在指令中指定了领域:
    type = 用户指定的领域，匹配 .type-registry.md 已有类型
else:
    agent 从经验内容推断 type
    优先匹配 .type-registry.md 已有类型
    无法匹配 → type = "general"
```

**Step 3 — 经验提取**

回顾当前对话上下文，提取：
- 关键决策及理由
- 发现的模式和技巧
- 使用的工具/技术/命令
- 解决的问题和方法
- 踩过的坑和 workarounds

过滤掉：
- 临时性调试输出（仅对本次有用的日志）
- 未验证的猜测和推测
- 敏感信息（token、密码、路径中的用户名等）

**Step 4 — 内容结构化**

```markdown
## Context
<什么场景下产生的经验，问题背景>

## What Worked
- <成功的做法>

## What Didn't Work
- <失败的尝试及原因（如有）>

## Key Decisions
- <决策>: <理由>

## Patterns
- <可复用的模式/技巧>
```

**Step 5 — Frontmatter 生成**

```yaml
---
quality_status: provisional
completeness: partial
source: highlight-adhoc
type: <determined in step 2>
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2, ...]
---
```

**Step 6 — 文件名生成**

- 从经验内容中提取 2-4 个语义关键词（英文）
- 转换为 kebab-case slug（例: `websocket-reconnect-debugging`）
- 验证 slug 匹配 `[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*`
- 文件名: `<slug>-adhoc.md`

> 用户的自然语言输入不直接用于文件名。slug 由 agent 从经验内容语义生成。

**Step 7 — 写入**

1. `mkdir -p $NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/`
2. acquire `.memory/.experiences/.lock`
3. write `.memory/.experiences/<type>/<slug>-adhoc.md`（新建或覆盖同名文件）
4. acquire `.changelog.lock` → append: `<ts> | experience | .memory/.experiences/<type>/<slug>-adhoc.md | quality_status:provisional | source:highlight-adhoc` → release `.changelog.lock`
5. update `<type>/.index.md`（追加行）
6. update `<type>/.summary.md`（覆盖重写）
7. update top-level `.memory/.experiences/.summary.md`（覆盖重写）
8. release `.memory/.experiences/.lock`

**Step 8 — Git commit**

```
task-ai(<scope>):highlight adhoc experience captured
```

scope = notebook slug（如在 notebook 上下文中）或项目目录名（fallback）。

**Step 9 — 反馈**

向用户输出：已捕获的经验摘要、写入路径、type 分类。

#### 不写 .auto-signal

adhoc 模式不参与 auto 循环，不写 .auto-signal。

---

## 4. 现有 Skill 集成变更

### 4.1 exec/SKILL.md 变更

**当前 step 9（删除）：**
```
If all steps complete: write $NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<notebook>-impl.md
with implementation decisions, tool patterns, and workarounds discovered — quality_status: provisional.
Follow six-step Library Write Protocol...
```

**替换为：**
```
If all steps complete: 执行 highlight 协议 scope=impl —
  见 highlight/SKILL.md §3.1。从当前执行上下文提取实现经验，写入图书馆。
  内联调用失败不阻塞 exec 主流程。
```

### 4.2 verify/SKILL.md 变更

**当前 step 12（删除）：**
```
Write $NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<notebook>-verify.md with test outcomes,
domain verification patterns... Follow six-step Library Write Protocol...
```

**替换为：**
```
If checkpoint != quick: 执行 highlight 协议 scope=verify —
  见 highlight/SKILL.md §3.2。从当前验证上下文提取验证经验，写入图书馆。
  内联调用失败不阻塞 verify 主流程。
```

### 4.3 report/SKILL.md 变更

**当前 step 13（经验蒸馏）、step 14（thinking patterns）、step 15（type-profiles 同步）— 全部删除。**

**替换为：**
```
Step 13-15 由 highlight(scope=complete) 独立执行（在 auto 循环中位于 merge 和 report 之间）。
Report 不再执行图书馆蒸馏写入。

手动运行 report 时：如果用户需要蒸馏，应先运行 /task-ai:highlight <notebook>，
再运行 /task-ai:report <notebook>。
```

同时删除 step 18 的 `library maintain --compact`（已移至 highlight complete step 7）。

### 4.4 check/SKILL.md 变更

**当前 step 12 中 quality_status promotion/invalidation 逻辑（删除内联细节）。**

**替换为：**
```
执行 highlight 协议 scope=quality-update —
  见 highlight/SKILL.md §3.4。
  ACCEPT (post-exec): provisional → verified
  REPLAN: provisional → invalidated（如该经验是误导源）
  内联调用失败不阻塞 check 主流程。
```

**当前 step 12 中 failure_count 更新 — 不变。**

failure_count 操作的是 `.memory/.references/`，不属于 highlight 管辖。check 继续直接按 Library Write Protocol 操作。

**当前 step 16 CoT 写入（删除内联细节）。**

**替换为：**
```
执行 highlight 协议 scope=thinking-raw —
  见 highlight/SKILL.md §3.3。Optional, encouraged。
  内联调用失败不阻塞 check 主流程。
```

### 4.5 plan/SKILL.md 变更

**当前 step 24 CoT 写入（删除内联细节）。**

**替换为：**
```
执行 highlight 协议 scope=thinking-raw —
  见 highlight/SKILL.md §3.3。Optional, encouraged。
```

### 4.6 target/SKILL.md 变更

**新增 thinking-raw 捕获：**
```
目标分析（需求拆解、约束推理、优先级排序等）过程涉及复杂推理时：
  执行 highlight 协议 scope=thinking-raw —
  见 highlight/SKILL.md §3.3。Optional, encouraged（高价值）。
  内联调用失败不阻塞 target 主流程。
```

### 4.7 research/SKILL.md 变更

**新增 thinking-raw 捕获：**
```
研究完成时（技术选型推理、可行性分析、多方案比较等），若涉及复杂推理：
  执行 highlight 协议 scope=thinking-raw —
  见 highlight/SKILL.md §3.3。Optional, encouraged（高价值）。
  内联调用失败不阻塞 research 主流程。
```

> research 对 `.references/`、`.type-profiles/` 的写入不变 — 这些属于知识采集层，直接按 Library Write Protocol 操作。

### 4.8 merge/SKILL.md 变更

**新增 thinking-raw 捕获（仅冲突场景）：**
```
merge 遇到冲突并执行冲突解决时，若解决策略涉及复杂推理：
  执行 highlight 协议 scope=thinking-raw —
  见 highlight/SKILL.md §3.3。Optional（中价值，仅冲突时触发）。
  内联调用失败不阻塞 merge 主流程。
```

### 4.9 security/SKILL.md 变更

**新增 thinking-raw 捕获：**
```
安全审计中威胁模型构建、风险评估等涉及复杂推理时：
  执行 highlight 协议 scope=thinking-raw —
  见 highlight/SKILL.md §3.3。Optional（中价值）。
  内联调用失败不阻塞 security 主流程。
```

> security 的 quarantine 写入不变 — 独立于 highlight 协议。

### 4.10 annotate/SKILL.md 变更

**新增 thinking-raw 捕获：**
```
处理 plan 标注时，交叉影响评估涉及复杂推理：
  执行 highlight 协议 scope=thinking-raw —
  见 highlight/SKILL.md §3.3。Optional（中价值）。
  内联调用失败不阻塞 annotate 主流程。
```

### 4.11 不变的 Skill

| skill | 理由 |
|-------|------|
| research (.references/ 写入) | `.references/`、`.type-profiles/` 属于知识采集层，直接用 Library Write Protocol |
| read | 写 `.references/`（文档摄入层），直接用 Library Write Protocol |
| security (quarantine 写入) | quarantine 是安全强制行为，独立于 highlight |
| library | 基础设施层（maintain/search/list/status），不变 |
| init/summarize/cancel/list | 不涉及图书馆经验写入，也无复杂推理场景 |

---

## 5. Auto 循环变更

### 5.1 新流程

```
plan → verify → check(post-plan)
  → exec → verify → check(mid)
  → exec → verify → check(post-exec)
  → merge
  → highlight(complete)     ← 新增独立步骤
  → report(精简版)
```

仅在 merge → report 之间插入一个 highlight 步骤。其余流程不变。

### 5.2 Signal 路由变更

| 变更前 | 变更后 |
|--------|--------|
| merge signal: `{ next: "report" }` | merge signal: `{ next: "highlight" }` |
| — | highlight signal: `{ step: "highlight", next: "report" }` |
| report step 13-15 执行蒸馏 | report 不再蒸馏 |

### 5.3 highlight 非成功时的 auto 行为

**幂等跳过**（输入文件无更新）：
- 写 signal: `{ "step": "highlight", "result": "(skipped-idempotent)", "next": "report" }`
- auto 正常继续到 report

**执行失败**：
- 写 signal: `{ "step": "highlight", "result": "failed", "next": "report" }`
- auto 继续路由到 report（report 不依赖 highlight 的输出）
- report 照常生成 .report.md（只是没有最终蒸馏到图书馆）
- 用户可事后手动运行 `/task-ai:highlight <notebook>` 补做蒸馏

---

## 6. 状态转换

highlight **不改变 notebook 状态**。无论哪个 scope，.index.json 的 status 不受影响。

| scope | 状态影响 |
|-------|---------|
| impl | 无（exec 负责状态） |
| verify | 无（verify 负责状态） |
| thinking-raw | 无（调用方各自负责状态） |
| quality-update | 无（check 负责状态） |
| complete | 无（merge 已设置 complete） |
| adhoc | 无（无 notebook 生命周期） |

这与 `light` 的行为一致：不参与状态机。

---

## 7. SKILL.md 元数据

```yaml
---
name: highlight
description: "Experience distillation engine — defines the unified protocol for experience/thinking library writes, and provides independent complete distillation and ad-hoc experience capture. Replaces light."
model_tier: medium
auto_delegatable: true
arguments:
  - name: notebook
    description: "Notebook name for task-context distillation (e.g., auth-refactor)"
    required: false
  - name: description
    description: "Natural language description for ad-hoc experience capture (e.g., '总结下上面成功的操作经验')"
    required: false
---
```

**参数路由：**
- `highlight <notebook>` → scope=complete（独立执行，对 notebook 做综合蒸馏）
- `highlight "<description>"` → scope=adhoc（对话经验捕获）
- 无参数 → 如果在 notebook 上下文中，等同于 `highlight <当前notebook>`；否则报错

---

## 8. Git 约定

| 动作 | Commit 消息 |
|------|------------|
| complete 蒸馏 | `task-ai(<notebook>):highlight complete distillation` |
| adhoc 捕获 | `task-ai(<scope>):highlight adhoc experience captured` |

> 内联调用（impl/verify/thinking-raw/quality-update）不产生独立 commit。这些写入的 changelog 更新包含在调用方的 git commit 中（如 exec 的 commit 包含了 impl 经验写入的 changelog 变更）。

---

## 9. .auto-signal

| scope | signal |
|-------|--------|
| complete（成功） | `{ "step": "highlight", "result": "(distilled)", "next": "report", "checkpoint": "", "timestamp": "..." }` |
| complete（幂等跳过） | `{ "step": "highlight", "result": "(skipped-idempotent)", "next": "report", "checkpoint": "", "timestamp": "..." }` |
| complete（失败） | `{ "step": "highlight", "result": "failed", "next": "report", "checkpoint": "", "timestamp": "..." }` |
| adhoc | 不写 signal（不参与 auto） |
| 内联 scope | 不写 signal（由调用方写自己的 signal） |

---

## 10. 递进式 target 联动（预留）

本设计为未来的递进式 target（多阶段 notebook）预留了联动点：

- 当某个 stage 完成并 merge 后，auto 循环调度 `highlight(complete)` 蒸馏该阶段的经验
- highlight 不需要知道"阶段"概念 — 它只看当前 notebook 的文件状态做蒸馏
- 阶段推进逻辑由 auto/target 负责，highlight 只在被调度时执行

```
stage 1: plan→exec→merge → highlight(complete) → report → [stage advance]
stage 2: target→plan→exec→merge → highlight(complete) → report → [stage advance]
...
final:  → highlight(complete) → report → (stop)
```

此联动的前提是递进式 target 的状态机设计，将在后续设计文档中定义。

---

## 11. 六维审查总结

| 维度 | 判定 | 关键设计决策 |
|------|------|-------------|
| 正确性 | ✅ | highlight 管辖同质 scope（经验+思维），.type-profiles/ 双归属有明确分工边界；complete 双模式区分输入源（auto 读文件 / manual 用对话上下文） |
| 安全性 | ✅ | security 独立不依赖 highlight；adhoc 文件名由 agent 从语义生成不含用户原始输入；thinking-raw 无 lock 但文件名天然唯一 |
| 可靠性 | ✅ | 内联调用失败不阻塞调用方（全部 9 个调用方均有故障隔离）；complete 失败时 auto 继续到 report；auto-complete 幂等检查避免无效重复蒸馏 |
| 性能 | ✅ | 内联 scope 无额外步骤开销；thinking-raw 无 lock（O_APPEND + 唯一文件名）；auto-complete mtime 幂等检查 O(n) 文件 stat 仅几 ms |
| 架构 | ✅ | 三层分离（基础设施 / 经验业务 / 知识采集+安全），9 个调用方均单向依赖 highlight 协议；verify scope 类型自适应而非硬编码 software |
| 可维护性 | ✅ | 经验格式集中定义；9 个调用方 SKILL.md 简化为引用（~5 行）；高/中价值分级减少低价值 thinking 噪声 |

---

## 12. 回归测试与红绿 TDD

highlight 的实施必须遵循 Red/Green TDD 流程 — 每项变更先写失败测试，再写最少量代码让测试通过，最后重构。

### 12.1 TDD 节奏

```
对于每个实施清单任务:
  1. Red   — 写测试描述预期行为 → 运行 → 确认失败
  2. Green — 写最少量 SKILL.md / 协议变更 → 运行 → 确认通过
  3. Refactor — 在绿灯下清理格式/一致性
```

> highlight 是纯 SKILL.md 协议（无 runtime 代码），测试形式是**结构化验证脚本**而非单元测试。验证脚本检查文件结构、字段存在性、交叉引用完整性。

### 12.2 新功能测试（Red 先行）

每个 scope 在实现前先写对应的验证用例：

| scope | 测试用例 | 验证点 |
|-------|---------|--------|
| impl | `test-highlight-impl` | frontmatter 字段完整性（quality_status/completeness/source/type/notebook/created_at/topic_keywords）；内容结构含 Decisions/Patterns/Pitfalls/Deviations 四节；写入步骤含 lock acquire/release |
| verify | `test-highlight-verify` | 类型自适应：内容提取不硬编码 software；frontmatter source=highlight-verify；写入步骤同 impl |
| thinking-raw | `test-highlight-thinking-raw` | 9 个调用方（target/research/plan/exec/check/verify/merge/security/annotate）均在 SKILL.md 中引用 highlight §3.3；文件名格式 `<nb>-<caller>-<YYYY-MM-DD>.md`；无 lock（O_APPEND） |
| quality-update | `test-highlight-quality-update` | promotion 路径 provisional→verified；invalidation 路径 provisional→invalidated；原子写（.tmp→rename）；failure_count 不属于 highlight（check 独立操作） |
| complete | `test-highlight-complete-auto` | auto-complete 幂等检查逻辑（mtime 比较）；skipped-idempotent signal 格式；输入源为系统文件（不含对话上下文） |
| complete | `test-highlight-complete-manual` | manual-complete 无幂等检查；输入源含对话上下文；输出三件套（经验/thinking patterns/type-profiles）均写入 |
| adhoc | `test-highlight-adhoc` | 7 步协议完整（指令理解→type 确定→提取→结构化→frontmatter→文件名→写入）；slug 由 agent 生成非用户原始输入；不写 .auto-signal |

### 12.3 回归测试（Green 保护）

迁移过程中，确保现有行为不被破坏：

| 回归范围 | 测试用例 | 断言 |
|---------|---------|------|
| exec 主流程 | `regression-exec-no-block` | highlight impl 内联失败时，exec 状态转换（executing→...）不受影响；.auto-signal 正常写入 |
| verify 主流程 | `regression-verify-no-block` | highlight verify 内联失败时，verify checkpoint 结果正常产出 |
| check 主流程 | `regression-check-no-block` | highlight quality-update/thinking-raw 失败时，check ACCEPT/REPLAN 判定不受影响；failure_count 独立路径正常 |
| plan 主流程 | `regression-plan-no-block` | highlight thinking-raw 失败时，.plan.md 正常生成 |
| auto 路由 | `regression-auto-signal-chain` | merge signal `next: "highlight"` → highlight signal `next: "report"` → report 正常执行；三种 result（distilled/skipped-idempotent/failed）均正确路由到 report |
| Library Write Protocol | `regression-lwp-unchanged` | `.references/`、quarantine 写入路径不经 highlight；lock 序列、changelog 格式不变 |
| report 精简 | `regression-report-no-distill` | report 不再执行 step 13-15 蒸馏；.report.md 仍正常生成 |
| state-matrix | `regression-state-matrix` | highlight 列替代 light 列；所有状态行引用一致 |

### 12.4 交叉引用一致性测试

协议变更涉及 9 个调用方 SKILL.md + 多个 references 文件，需检测漂移：

```
test-xref-consistency:
  1. 扫描所有 SKILL.md，提取 "highlight/SKILL.md §X.Y" 引用
  2. 验证每个引用的章节号在 highlight/SKILL.md 中存在
  3. 验证 state-matrix.md 中 highlight 列的状态集合 = §6 定义的状态集合
  4. 验证 auto/SKILL.md signal whitelist 包含 highlight 的三种 result
  5. 验证 git-details.md 的 commit 模板与 §8 一致
  6. 验证 model-routing.md 的 highlight 路由与 §7 model_tier 一致
```

### 12.5 实施顺序与 TDD 批次

按依赖关系分 4 批，每批内部可并行：

| 批次 | 任务 | TDD 要求 |
|------|------|---------|
| **Batch 0 — 协议核心** | 创建 highlight/SKILL.md（§3 全部 scope 定义） | Red: 新功能测试全部就绪且失败 → Green: 写 SKILL.md → 新功能测试通过 |
| **Batch 1 — 调用方迁移** | exec/verify/check/plan 的内联写入迁移为 highlight 协议引用 | Red: 回归测试就绪（主流程不中断）→ Green: 逐个迁移 → 回归+新功能测试通过 |
| **Batch 2 — thinking-raw 扩展** | target/research/merge/security/annotate 新增 thinking-raw | Red: thinking-raw 交叉引用测试（9 调用方）→ Green: 逐个添加 → 测试通过 |
| **Batch 3 — 元数据更新** | references（state-matrix/git-details/model-routing）、plugin.json、task-ai.md | Red: 交叉引用一致性测试 → Green: 更新 → 测试通过 |

---

## 13. 实施清单

| # | 任务 | 涉及文件 |
|---|------|---------|
| 1 | 创建 `skills/highlight/SKILL.md` | 新建 |
| 2 | 删除 `skills/light/SKILL.md` + `skills/light/` 目录 | 删除 |
| 3 | 修改 `skills/exec/SKILL.md` step 9 → highlight impl + 新增 thinking-raw | 编辑 |
| 4 | 修改 `skills/verify/SKILL.md` step 12 → highlight verify + 新增 thinking-raw | 编辑 |
| 5 | 修改 `skills/report/SKILL.md` 删除 step 13-15, 18 | 编辑 |
| 6 | 修改 `skills/check/SKILL.md` step 12 → highlight quality-update + step 16 → highlight thinking-raw | 编辑 |
| 7 | 修改 `skills/plan/SKILL.md` step 24 → highlight thinking-raw | 编辑 |
| 8 | 修改 `skills/target/SKILL.md` 新增 thinking-raw 捕获 | 编辑 |
| 9 | 修改 `skills/research/SKILL.md` 新增 thinking-raw 捕获 | 编辑 |
| 10 | 修改 `skills/merge/SKILL.md` 新增 thinking-raw 捕获（冲突场景） | 编辑 |
| 11 | 修改 `skills/security/SKILL.md` 新增 thinking-raw 捕获 | 编辑 |
| 12 | 修改 `skills/annotate/SKILL.md` 新增 thinking-raw 捕获 | 编辑 |
| 13 | 修改 `skills/auto/SKILL.md` signal 路由（merge.next → highlight）+ 幂等 signal | 编辑 |
| 14 | 修改 `commands/task-ai.md` 子命令列表（light→highlight） | 编辑 |
| 15 | 修改 `commands/references/state-matrix.md`（light→highlight 列名） | 编辑 |
| 16 | 修改 `commands/references/git-details.md`（light→highlight commit type） | 编辑 |
| 17 | 修改 `commands/references/model-routing.md`（light→highlight 路由） | 编辑 |
| 18 | 更新 `plugin.json` + `marketplace.json` description（18→18 skills） | 编辑 |
| 19 | 可选：`.dev/validate.sh` 增加协议版本一致性 L2 检查 | 编辑 |
