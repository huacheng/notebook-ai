# Notebook AI

[English](README.md)

AI 驱动的 Notebook 工作空间 — 类似 Jupyter Notebook，但以 Claude 或 Gemini 作为执行引擎。

![Notebook AI 截图](screen_shot.jpg)

```
┌─ 侧边栏 (272px) ─┬─ 主内容区 ─────────────────┬─ 右侧面板 ─┐
│ L1: 项目列表     │  Notebook 标签 ─── Git 标签 │ 交付物     │
│ L2: 文件浏览器   │  ┌─ 状态栏 (sticky) ────┐   │ 文件区域   │
│ ── 分隔线 ──     │  │  Cell 列表            │   │            │
│ Library          │  │  ...流式输出...       │   │            │
│                  │  └─ 输入栏 (sticky) ────┘   │            │
└──────────────────┴─────────────────────────────┴────────────┘
```

## 功能特性

- **AI Notebook** — 多轮对话式 Cell，实时流式输出思考过程、文本和工具调用
- **多 Agent 支持** — Claude（Sonnet / Haiku / Opus）和 Gemini，按会话切换
- **项目与工作区** — 每个 Notebook 运行在独立的 Git Worktree 中，拥有独立分支
- **自动 Git 提交** — 每次 Cell 执行后自动提交变更并记录 Diff
- **文件管理** — 上传、浏览、编辑和批注文件（文本、PDF、DOCX、XLSX、PPTX、图片）
- **Git 历史** — 可视化分支图、提交 Diff 查看器、分支过滤
- **分屏视图** — 文件查看器与 Notebook 并排编辑，Tab 栏同步
- **共享知识库** — 跨 Notebook 的知识库，包含系统管理的引用和用户导入内容
- **Slice 视图** — AI 生成的 Notebook 会话结构化摘要
- **Token 认证** — 共享密钥认证，支持 timing-safe 比对和暴力破解锁定
- **系统预检** — 插件版本检查和定时任务状态监控
- **导出** — 支持导出为 HTML 或 zip 包
- **[task-ai 插件](https://github.com/huacheng/moonview)** — 结构化任务生命周期管理，包含 18 个子命令：
  - *init → target → plan → check → exec → merge → report* — 完整开发生命周期
  - 六维门控审查（正确性、安全性、可靠性、性能、架构、可维护性）
  - 领域感知类型画像，内置种子模板（软件、基础设施、数据管道、ML 等）
  - 验证优先协议（Red→Green TDD 强制执行）
  - 共享知识库与跨任务经验蒸馏
  - 安全守卫 — 审计计划并在执行前拦截高风险命令
  - Auto 模式 — 对话式四阶段流程，自动审查与子代理委派

## 快速开始

### 前置条件

- Node.js >= 20
- pnpm
- Git
- 已安装 Claude Code CLI（`claude`）或 Gemini CLI（`gemini`）

### 安装

```bash
git clone https://github.com/huacheng/notebook-ai.git
cd notebook-ai
pnpm install
```

### 配置

```bash
cp .env.example .env
# 编辑 .env — 设置 NB_AUTH_TOKEN（至少 24 个字符）：
#   openssl rand -hex 32
```

### 运行

```bash
# 生产模式（默认）— 构建并在 :3000 提供服务
./restart.sh

# 开发模式 — Vite HMR 在 :3000，API 在 :3002
./restart.sh --dev
```

打开 `https://localhost:3000` 并输入认证 Token。

## 架构

```
notebook-ai/
├── packages/
│   ├── web/        # React 19 + Vite 前端
│   ├── server/     # Express 5 + SQLite 后端
│   └── shared/     # Zod Schema 与 TypeScript 类型
├── restart.sh      # 构建与启动脚本
└── .env            # 运行时配置
```

### 前端（`packages/web`）

React 19 单页应用，三栏布局：项目侧边栏、Notebook 内容区、交付物面板。

| 技术 | 用途 |
|---|---|
| React 19 | UI 框架 |
| Vite 6 | 开发服务器与打包工具 |
| Zustand 5 | 状态管理（可组合 Slice） |
| react-markdown | Markdown 渲染，支持 GFM + 语法高亮 |
| react-pdf / docx-preview | PDF、DOCX、XLSX 文件查看器 |
| Tiptap | 富文本文件编辑器 |
| WebSocket | 实时流式传输与会话多路复用 |

### 后端（`packages/server`）

Express 5 HTTP + WebSocket 服务器，内嵌 SQLite（better-sqlite3，WAL 模式）。

**核心模块：**

| 模块 | 职责 |
|---|---|
| `AgentProcess` | 为每个会话维护持久化的 `claude` / `gemini` CLI 子进程；stdin/stdout JSON 流 |
| `SessionManager` | 会话生命周期 — 创建、执行、重启、重跑、中断、切换模型、自动保存 |
| `GitManager` | 仓库初始化、自动提交、Worktree 管理、交付物合并 |
| `auth` | Token 认证，`timingSafeEqual` 比对，指数退避暴力破解锁定（60s 基础，30min 上限） |
| `ws-handler` | WebSocket 消息路由 — 25+ 客户端消息类型，38+ 服务端事件类型 |

**关键设计决策：**

- **持久化子进程模型** — 每个 Notebook 会话拥有一个长驻的 `claude -p` 进程。服务器将 WebSocket 客户端多路复用到子进程的 stdio 流。
- **确定性会话 ID** — `nb-<SHA1(notebookPath)[:8]>`，使会话创建幂等。
- **每 Cell 自动提交** — 完成时：写入 notebook → `git add -A` → commit → 捕获 diff。
- **断线重连缓冲** — 每会话 500 事件环形缓冲区，支持 WebSocket 重连后事件重放。
- **每 Notebook 一个 Git Worktree** — 并行任务互不干扰，无需切换分支。

### 共享层（`packages/shared`）

Zod Schema 包，定义完整的数据契约：Notebook 格式、Cell 类型、输出、WebSocket 消息、项目结构、文件批注。

## 环境变量

| 变量 | 默认值 | 描述 |
|---|---|---|
| `NB_AUTH_MODE` | `token` | 认证模式：`token` 或 `password` |
| `NB_AUTH_TOKEN` | *（必填）* | Token 认证的共享密钥（至少 24 个字符） |
| `NB_WORKSPACES_ROOT` | `~/nb-workspaces` | 项目工作区根目录 |
| `NB_WORKSPACES_LIBRARY` | `$NB_WORKSPACES_ROOT/.library` | 共享知识库路径 |
| `TRUST_PROXY` | *（未设置）* | 设置后信任反向代理的 `X-Forwarded-For` 头 |

## 开发

```bash
./restart.sh --dev     # 启动热重载开发模式
pnpm test              # 运行测试套件（Vitest）
pnpm typecheck         # 类型检查所有包
```

日志：`/tmp/notebook-dev.log`（开发）或 `/tmp/notebook-prod.log`（生产）。

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19、Vite 6、Zustand 5、TypeScript、WebSocket |
| 后端 | Express 5、better-sqlite3、ws、simple-git、Node.js ESM |
| AI Agent | Claude Code CLI、Gemini CLI（持久化子进程） |
| 测试 | Vitest（1900+ 测试） |
| 样式 | CSS 变量，"Atelier warm studio" 主题 |

## 许可证

[MIT](LICENSE)
