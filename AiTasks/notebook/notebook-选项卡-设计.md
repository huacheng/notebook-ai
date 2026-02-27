# Notebook 交互选项卡设计

> 在 Notebook 中支持 AI 返回的交互式选项（如 AskUserQuestion），用户可直接在 UI 中选择，选择结果回传给模型继续对话。

## 背景

Claude CLI 的 `AskUserQuestion` 工具允许模型向用户提出选择题。在终端模式下，CLI 渲染交互式选项并等待用户输入。但在 notebook-ai 中，我们使用 `-p --dangerously-skip-permissions` 模式运行 Claude 进程，该模式会自动拒绝所有需要权限的工具调用（包括 AskUserQuestion），导致模型无法与用户交互。

## 实验发现

### AskUserQuestion 的 JSONL 协议格式

模型发出 AskUserQuestion 时，stream-json 输出为标准 `assistant` 消息，包含 `tool_use` content block：

```json
{
  "type": "assistant",
  "message": {
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01LDBbUxfoesSSfXD3xyQ5o9",
        "name": "AskUserQuestion",
        "input": {
          "questions": [
            {
              "question": "你更喜欢哪种编程语言？",
              "header": "编程语言",
              "options": [
                { "label": "Python", "description": "简洁优雅的语言" },
                { "label": "JavaScript", "description": "Web 开发首选" },
                { "label": "Rust", "description": "高性能系统编程" }
              ],
              "multiSelect": false
            }
          ]
        }
      }
    ]
  }
}
```

### 自动拒绝机制

在 `-p` 模式下，CLI 自动拒绝该工具调用，返回：

```json
{
  "type": "user",
  "message": {
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01LDBbUxfoesSSfXD3xyQ5o9",
        "content": "Answer questions?",
        "is_error": true
      }
    ]
  }
}
```

### 关键发现

1. AskUserQuestion 数据已经通过现有 pipeline 流入前端 — 作为 `tool_use` 类型的 CellOutput
2. `input.questions` 包含完整的结构化数据：问题文本、选项标签、描述、是否多选
3. `is_error: true` 的 tool_result 也会广播到前端，在 ToolRow 中显示为错误状态
4. 数据链路完整，无需修改服务端协议

## 设计方案

### 核心思路：纯前端检测 + 渲染 + 回传

在 CellOutput 组件中检测 `name === "AskUserQuestion"` 的 tool_use，将其渲染为可交互的选项卡 UI，用户选择后作为新 prompt 提交给模型。

### 数据流

```
Claude 进程 → JSONL tool_use(AskUserQuestion)
           → session.ts handleJsonlMessage → CellOutput { type: 'tool_use', name: 'AskUserQuestion', input: {...} }
           → WS broadcast → 前端 store → CellOutput 组件
           → 检测到 AskUserQuestion → 渲染 InteractiveOptions 组件（替代默认 ToolRow）
           → 用户点击选项 → 构造回答文本 → 自动创建新 prompt cell → 提交执行
```

### 服务端：拦截自动拒绝（可选优化）

当前 `-p` 模式自动拒绝 AskUserQuestion，模型会收到 `is_error: true` 的 tool_result。这意味着模型在拒绝后可能会尝试其他方式继续，而不会等待用户回答。

**第一阶段（MVP）**：不修改服务端。用户选择后以新 prompt 形式发送回答，模型通过上下文理解这是对之前选择题的回答。

**第二阶段（可选）**：在服务端拦截 AskUserQuestion 的 tool_use，暂停 Claude 进程，等待前端通过 WS 回传用户选择，再将 tool_result 注入 Claude 进程的 stdin。这需要修改 session.ts 的执行流程，复杂度较高。

### 前端组件设计

#### 1. InteractiveOptions 组件

位置：`packages/web/src/components/InteractiveOptions.tsx`（新文件）

```typescript
interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
}

interface InteractiveOptionsProps {
  input: AskUserQuestionInput;
  toolUseId: string;
  hasResult: boolean;      // tool_result 已到达（已被自动拒绝）
  onSelect: (answer: string) => void;
}
```

**渲染逻辑**：

- 每个 question 渲染为一个卡片区块
- header 作为区块标题
- question 作为提问文本
- options 渲染为可点击的选项按钮（类似 AskUserQuestion 的终端 UI）
- multiSelect=true 时支持多选 + 确认按钮
- 选择后 disable 所有按钮，显示已选状态

**状态管理**：

- `answered: boolean` — 是否已回答（防止重复提交）
- `selected: Set<string>` — 已选选项（multiSelect 用）
- 用户点击选项后调用 `onSelect(formattedAnswer)`

#### 2. CellOutput 修改

在 `CellOutput.tsx` 的 `ToolsPanel` 渲染逻辑中，对 `AskUserQuestion` 类型的 tool_use 做特殊处理：

```typescript
// 在 ToolsPanel 中区分交互式 tool 和普通 tool
const interactiveTools = items.filter(isAskUserQuestion);
const regularTools = items.filter(i => !isAskUserQuestion(i));
```

识别函数：
```typescript
function isAskUserQuestion(item: ToolItem): boolean {
  return item.name === 'AskUserQuestion' &&
         item.input?.questions &&
         Array.isArray(item.input.questions);
}
```

InteractiveOptions 默认展开显示（不折叠），位于 Tools 面板之上，视觉上更突出。

#### 3. 回传机制

用户选择后，构造回答文本并以新 prompt 提交：

```typescript
function formatAnswer(questions: Question[], selections: Map<number, string[]>): string {
  // 单问题单选：直接返回选项 label
  // 单问题多选：返回逗号分隔的 labels
  // 多问题：返回 "Q1: answer1\nQ2: answer2" 格式
}

// 调用 store 的 addCell + executeCell
onSelect={(answer) => {
  const cellId = addCell(answer);
  executeCell(cellId);
}}
```

### CSS 样式

使用现有设计系统变量，放在 `styles.css` 中：

```
.interactive-options          — 容器，bg: var(--bg-cell), border: var(--border-default)
.interactive-options-header   — 标题区，使用 header 文本
.interactive-options-question — 问题文本，color: var(--text-primary)
.interactive-options-grid     — 选项网格，gap: 8px
.interactive-option-card      — 单个选项卡片
  - 默认: bg: var(--bg-page), border: var(--border-default), cursor: pointer
  - Hover: bg: var(--color-primary-light), border-color: var(--color-primary)
  - 选中: bg: var(--color-primary-light), border-color: var(--color-primary), 左侧蓝条
  - 已回答: opacity: 0.6, pointer-events: none
.interactive-option-label     — 选项标签，font-weight: 600
.interactive-option-desc      — 选项描述，color: var(--text-secondary), font-size: 0.85em
.interactive-options-answered — 已回答状态的提示文字
```

## 涉及文件

| 文件 | 操作 |
|------|------|
| `packages/web/src/components/InteractiveOptions.tsx` | 新建 — 交互选项组件 |
| `packages/web/src/components/CellOutput.tsx` | 修改 — 检测 AskUserQuestion，渲染 InteractiveOptions |
| `packages/web/src/styles.css` | 修改 — 添加 .interactive-options 系列样式 |
| `packages/web/src/__tests__/interactiveOptions.test.ts` | 新建 — 组件单元测试 |

## TDD 测试计划

### 测试文件：`packages/web/src/__tests__/interactiveOptions.test.ts`

1. **isAskUserQuestion 识别** — 正确识别 AskUserQuestion tool_use，不误判普通 tool
2. **单选渲染** — 渲染问题文本、所有选项 label 和 description
3. **单选交互** — 点击选项后调用 onSelect，传入正确的 label 文本
4. **多选渲染** — multiSelect=true 时显示复选框和确认按钮
5. **多选交互** — 选择多个选项后点确认，传入逗号分隔的 labels
6. **已回答状态** — 选择后禁用所有选项，显示已选标记
7. **formatAnswer** — 单选/多选/多问题场景的格式化输出

### 回归测试

- 现有 CellOutput 测试不应被破坏
- 普通 tool_use 仍渲染为 ToolRow（不受影响）

## 限制与后续

1. **MVP 不做进程暂停**: 模型收到 is_error 后可能继续执行，用户选择以新 prompt 形式追加。这在大多数场景下足够用（模型会理解上下文）。
2. **不处理 markdown preview**: AskUserQuestion 支持 `options[].markdown` 字段用于代码预览，MVP 暂不渲染。
3. **不处理 annotations**: AskUserQuestion 的 `annotations` 字段（用户笔记）暂不支持。
