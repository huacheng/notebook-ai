# Notebook AI

[English](README.md)

AI 驱动的 Notebook 工作空间 — 类似 Jupyter Notebook，但以 Claude 或 Gemini 作为执行引擎。

![UI 预览](ui-redesign-preview.png)

## 功能特性

- **AI Notebook** — 多轮对话式 Cell，实时流式输出思考过程、文本和工具调用
- **多 Agent 支持** — Claude（Sonnet / Haiku / Opus）和 Gemini，按会话切换
- **项目与工作区** — 每个 Notebook 运行在独立的 Git Worktree 中，拥有独立分支
- **自动 Git 提交** — 每次 Cell 执行后自动提交变更并记录 Diff
- **文件管理** — 上传、浏览、编辑和批注文件（文本、PDF、DOCX、XLSX、PPTX、图片）
- **Git 历史** — 可视化分支图、提交 Diff 查看器、分支过滤（全部通过 WebSocket）
- **分屏视图** — 文件查看器与 Notebook 并排编辑，Tab 栏同步拆分
- **共享知识库** — 跨 Notebook 的知识库，包含系统管理的引用和用户导入内容
- **Slice 视图** — AI 生成的 Notebook 会话结构化摘要
- **插件市场** — 从 GitHub 托管的市场安装和管理插件
- **Token 认证** — 可选的 Bearer Token 认证，带暴力破解防护
- **导出** — 支持导出为 HTML 或 zip 包

## 架构

```
notebook-ai/
├── packages/
│   ├── web/        # React 19 + Vite 前端
│   ├── server/     # Express 5 + SQLite 后端
│   └── shared/     # Zod Schema 与 TypeScript 类型
├── task-ai/        # task-ai 插件（开发目录）
└── plugins/        # 发布用插件产物
```

### packages/web

React 19 单页应用，三栏布局：项目侧边栏、Notebook 内容区、交付物面板。

| 技术 | 用途 |
|---|---|
| React 19 | UI 框架 |
| Vite 6 | 开发服务器与打包工具 |
| Zustand 5 | 状态管理（6 个可组合 Slice） |
| react-markdown | Markdown 渲染，支持 GFM + 语法高亮 |
| react-pdf / docx-preview / xlsx | PDF、DOCX、XLSX 文件查看器 |
| Tiptap | 富文本文件编辑器 |
| WebSocket | 实时流式传输与会话多路复用 |

**UI 布局：**

```
┌─────────────── 工具栏（模型选择、连接状态）──────────────────┐
├─ 侧边栏 (272px) ─┬─ 主内容区 ─────────────────┬─ 右侧面板 ─┤
│ L1: 项目列表     │  Notebook 标签页            │ 交付物     │
│ L2: 文件浏览器   │  ┌─ 状态栏 (sticky) ────┐   │ 文件区域   │
│ ── 分隔线 ──     │  │  Cell 列表            │   │            │
│ 知识库区域       │  │  ...流式输出...       │   │            │
│                  │  └─ 输入栏 (sticky) ────┘   │            │
└──────────────────┴─────────────────────────────┴────────────┘
```

面板支持拖拽调整大小。主内容区可渲染：Notebook、文件查看器、Git 历史面板、插件管理器或欢迎页。分屏模式下（文件 + Notebook），Tab 栏拆分为左侧（文件 Tab）和右侧（Notebook + Git Tab）两组，与下方面板对齐。

### packages/server

Express 5 HTTP + WebSocket 后端。无需外部数据库 — 使用内嵌 SQLite（better-sqlite3，WAL 模式）。

| 技术 | 用途 |
|---|---|
| Express 5 | REST API |
| ws | WebSocket 服务器 |
| better-sqlite3 | 内嵌数据库 |
| simple-git | Git 操作 |
| multer | 文件上传 |

**核心模块：**

| 模块 | 职责 |
|---|---|
| `AgentProcess` | 为每个会话生成持久化的 `claude` / `gemini` CLI 子进程；管理 stdin/stdout JSON 流协议 |
| `SessionManager` | 会话生命周期 — 创建、执行、重启、重跑、中断、切换模型、自动保存、Git 提交 |
| `NotebookStore` | 磁盘上 `.notebook.json` 文件的加载/保存/校验 |
| `NotebookDb` | SQLite CRUD — notebooks、sessions、projects、file annotations |
| `GitManager` | 仓库初始化、自动提交、Worktree 管理、交付物合并 |
| `ws-handler` | WebSocket 消息路由 — 25 种客户端消息类型，38 种服务端事件类型 |
| `auth` | Token 认证 + timing-safe 比对 + 指数退避暴力破解防护 |

**关键设计决策：**

- **持久化子进程模型** — 每个 Notebook 会话拥有一个长驻的 `claude -p` 进程（非请求-响应模式）。服务器将 WebSocket 客户端多路复用到子进程的 stdio 流。
- **确定性会话 ID** — `nb-<SHA1(notebookPath)[:8]>`，使会话创建幂等。
- **每 Cell 自动提交** — 完成时：写入 notebook → `git add -A` → commit → 捕获 diff → 带 diff 保存 notebook。
- **断线重连缓冲** — 每会话 500 事件环形缓冲区，支持 WebSocket 重连后事件重放。
- **每 Notebook 一个 Git Worktree** — 并行任务互不干扰，无需切换分支。

**REST API 概览：**

| 路由分组 | 端点数 | 描述 |
|---|---|---|
| `/api/auth` | 3 | 登录、状态检查、Token 验证 |
| `/api/notebooks` | 12 | CRUD、恢复、导入/导出、Slice 生成 |
| `/api/notebooks/:id/files` | 7 | 工作区文件管理 |
| `/api/projects` | 13 | 项目 CRUD、文件管理、Notebook 生命周期 |
| `/api/projects/:id/git-*` | 3 | Git 日志、Diff、分支 |
| `/api/library` | 7 | 共享知识库文件管理 |
| `/api/plugin` | 7 | 插件安装/卸载、市场管理 |

### packages/shared

单文件 Zod Schema 包（`src/types.ts`，849 行），定义完整的数据契约：

- **Notebook** — `version`、`metadata`、`cells[]`、`slice`、`annotations[]`、`assets`
- **Cell 类型** — `prompt`（含 outputs）、`markdown`、`visualization`
- **Cell 输出** — `text`、`thinking`、`tool_use`、`error`、`chart`
- **WebSocket 契约** — 25 种客户端→服务端消息类型，38 种服务端→客户端事件类型
- **Project** — `id`、`title`、`path`、`status`
- **Annotations** — `insert`、`delete`、`replace`、`comment`（支持音频附件）

## 快速开始

### 前置条件

- Node.js >= 20
- pnpm
- Git
- 已安装 Claude Code CLI（`claude`）或 Gemini CLI（`gemini`）

### 安装与运行

```bash
git clone <repo-url> notebook-ai
cd notebook-ai
pnpm install

# 启动开发服务器（前端 :3000 + 后端 :3002）
./restart.sh
```

应用将在 `https://localhost:3000` 可访问。

### 认证

设置 `NB_AUTH_TOKEN` 环境变量启用 Token 认证：

```bash
# 在 .env 文件中
NB_AUTH_TOKEN=your-secret-token
```

未设置时认证关闭（适合本地开发）。

### 环境变量

| 变量 | 默认值 | 描述 |
|---|---|---|
| `NB_AUTH_TOKEN` | *（无）* | Bearer Token 认证；未设 = 关闭认证 |
| `PORT` | `3002` | 后端 API 端口 |
| `NB_WORKSPACES_ROOT` | `/home/user/nb-workspaces` | 项目和 Notebook 根目录 |
| `NB_WORKSPACES_LIBRARY` | `$NB_WORKSPACES_ROOT/.library` | 共享知识库目录 |

## 开发

```bash
# 所有包进入开发模式
pnpm dev

# 运行测试
pnpm test

# 类型检查
pnpm typecheck

# 重启（杀掉 3000/3002 端口，重新启动）
./restart.sh
```

日志输出到 `/tmp/notebook-dev.log`。

## Moonview 插件市场

本仓库同时维护 [Moonview](https://github.com/huacheng/moonview) 插件生态，包含 **task-ai** 插件 — 一个结构化的任务生命周期管理框架，18 个子命令覆盖从调研到交付的完整工作流。

```bash
# 安装 Moonview 市场
claude plugin add huacheng/moonview
gemini plugin add huacheng/moonview
```

插件文档详见 [Moonview README](https://github.com/huacheng/moonview)。

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19、Vite 6、Zustand 5、TypeScript、WebSocket |
| 后端 | Express 5、better-sqlite3、ws、simple-git、Node.js ESM |
| 共享 | Zod Schema、TypeScript 类型 |
| AI Agent | Claude Code CLI、Gemini CLI（持久化子进程） |
| 测试 | Vitest、supertest、jsdom |
| 样式 | 自定义 CSS + CSS 变量（"Atelier warm studio" 主题） |
| 字体 | Bricolage Grotesque、Outfit、JetBrains Mono、LXGW WenKai Mono |

## 许可证

[MIT](LICENSE) © 2026 huacheng
