# Notebook AI

[中文文档](README_CN.md)

An AI-powered notebook workspace — like Jupyter Notebook, but backed by Claude or Gemini as the execution engine.

**Normal mode:**

```
┌──────────────── Toolbar (model selector, connection status) ─────────────────┐
├─ Sidebar (272px) ─┬─ Main Content ──────────────────────────┬─ Right Panel ──┤
│ L1: Project List  │  Notebook Tabs ─── Git Tab              │ Deliverables   │
│ L2: File Browser  │  ┌─ StatusBar (sticky) ──────────────┐  │ File Section   │
│ ── divider ──     │  │  Cell list (prompt + AI response)  │  │                │
│ Library           │  │  ...streaming output...            │  │                │
│                   │  └─ InputBar (sticky) ────────────────┘  │                │
└───────────────────┴──────────────────────────────────────────┴────────────────┘
```

**Split-view mode (file + notebook):**

```
┌──────────────── Toolbar (model selector, connection status) ─────────────────┐
├─ Sidebar ─┬─ File Tabs ──────┬─ Notebook Tabs ─── Git Tab ──┬─ Right Panel ──┤
│ Project   │  ┌────────────┐  │  ┌─ StatusBar ────────────┐   │ Deliverables   │
│ Files     │  │ FileViewer │  │  │  Cell list             │   │ File Section   │
│ ── div ── │  │            │  │  │  ...streaming...       │   │                │
│ Library   │  │            │  │  └─ InputBar ─────────────┘   │                │
│           │  └────────────┘  │                               │                │
└───────────┴──────────────────┴───────────────────────────────┴────────────────┘
```

![UI Preview](ui-redesign-preview.png)

## Features

- **AI Notebook** — Multi-turn conversational cells with real-time streaming of thinking, text, and tool use
- **Multi-agent Support** — Claude (Sonnet / Haiku / Opus) and Gemini, switchable per session
- **Project & Workspace** — Each notebook runs in an isolated git worktree with its own branch
- **Auto Git Commit** — Every cell execution auto-commits changes with diff tracking
- **File Management** — Upload, browse, edit, and annotate files (text, PDF, DOCX, XLSX, PPTX, images)
- **Git History** — Visual branch graph, commit diff viewer, and branch filtering (all via WebSocket)
- **Split View** — Side-by-side file viewer and notebook editing with synchronized tab bar
- **Shared Library** — Cross-notebook knowledge base with system-managed references and user imports
- **Slice View** — AI-generated structured summary of notebook sessions
- **Plugin Marketplace** — Install and manage plugins from GitHub-hosted marketplaces
- **Token Auth** — Optional bearer-token authentication with brute-force protection
- **Export** — Notebooks as HTML or zip bundles

## Architecture

```
notebook-ai/
├── packages/
│   ├── web/        # React 19 + Vite frontend
│   ├── server/     # Express 5 + SQLite backend
│   └── shared/     # Zod schemas & TypeScript types
├── task-ai/        # task-ai plugin (development)
└── plugins/        # Published plugin artifacts
```

### packages/web

React 19 SPA with a three-column layout: project sidebar, notebook content area, and deliverables panel.

| Technology | Role |
|---|---|
| React 19 | UI framework |
| Vite 6 | Dev server & bundler |
| Zustand 5 | State management (6 composable slices) |
| react-markdown | Markdown rendering with GFM + syntax highlighting |
| react-pdf / docx-preview / xlsx | File viewer for PDF, DOCX, XLSX |
| Tiptap | Rich-text file editor |
| WebSocket | Real-time streaming & session multiplexing |

Panels are draggable-resizable. See layout diagrams above for normal and split-view modes.

### packages/server

Express 5 HTTP + WebSocket backend. No external database — uses embedded SQLite (better-sqlite3, WAL mode).

| Technology | Role |
|---|---|
| Express 5 | REST API |
| ws | WebSocket server |
| better-sqlite3 | Embedded database |
| simple-git | Git operations |
| multer | File uploads |

**Core modules:**

| Module | Responsibility |
|---|---|
| `AgentProcess` | Spawns persistent `claude` / `gemini` CLI subprocess per session; manages stdin/stdout JSON stream protocol |
| `SessionManager` | Session lifecycle — create, execute, restart, rerun, interrupt, model-change, auto-save, git commit |
| `NotebookStore` | Load/save/validate `.notebook.json` files on disk |
| `NotebookDb` | SQLite CRUD for notebooks, sessions, projects, file annotations |
| `GitManager` | Repo init, auto-commit, worktree management, deliverable merges |
| `ws-handler` | WebSocket message routing — 25 client message types, 38 server event types |
| `auth` | Token auth with timing-safe compare, exponential-backoff brute-force lockout |

**Key design decisions:**

- **Persistent subprocess model** — Each notebook session owns a long-lived `claude -p` process (not request-per-response). The server multiplexes WebSocket clients to subprocess stdio streams.
- **Deterministic session IDs** — `nb-<SHA1(notebookPath)[:8]>`, making session creation idempotent.
- **Auto-commit per cell** — On completion: write notebook → `git add -A` → commit → capture diff → save notebook with diff.
- **Resume-after buffering** — 500-event ring buffer per session for WebSocket reconnection replay.
- **Git worktree per notebook** — Parallel tasks without branch-switching conflicts.

**REST API overview:**

| Route Group | Endpoints | Description |
|---|---|---|
| `/api/auth` | 3 | Login, status check, token verify |
| `/api/notebooks` | 12 | CRUD, restore, import/export, slice generation |
| `/api/notebooks/:id/files` | 7 | Workspace file management |
| `/api/projects` | 13 | Project CRUD, file management, notebook lifecycle |
| `/api/projects/:id/git-*` | 3 | Git log, diff, branches |
| `/api/library` | 7 | Shared library file management |
| `/api/plugin` | 7 | Plugin install/uninstall, marketplace management |

### packages/shared

Single-file Zod schema package (`src/types.ts`, 849 lines) defining the complete data contract:

- **Notebook** — `version`, `metadata`, `cells[]`, `slice`, `annotations[]`, `assets`
- **Cell types** — `prompt` (with outputs), `markdown`, `visualization`
- **Cell outputs** — `text`, `thinking`, `tool_use`, `error`, `chart`
- **WebSocket contract** — 25 client → server message types, 38 server → client event types
- **Project** — `id`, `title`, `path`, `status`
- **Annotations** — `insert`, `delete`, `replace`, `comment` (with optional audio)

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm
- Git
- Claude Code CLI (`claude`) or Gemini CLI (`gemini`) installed

### Install & Run

```bash
git clone <repo-url> notebook-ai
cd notebook-ai
pnpm install

# Start dev server (frontend :3000 + backend :3002)
./restart.sh
```

The app will be available at `https://localhost:3000`.

### Authentication

Set the `NB_AUTH_TOKEN` environment variable to enable token auth:

```bash
# In .env file
NB_AUTH_TOKEN=your-secret-token
```

If unset, authentication is disabled (suitable for local development).

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NB_AUTH_TOKEN` | *(none)* | Bearer token for auth; unset = auth disabled |
| `PORT` | `3002` | Backend API port |
| `NB_WORKSPACES_ROOT` | `/home/user/nb-workspaces` | Root directory for projects and notebooks |
| `NB_WORKSPACES_LIBRARY` | `$NB_WORKSPACES_ROOT/.library` | Shared knowledge library |

## Development

```bash
# Run all packages in dev mode
pnpm dev

# Run tests
pnpm test

# Type check
pnpm typecheck

# Restart (kills ports 3000/3002, relaunches)
./restart.sh
```

Logs are written to `/tmp/notebook-dev.log`.

## Moonview Plugin Marketplace

This repository also hosts the [Moonview](https://github.com/huacheng/moonview) plugin ecosystem, including the **task-ai** plugin — a structured task lifecycle management framework with 18 subcommands covering the full workflow from research to delivery.

```bash
# Install Moonview marketplace
claude plugin add huacheng/moonview
gemini plugin add huacheng/moonview
```

See the [Moonview README](https://github.com/huacheng/moonview) for plugin documentation.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite 6, Zustand 5, TypeScript, WebSocket |
| Backend | Express 5, better-sqlite3, ws, simple-git, Node.js ESM |
| Shared | Zod schemas, TypeScript types |
| AI Agents | Claude Code CLI, Gemini CLI (persistent subprocess) |
| Testing | Vitest, supertest, jsdom |
| Styling | Custom CSS with CSS variables ("Atelier warm studio" theme) |
| Fonts | Bricolage Grotesque, Outfit, JetBrains Mono, LXGW WenKai Mono |

## License

[MIT](LICENSE) © 2026 huacheng
