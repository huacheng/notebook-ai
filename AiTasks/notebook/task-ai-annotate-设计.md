# task-ai annotate 设计方案

> 批注交互系统：统一的文件批注 → prompt 流
> 日期：2026-02-28
>
> **⚠️ 历史文档** — `textOffset` + `before`/`after` 定位机制已被 `cursor`（源文件字符偏移）+ `selected` 双锚点取代。当前实现见 `task-ai/commands/references/annotation-format.md`。

---

## 1. 定位与目标

### 1.1 解决的问题

notebook-ai 的 task-ai 生命周期中，系统文件（`.target.md`、`.plan.md` 等）和一般文件（图书馆 PDF、代码等）都需要用户与内容交互的能力。当前存在以下缺陷：

1. **系统文件无交互通道** — `.working/` 下 dotfile 不可直接编辑，用户无法对需求/计划提出修改意见
2. **一般文件分析无锚点** — 用户查看 PDF/文档时，只能口头描述"第几段说了什么"，无法精确锚定
3. **前端基础设施已就绪但未接通** — `FileAnnotationCard`、`FileSelectionFloat`、`buildAnnotationText()` 等组件齐备，但缺少关键的"发送 → 执行"桥梁

### 1.2 核心设计决策

| 决策 | 说明 |
|------|------|
| **统一发送目标** | 所有批注（系统文件 + 一般文件）均发送到 Prompt 输入窗口 |
| **取消 `.tmp-annotations.json`** | 不再需要中间文件，批注直接序列化为 prompt 文本 |
| **系统文件只读** | `.working/` 下所有 dotfile 在前端禁用编辑模式，人工修改只走批注 |
| **绝对路径** | 前端构造 prompt 时注入绝对路径，与后端路径验证安全机制对齐 |
| **前端硬路由** | 前端判断 `isTaskSystemFile()` 后自动加 `/task-ai:annotate` 前缀，确定性 skill 调用；一般文件无前缀，Claude 对话式响应 |

### 1.3 两条流

```
┌─ 系统文件 (.working/ 下 dotfile) ───────────────────────────┐
│  用户批注 → 前端检测 isTaskSystemFile()                       │
│  → prompt = "/task-ai:annotate\n" + JSONL → Prompt 输入窗口  │
│  → Claude 收到 skill 指令 → 执行 task-ai:annotate 逻辑       │
│  → 分类 → 跨影响评估 → 执行变更 → 状态转换 → git commit      │
└──────────────────────────────────────────────────────────────┘

┌─ 一般文件 (PDF, 代码, 文档, ...) ───────────────────────────┐
│  用户批注 → 前端检测非系统文件                                │
│  → prompt = JSONL（无前缀）→ Prompt 输入窗口                  │
│  → Claude 对话式分析/研究/回答                                │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 前端改造

### 2.1 系统文件只读强制

**判定规则**：文件绝对路径包含 `/.working/` 且文件名以 `.` 开头 → 系统文件

```typescript
function isTaskSystemFile(absolutePath: string): boolean {
  // 路径中含 /.working/ 且文件名以点开头
  const segments = absolutePath.split('/');
  const workingIdx = segments.indexOf('.working');
  if (workingIdx < 0) return false;
  const filename = segments[segments.length - 1];
  return filename.startsWith('.');
}
```

**UI 行为**：

| 文件类型 | 编辑按钮 | 批注工具栏 | Send 按钮 |
|----------|---------|-----------|----------|
| 系统文件 | 隐藏 | ✅ 启用 | ✅ → Prompt |
| 一般文件 | 正常显示 | ✅ 启用 | ✅ → Prompt |

改动点：`FileViewer.tsx` 中 `canEdit` 判断增加 `&& !isTaskSystemFile(absolutePath)` 条件。

### 2.2 Prompt 文本格式：JSONL

#### 方案选型

经过四个候选方案（结构化 Markdown、XML 标签、紧凑键值、标签+三引号）的边界情况测试（markdown 表格 `|`、代码块 `` ``` ``、多行内容、引号 `"` 和箭头 `→`），最终选定 **JSONL**（JSON Lines）格式。

#### 选型理由

| 维度 | JSONL | 淘汰方案的问题 |
|------|-------|---------------|
| 解析可靠性 | **零碰撞** — JSON 标准转义覆盖所有字符 | Markdown/键值：`|` `>` `` ` `` 与内容冲突致命 |
| 多行支持 | **`\n` 转义** — 自然处理 | Markdown/键值：单行格式无法优雅处理多行 |
| 前端实现 | **`JSON.stringify()` 一行搞定** | 自定义格式需实现自定义序列化函数 |
| 格式维护 | **零** — JSON 是通用标准 | 自定义格式需定义语法 + 文档化 + 维护 |
| Claude 解析 | **原生支持** | XML：可靠但 token 开销大且不自然 |
| 多文件批量 | 每行 `file` 字段自然归组 | — |

唯一代价：prompt 中人类可读性不如 Markdown 方案。但批注的读者是 Claude 不是人——用户在前端 `FileAnnotationCard` UI 中审阅批注，不需要读 prompt 原文。

#### 格式规范

每条批注一行 JSON，字段定义：

```typescript
// 所有类型共有字段
interface AnnotationBase {
  file: string;      // 绝对路径
  type: 'insert' | 'delete' | 'replace' | 'comment';
  selected: string;  // 选中文本（锚点）
  before: string;    // 选中文本前的上下文（≤40 字符，用于精确定位）
  after: string;     // 选中文本后的上下文（≤40 字符，用于精确定位）
}

// 各类型特有字段
interface InsertAnnotation extends AnnotationBase {
  type: 'insert';
  content: string;   // 插入内容
}
interface DeleteAnnotation extends AnnotationBase {
  type: 'delete';
  // 无额外字段，selected 即为要删除的内容
}
interface ReplaceAnnotation extends AnnotationBase {
  type: 'replace';
  replacement: string; // 替换内容
}
interface CommentAnnotation extends AnnotationBase {
  type: 'comment';
  comment: string;   // 评论内容
}
```

**上下文字段说明**：

| 字段 | 用途 | 取值规则 |
|------|------|---------|
| `selected` | 用户选中的文本 | `window.getSelection().toString()`，max 1000 字符 |
| `before` | 选中文本**前方**的文本片段 | 从渲染文本中选区起点向前取 ≤40 字符；若在开头则为 `""` |
| `after` | 选中文本**后方**的文本片段 | 从渲染文本中选区终点向后取 ≤40 字符；若在末尾则为 `""` |

**关键设计：渲染文本空间定位**

`before` / `selected` / `after` 三者均取自**渲染后的可见文本**（`container.innerText`），而非 markdown 源码。这解决了渲染文本与源码不匹配的根本问题：

```
源码:    See **important** note about *performance*
渲染:    See important note about performance
选中:        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                      ↑ selected = "important note about performance"
before = "See "  ← 渲染文本中选区前方
after  = ""      ← 选区在末尾
```

如果从源码中 `indexOf("important note about performance")` 会返回 -1（找不到），因为源码包含 `**` 和 `*` 标记。而在渲染文本空间中，定位始终精确。

**定位机制：`textOffset`**

前端在创建批注时，通过 Range API 计算选区起点在渲染文本中的字符偏移，存入 `FileAnnotation.textOffset`。发送时用 `textOffset` 从 `container.innerText` 直接 `slice` 提取 `before`/`after`——不使用 `indexOf`，零匹配失败：

```typescript
// 创建批注时计算偏移
const preRange = document.createRange();
preRange.setStart(container, 0);
preRange.setEnd(range.startContainer, range.startOffset);
const textOffset = preRange.toString().length;

// 发送时用偏移提取上下文
const fullText = container.innerText;
const before = fullText.slice(Math.max(0, textOffset - 40), textOffset);
const after  = fullText.slice(textOffset + selected.length, textOffset + selected.length + 40);
```

**Claude 侧处理**：Claude 收到渲染文本上下文后，读取源文件，凭借对 markdown 语法的理解自行完成渲染文本→源码位置的映射。对于 `.target.md` / `.plan.md` 等常见格式（标题、列表、表格），映射无歧义。

`before` + `selected` + `after` 三者拼接构成唯一定位锚点，解决同文件内相同文本多次出现时的歧义。不使用行号，不使用源码匹配——渲染文本偏移量即为精确位置。

#### 示例

**单条发送**（Send 按钮）：

```jsonl
{"file":"/home/user/nb-workspaces/myproject/task-1/.working/.target.md","type":"replace","before":"Performance\n","selected":"Max response time: 500ms","after":"\nMax memory usage: 512MB","replacement":"Max response time: 200ms"}
```

> 注意 `before` 是渲染文本 `"Performance\n"`（不含 markdown 源码的 `## ` 和 `- `）。

**批量发送**（Send All 按钮，同文件多条）：

```jsonl
{"file":"/home/user/nb-workspaces/myproject/task-1/.working/.target.md","type":"replace","before":"Performance\n","selected":"Max response time: 500ms","after":"\nMax memory usage: 512MB","replacement":"Max response time: 200ms"}
{"file":"/home/user/nb-workspaces/myproject/task-1/.working/.target.md","type":"comment","before":"Features\nSupport real-time sync\n","selected":"Support offline mode","after":"\nMulti-device sync","comment":"离线模式的数据同步策略需要明确"}
```

**一般文件批注**（同格式，Claude 根据 `file` 路径路由）：

```jsonl
{"file":"/home/user/nb-workspaces/.library/docs/distributed-systems.pdf","type":"comment","before":"In distributed systems, the ","selected":"CAP theorem implies that...","after":" Therefore, partition tolerance","comment":"这个约束对我们的实时同步方案有什么影响？"}
```

#### 边界情况验证

**JSONL 格式边界**：

| Case | 内容 | 结果 |
|------|------|------|
| markdown 表格 | `"selected":"| Step | Action |"` | ✅ `|` 是 JSON 字符串普通字符 |
| 代码块 | `"selected":"` `` ```bash\ncurl ...\n``` `` `"` | ✅ `` ``` `` 是普通字符 |
| 多行+空行+`<` | `"selected":"Req\n\n1. ...\n3. < 200ms"` | ✅ `\n` 转义、`<` 是普通字符 |
| 引号和箭头 | `"selected":"Use \"strict\" for → val"` | ✅ `\"` JSON 标准转义 |

**渲染文本定位边界**：

| Case | 源码 | 渲染文本 | 结果 |
|------|------|---------|------|
| 加粗/斜体 | `**bold** and *italic*` | `bold and italic` | ✅ `textOffset` 精确定位，不依赖源码匹配 |
| 标题语法 | `## Performance` | `Performance` | ✅ 渲染文本无 `## ` 前缀，上下文正确 |
| 列表标记 | `- item one` | `item one` | ✅ 渲染文本无 `- ` 前缀 |
| 链接 | `[text](url)` | `text` | ✅ 渲染文本仅含可见文字 |
| 跨格式选区 | `**bold** and *italic*` → 选中 `bold and italic` | `bold and italic` | ✅ 渲染文本连续，`textOffset` 直接定位 |

### 2.3 `buildAnnotationPrompt()` 实现

替换现有 `buildAnnotationText()`，基于 JSONL 格式 + 渲染文本偏移定位：

```typescript
interface AnnotationPayload {
  file: string;
  type: 'insert' | 'delete' | 'replace' | 'comment';
  selected: string;
  before: string;        // 渲染文本上下文：选中文本前方 ≤40 字符
  after: string;         // 渲染文本上下文：选中文本后方 ≤40 字符
  content?: string;      // insert
  replacement?: string;  // replace
  comment?: string;      // comment
}

/** 序列化单条批注为 JSON 行（上下文从渲染文本提取） */
export function buildSingleAnnotationPrompt(
  ann: FileAnnotation,
  absolutePath: string,
  renderedText: string,   // container.innerText
  maxCtx: number = 40,
): string {
  const off = ann.textOffset;
  const end = off + ann.selected_text.length;
  const payload: AnnotationPayload = {
    file: absolutePath,
    type: ann.type,
    selected: ann.selected_text,
    before: renderedText.slice(Math.max(0, off - maxCtx), off),
    after:  renderedText.slice(end, end + maxCtx),
  };
  if (ann.type === 'insert')  payload.content = ann.content ?? '';
  if (ann.type === 'replace') payload.replacement = ann.content ?? '';
  if (ann.type === 'comment') payload.comment = ann.content ?? '';
  return JSON.stringify(payload);
}

/** 序列化所有批注为 JSONL（每条一行） */
export function buildAnnotationPrompt(
  annotations: FileAnnotation[],
  absolutePath: string,
  renderedText: string,
): string {
  return annotations
    .map(ann => buildSingleAnnotationPrompt(ann, absolutePath, renderedText))
    .join('\n');
}
```

`handleSendSingle` 和 `handleSendAll` 对应调用：

```typescript
// renderedText 从渲染容器获取；系统文件自动加 skill 前缀（硬路由）
const getRenderedText = useCallback(() => containerRef.current?.innerText ?? '', []);
const skillPrefix = isTaskSystemFile(absolutePath) ? '/task-ai:annotate\n' : '';

const handleSendSingle = useCallback((id: string) => {
  const ann = annotations.items.find((a) => a.id === id);
  if (ann) {
    onSendToPrompt(skillPrefix + buildSingleAnnotationPrompt(ann, absolutePath, getRenderedText()));
  }
}, [annotations, absolutePath, skillPrefix, getRenderedText, onSendToPrompt]);

const handleSendAll = useCallback(() => {
  onSendToPrompt(skillPrefix + buildAnnotationPrompt(annotations.items, absolutePath, getRenderedText()));
}, [annotations, absolutePath, skillPrefix, getRenderedText, onSendToPrompt]);
```

### 2.4 `FileAnnotation` 类型扩展

当前 `file_path` 存的是相对路径。需要增加绝对路径字段：

```typescript
export interface FileAnnotation {
  id: string;
  type: 'insert' | 'delete' | 'replace' | 'comment';
  file_path: string;        // 保持：workspace 内相对路径（持久化/展示用）
  absolute_path: string;    // 新增：绝对路径（构造 prompt 用）
  selected_text: string;
  content?: string;
  textOffset: number;       // 新增：选区起点在渲染文本中的字符偏移
  author: string;
  timestamp: string;
  updatedAt: number;
  highlightRects?: Rect[];
  capturedScale?: number;
}
```

`textOffset` 在创建批注时通过 Range API 计算（见 §2.2），发送时用于从 `container.innerText` 提取 `before`/`after` 上下文。不需要行号——渲染文本偏移量即为精确位置，前端无需注入 `data-line` 属性。

---

## 3. annotate 子命令改造

### 3.1 参数变更

**删除**：
- `annotation_file` 参数 — 不再读取 `.tmp-annotations.json`

**保留**：
- `task_file` — 从 prompt 上下文中的绝对路径获取
- `mode` — interactive / silent

**新增语义**：
- 批注内容从 prompt 上下文解析，而非从文件读取

### 3.2 按文件分层的状态转换

现有 SKILL.md 只按当前 status 做状态转换，不区分被批注文件。需要扩展为二维路由：`(当前 status, 文件类别) → 新 status`

#### 3.2.1 文件语义分层

```
需求层（影响最大）→ 计划层 → 评估层 → 方法论层 → 信息层（影响最小）
```

| 层 | 文件 | 批注语义 |
|---|---|---|
| **需求层** | `.target.md` | 改的是"做什么"，牵动全链路 |
| **计划层** | `.plan.md` | 改的是"怎么做"，影响执行但不动需求 |
| **评估层** | `.analysis/*.md`, `.test/*-criteria.md`, `.test/*-results.md` | 改的是"判断标准"或"质疑结论" |
| **方法论层** | `.type-profile.md` | 改的是"领域判断和验证方法" |
| **信息层** | `.summary.md`, `.bugfix/*.md`, `.notes/*.md` | 改的是"上下文信息" |

#### 3.2.2 需求层 — `.target.md`

影响最大，需求变更牵动计划、执行、验证全链路。

| 当前 status | 批注类型 | → 新 status | 后续动作 |
|---|---|---|---|
| `draft` | 任意 | = `draft` | 需求还在定义，正常迭代 |
| `planning` | Delete/Replace/Insert | = `planning` | 需求变了，plan skill 下次执行时自然读取新 target（见下方说明） |
| `planning` | Comment | = `planning` | 仅追加信息 |
| `review` | Delete/Replace/Insert | → `re-planning` | 计划已通过但需求变了 |
| `review` | Comment | = `review` | 仅追加信息 |
| `executing` | Delete/Replace/Insert | → `re-planning` | 最重的情况：执行中需求变更 |
| `executing` | Comment | = `executing` | 仅追加信息 |
| `re-planning` | 任意 | = `re-planning` | 已在 re-planning，继续修订 |
| `blocked` | Delete/Replace/Insert | → `planning` | 解除阻塞 |
| `complete`/`cancelled`/`stage-done` | 任意 | REJECT | 终态不可修改 |

> **`planning` 不跳 `re-planning` 的理由**：
> - `re-planning` 语义前提是"计划已存在且已审过"——`planning` 阶段计划可能还不存在或仅为草稿
> - plan skill 在 `re-planning` 下走 gap 分析模式（假设已有审过计划，只补缺口），而 `planning` 下走全量规划——跳转会导致 plan skill 错误降级
> - plan skill 每次执行都完整读取 `.target.md`，需求变化自然被吸收，无需状态转换来触发
> - `.auto-signal` 路由 `next: plan` 直接触发 plan 重新生成，避免绕行一次必然 fail 的 check
> - 与 state-matrix.md 保持一致：`planning` + annotate → `= planning`

**跨影响评估**：如果 `.plan.md` 已存在，需检查哪些计划步骤依赖被修改的需求内容。

#### 3.2.3 计划层 — `.plan.md`

改的是"怎么做"，不影响需求本身。

| 当前 status | 批注类型 | → 新 status | 后续动作 |
|---|---|---|---|
| `planning` | 任意 | = `planning` | 计划还在制定，正常修订 |
| `review` | Delete/Replace/Insert | → `re-planning` | 计划已评审，修订需重审 |
| `review` | Comment | = `review` | 仅追加信息 |
| `executing` | Delete/Replace/Insert | → `re-planning` | 执行中改计划，暂停重审 |
| `executing` | Comment | = `executing` | 仅追加信息 |
| `re-planning` | 任意 | = `re-planning` | 继续修订 |
| `draft` | 任意 | → `planning` | 首次批注进入 planning |
| `blocked` | Delete/Replace/Insert | → `planning` | 解除阻塞 |

**跨影响评估**：步骤间依赖链 — 删除/替换某步可能级联影响后续步骤。

#### 3.2.4 评估层 — `.analysis/*.md`, `.test/*.md`

改的是"判断标准"或"质疑评估结论"。

| 文件 | 批注类型 | 影响 |
|---|---|---|
| `.analysis/*.md` | Comment | 追加评估意见，不改状态 |
| `.analysis/*.md` | Delete/Replace | 推翻或修正评估结论 → 标记需要 re-check |
| `.test/*-criteria.md` | Delete/Replace/Insert | 测试标准变化 → 标记需要 re-verify |
| `.test/*-criteria.md` | Comment | 追加信息，不改状态 |
| `.test/*-results.md` | Delete/Replace | 质疑测试结果 → 标记需要 re-verify |
| `.test/*-results.md` | Comment | 追加信息，不改状态 |

**状态转换规则**：

| 当前 status | 修改类批注目标 | → 新 status |
|---|---|---|
| `executing` | `.analysis/*.md` | = `executing`（标记 re-check 在下次 check 时执行） |
| `executing` | `.test/*.md` | = `executing`（标记 re-verify 在下次 verify 时执行） |
| `review` | `.analysis/*.md` | → `re-planning`（评审结论被推翻） |

> 评估层的批注通常不直接触发 re-planning，而是在下次 verify/check 时重新评判。除非在 review 状态下推翻了评审结论。

#### 3.2.5 方法论层 — `.type-profile.md`

改的是领域判断和验证方法。

| 批注类型 | 影响 |
|---|---|
| Comment | 追加信息，不改状态 |
| Delete/Replace/Insert | 标记 `.type-profile.md` dirty → 下次 verify/check 重新读取 |

不直接触发状态转换，但影响后续阶段的方法论依据。

#### 3.2.6 信息层 — `.summary.md`, `.bugfix/*.md`, `.notes/*.md`

影响最小，仅改善上下文质量。

| 批注类型 | 影响 |
|---|---|
| 任意 | 不触发状态转换，纯上下文改善 |

### 3.3 Comment 批注的特殊语义

Comment 类型批注在所有文件层级上都**不触发状态转换**（见上表）。其行为统一为：

| 检测条件 | 输出 |
|---|---|
| 含 `?` 或疑问词 | 研究选中内容 → 写 `> 💬 ...` blockquote |
| 陈述句 | 插入 `> 📝 ...` blockquote |

Comment 永远不删除或修改已有内容——只追加。

### 3.4 跨影响评估矩阵

当修改类批注（Delete/Replace/Insert）作用于高层级文件时，需评估对低层级文件的影响：

```
.target.md 变更 → 检查 .plan.md 中是否有步骤引用被改内容
                 → 检查 .test/ 中是否有测试标准基于被改需求
                 → 影响级别: None / Low / Medium / High

.plan.md 变更   → 检查后续步骤依赖链
                 → 检查 .test/ 中是否有测试覆盖被改步骤
                 → 影响级别: None / Low / Medium / High

.analysis/*.md 变更 → 检查当前 verdict 是否被推翻
.test/*.md 变更     → 检查验证结果是否失效
```

跨影响响应（沿用现有 SKILL.md 设计）：

| 级别 | 处理 |
|------|------|
| None | 直接执行 |
| Low | 内联调整受影响内容 |
| Medium | 研究方案 → 执行 → 记录解决过程 |
| High — Interactive | 解释 + 草案 → 输出到屏幕 → 10 分钟超时 → 回退 Silent |
| High — Silent | 写入解释 + 草案到文件 → 等待下次批注 |

### 3.5 执行步骤（修订版）

1. **从 prompt 解析**批注 JSONL：文件绝对路径、批注类型、选中文本、上下文（`before`/`after`）、批注内容
2. **路径验证**：绝对路径必须在 `$NB_WORKSPACES_ROOT/` 下，无符号链接逃逸
3. **读取目标文件**
4. **读取 `.index.json`** — 验证非终态（`complete`/`cancelled`/`stage-done`）
5. **确定文件层级**（需求层/计划层/评估层/方法论层/信息层）
6. **读取上下文文件**（`.target.md` + `.plan.md` + `.test/` latest）
7. **分类**每条批注（Deferred confirmation / Plan content / Pure content / ...）
8. **跨影响评估**（基于文件层级 × 批注类型）
9. **执行变更**（写入目标文件，Comment 追加 blockquote）
10. **更新 `.index.json`**（基于 §3.2 二维路由表）
    - 需要 `re-planning` 时设 `phase: needs-check`
    - 其他情况清除 `phase`
11. **写 `.summary.md`**（反映批注变更的压缩上下文）
12. **highlight 思考捕获**（scope=thinking-raw，可选，medium-value）
13. **Git commit**：`task-ai(<notebook>):annotate annotations processed`
14. **Write `.auto-signal`**（`next` 按文件层级路由）：
    ```json
    { "step": "annotate", "result": "(processed)", "next": "<按层级>", "checkpoint": "post-annotate", "timestamp": "..." }
    ```
    | 批注目标文件层级 | 当前 status | `next` 值 | 原因 |
    |---|---|---|---|
    | 需求层 `.target.md` | `planning` | `plan` | 需求变了，plan 重新生成即可（plan skill 自动读取新 target） |
    | 需求层 `.target.md` | `review`/`executing` | `check` | 计划已审过，需求变更需重新审查计划对齐 |
    | 需求层 `.target.md` | `draft` | `(none)` | 仍在定义需求，无后续路由 |
    | 计划层 `.plan.md` | `planning` | `check` | 计划修订后需审查 |
    | 计划层 `.plan.md` | `review`/`executing` | `check` | 同上 |
    | 评估层 `.analysis/*` | any | `check` | 评估结论被质疑需重审 |
    | 评估层 `.test/*` | any | `verify` | 测试标准/结果变化需重新验证 |
    | 方法论层 `.type-profile.md` | any | `verify` | 方法论变更影响验证策略 |
    | 信息层 (`.summary.md` 等) | any | `(none)` | 纯上下文改善，不路由 |
    | 仅 Comment（任何文件） | any | `(none)` | 评论不触发后续流程 |
15. **生成执行报告**（输出到屏幕）

### 3.6 并发：auto 执行期间的锁竞争

annotate 需要获取 `.working/.lock`（见 `commands/references/concurrency.md`）。当 auto 正在运行（例如 exec 阶段持有锁），用户同时提交批注时：

| 场景 | 行为 |
|------|------|
| auto 持有锁，annotate 尝试获取 | **REJECT** — 报错提示"锁被 auto 会话持有" |
| auto 步骤间隙（锁已释放，尚未获取下一步） | annotate 正常获取锁执行 |
| annotate 持有锁，auto 尝试继续 | auto 检测到锁被占用，等待 annotate 完成 |

**当前策略：快速失败 + 用户重试**

- annotate 不排队、不等待 — 遵循锁协议的"REJECT, no retry"原则
- 用户收到拒绝后可选择：(a) 等待 auto 当前步骤完成后重试，(b) `/task-ai:cancel` 终止 auto 后批注
- auto 在每轮迭代间（检查 `.auto-stop` 处）自然释放锁，形成可用窗口

**设计理由**：排队机制（写 `.pending-annotations.json`、auto 轮间消费）增加复杂度且引入新并发问题（队列文件本身的读写竞争、批注时效性）。快速失败成本低——auto 单步通常分钟级，用户稍后重试即可。如后续实践表明竞争频繁，再升级为排队方案。

### 3.7 一般文件批注（非 task-ai 流）

一般文件的批注不经过 annotate 子命令，由 Claude 直接在对话中响应：

| 批注类型 | Claude 响应方式 |
|---|---|
| Comment | 分析/解释选中内容，回答问题 |
| Insert | 基于选中内容生成/补充新内容 |
| Replace | 用指定视角重新阐述选中内容 |
| Delete | 弱场景，标记忽略或分析"为何不需要" |

路由由前端决定：`isTaskSystemFile()` 为 true → prompt 加 `/task-ai:annotate` 前缀（skill 调用），否则 → 无前缀（Claude 对话式响应）。Claude 不需要判断路由——前端已做确定性分发。

---

## 4. SKILL.md 修订清单

对 `task-ai/skills/annotate/SKILL.md` 的具体修改项：

| 编号 | 修改项 | 说明 |
|------|--------|------|
| S1 | 删除 `annotation_file` 参数 | 不再读取 `.tmp-annotations.json` |
| S2 | 修改输入来源描述 | "从 prompt 上下文解析批注" |
| S3 | 状态转换表改为二维 | `(status, 文件类别)` → 新 status |
| S4 | 新增文件层级分类规则 | 需求层 > 计划层 > 评估层 > 方法论层 > 信息层 |
| S5 | Comment 不触发状态转换 | 所有文件层级一致 |
| S6 | 跨影响评估增加文件层级维度 | 高层文件变更 → 检查低层文件影响 |
| S7 | 步骤 1 改为 prompt 解析 | 替换原来的文件读取 |
| S8 | 删除步骤 13（清理 .tmp-annotations.json） | 不再有中间文件 |
| S9 | stage-done 状态增加说明 | REJECT，需先用 target 推进到下一阶段 |

## 5. references/annotation-format.md 修订清单

| 编号 | 修改项 | 说明 |
|------|--------|------|
| R1 | 删除 `.tmp-annotations.json` JSON schema | 不再有中间文件 |
| R2 | 写入 JSONL prompt 格式规范 | 字段定义（见 §2.2）、单条/批量示例、边界情况说明 |
| ~~R3~~ | ~~新增文件层级分类表~~ | ❌ 不做：格式文档职责是 wire format，文件层级分类是处理语义，属于 SKILL.md 职责。冗余复制增加维护负担 |
| R4 | 新增前端硬路由说明 | 系统文件 → prompt 加 `/task-ai:annotate` 前缀（skill 调用）；一般文件 → 无前缀（对话式响应）|

## 6. references/annotation-processing.md 修订清单

| 编号 | 修改项 | 说明 |
|------|--------|------|
| P1 | 删除 "Annotation File Format" 节 | 替换为 prompt 解析说明 |
| ~~P2~~ | ~~增加文件层级维度~~ | ❌ 不做：SKILL.md 已有完整五层分类 + 二维状态转换表，processing.md 再写一份是冗余复制，同一信息两处维护易产生不一致 |
| P3 | Comment 节强调"不改状态" | 统一语义 |

## 7. 关联文件修订清单

| 文件 | 修改项 |
|------|--------|
| `commands/task-ai.md` | Annotation Format 节指向新的 prompt 格式规范 |
| `commands/references/directory-convention.md` | 移除 `.tmp-annotations.json` 条目 |
| `commands/references/git-details.md` | `.gitignore` 移除 `**/.working/.tmp-annotations.json` |
| `commands/references/state-matrix.md` | annotate 列保持现值（= 计划层修改类转换，最激进路径），添加脚注：「annotate 转换取决于 (文件层级 × 批注类型)。矩阵显示计划层修改类转换。完整路由见 annotate SKILL.md §3.2」 |

## 8. 前端改动清单

| 文件 | 改动 |
|------|------|
| `types/fileAnnotations.ts` | `FileAnnotation` 增加 `absolute_path` + `textOffset` 字段；删除 `buildAnnotationText()`；新增 `buildSingleAnnotationPrompt()` + `buildAnnotationPrompt()`（JSONL 序列化，上下文从 `container.innerText` + `textOffset` 提取，见 §2.3） |
| `components/FileViewer.tsx` | `canEdit` 增加 `!isTaskSystemFile()` 判断；传递绝对路径给 `FileViewerRender` |
| `components/FileViewerRender.tsx` | 创建批注时用 Range API 计算 `textOffset`；`handleSendSingle`/`handleSendAll` 传入 `container.innerText` 作为 `renderedText`（见 §2.3） |
| `components/FileAnnotationCard.tsx` | 无改动（UI 组件不变） |
| `components/FileSelectionFloat.tsx` | 无改动（工具栏不变） |
| `utils/annotationHighlight.ts` | 无改动（坐标系统不变） |
| `hooks/useAnnotationPersistence.ts` | 无改动（持久化逻辑不变） |

## 9. 开放问题

| 编号 | 问题 | 状态 |
|------|------|------|
| ~~Q1~~ | ~~prompt 文本格式最终方案~~ | ✅ 已确定：JSONL（见 §2.2） |
| ~~Q2~~ | ~~行号注入方案~~ | ✅ 已关闭：不使用行号。`before` + `selected` + `after` 上下文三元组即为完备定位锚点，无需 DOM 注入 `data-line`，前端零改造 |
| ~~Q3~~ | ~~多文件批量批注的 prompt 组织~~ | ✅ 已解决：JSONL 每行含 `file` 字段，天然支持多文件混排 |
| ~~Q4~~ | ~~评估层批注"标记 re-check/re-verify"机制~~ | ✅ 已关闭：不需显式标记。文件内容变更本身即信号——`.auto-signal` 的 `next` 字段按文件层级路由（需求/计划层 → `check`，评估层 → `verify`/`check`，方法论层 → `verify`，信息层 → 无）。下游阶段读文件时自然感知变化 |
| ~~Q5~~ | ~~一般文件 Delete 批注的语义~~ | ✅ 已关闭：保留所有 4 种类型统一。Claude 根据文件类型解读语义——系统文件 Delete = 删除内容，一般文件 Delete = "排除/忽略此段" |

---

## 附录 A. Prompt 格式方案选型记录

评估了四个候选方案，以 `.plan.md` 中常见的 markdown 表格（含 `|`）、代码块（含 `` ``` ``）、多行内容、引号 `"` 和箭头 `→` 为边界测试用例：

| 方案 | 解析可靠性 | 多行支持 | token 效率 | 前端实现 | 结果 |
|------|:---:|:---:|:---:|:---:|------|
| A. 结构化 Markdown | ✗ | ✗ | ○ | 自定义 | ❌ `>` blockquote 与表格 `|`、代码块冲突 |
| B. XML 标签 | ✓ | ✓ | ✗ | 自定义+转义 | ❌ token 开销大，`<>&` 需转义 |
| C. 紧凑键值 | ✗ | ✗ | ✓ | 自定义 | ❌ `|` 分隔符与 markdown 表格致命冲突 |
| D. 标签+三引号 | ✓ | ✓ | ✓ | 自定义 | ○ 可行但需维护自定义格式语法 |
| **JSONL** | **✓✓** | **✓✓** | **○** | **`JSON.stringify()`** | **✅ 零碰撞、零自定义、标准格式** |
