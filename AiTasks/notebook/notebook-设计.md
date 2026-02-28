# Notebook + Worktree 路径统一设计

> 创建日期: 2026-02-26
> 状态: 待确认

---

## 一、问题

当前创建 project notebook 时产生两套平行目录：

```
my-project/                              ← git 主仓库 (main)
├── my-task/                             ← notebook 目录（项目根下）
│   ├── my-task.notebook.json            ← 对话记录（不被 git 跟踪）
│   └── .working/                        ← task 元数据（重复！）
│       ├── .index.json
│       └── .target.md
│
└── .worktrees/task-my-task/             ← worktree (task/my-task 分支)
    ├── .working/                        ← task 元数据（重复！）
    │   ├── .index.json
    │   └── .target.md
    └── <workspace files>                ← Claude 产出物（git 跟踪）
```

**三个问题**：

1. **`.working/` 重复** — `my-task/.working/` 和 `.worktrees/task-my-task/.working/` 内容重复，无同步机制，容易不一致
2. **notebook.json 不被 git 跟踪** — 对话记录在项目根 `my-task/` 目录下，worktree 的 git 无法覆盖，丢失即不可恢复
3. **交付物路径断裂** — Claude 的 cwd 是 worktree 根，产出物散落在 worktree 内；`.deliverables/` 是独立目录，代码交付需要手动操作或 merge 后才出现在主分支

---

## 二、目标架构

```
my-project/                              ← git 主仓库 (main)
├── .git/
├── .gitignore
├── .deliverables/                       ← 所有最终产出（main 分支跟踪）
│   ├── src/app.py                       ← 代码交付物
│   └── docs/report.pdf                  ← 文档交付物
│
└── .worktrees/                          ← gitignored（worktree 容器）
    └── task-my-task/                    ← worktree (task/my-task 分支)
        ├── .deliverables/               ← Claude 的 cwd → 写入这里
        │   ├── src/app.py
        │   └── docs/report.pdf
        ├── .working/                    ← task 元数据（唯一一份，git 跟踪）
        │   ├── .index.json
        │   └── .target.md
        └── my-task.notebook.json        ← 对话记录（git 跟踪）
```

**消除 `my-task/` 目录**，notebook.json 和 .working/ 只存在于 worktree 内。

---

## 三、数据流

### 3.1 创建 notebook

```
用户点击 "新建 Notebook"
    │
    ▼
POST /api/projects/:projectId/notebooks  { title: "My Task" }
    │
    ├─ nbSlug = titleToSlug(title)         → "my-task"
    ├─ branchName = "task/my-task"
    ├─ worktreePath = project.path/.worktrees/task-my-task
    │
    ├─ git branch task/my-task
    ├─ git worktree add .worktrees/task-my-task task/my-task
    │
    ├─ mkdir worktreePath/.working
    ├─ mkdir worktreePath/.deliverables    ← 新增：确保目录存在
    ├─ initTaskWorkingDir → 写入 worktreePath/.working/  ← 改：不再写 nbDir
    │
    ├─ notebookPath = worktreePath/my-task.notebook.json  ← 改：放入 worktree
    ├─ notebookStore.save(notebookPath, notebook)
    │
    ├─ worktreeGit.commitAll("initialize notebook")       ← notebook.json 也被 commit
    │
    ├─ session = createSession(notebookPath, cwd, gitRoot)
    │   ├─ notebookPath = worktreePath/my-task.notebook.json
    │   ├─ cwd = worktreePath/.deliverables                ← Claude 进程工作目录
    │   └─ gitRoot = worktreePath                          ← GitManager 根（新参数）
    │
    └─ DB.createNotebook({
         notebook_path: notebookPath,       ← worktree 内路径
         workspace_dir: worktreePath,       ← worktree 根（不变）
       })
```

### 3.2 Cell 执行与保存

```
用户输入 prompt → Claude 在 cwd (.deliverables/) 下执行
    │
    ▼ Claude 创建 .deliverables/src/app.py
    │
    ▼ cell 执行完毕
    │
    ├─ tryGitCommit():
    │   ├─ writeFile(session.notebookPath)     ← 写入 worktree/my-task.notebook.json
    │   ├─ gitManager.commitCellExecution()     ← git -C worktreeRoot add -A && commit
    │   │   → 同时 commit：notebook.json + .deliverables/src/app.py
    │   └─ 返回 diff
    │
    └─ autoSave():
        └─ writeFile(session.notebookPath)     ← 同上路径
```

### 3.3 Merge 到主分支

只有 `.deliverables/` 的变更进入 main。`.working/` 和 `*.notebook.json` 不进入。

**技术要点**：`.gitignore` 对已 tracked 的文件无效，所以不能靠 .gitignore 来排除。实际方案是 merge 脚本只提取 `.deliverables/` 目录的变更：

```
/task-ai:merge my-task
    │
    ├─ git checkout main
    ├─ git checkout task/my-task -- .deliverables/    ← 只取 .deliverables/ 的内容
    ├─ git add .deliverables/
    ├─ git commit "task-ai(my-task): merge deliverables"
    │
    │   → .deliverables/src/app.py    进入 main ✓
    │   → .working/                   不涉及 ✗
    │   → my-task.notebook.json       不涉及 ✗
    │
    └─ 主分支 .deliverables/ 获得最终交付物 ✓
```

这比 `git merge --no-ff` 更精确——只合入交付物目录，task 元数据和对话记录留在 task 分支。

### 3.4 新阶段：Rebase main 继续开发

merge 完成后，同一个 worktree 可以拉取最新 main 继续下一阶段：

```
Phase 1 完成，merge 到 main
    │
    ▼
在 worktree 内 rebase main（获取其他 task 的 merge 成果）
    │
    ├─ git merge main                ← worktree 分支合入最新 main
    ├─ 更新 .working/.target.md       ← 定义新阶段目标
    ├─ 清空或保留 notebook cells       ← 见 3.5 Notebook 重执行
    │
    └─ 继续执行新的 prompt → Claude 在最新代码基础上工作
```

这样一个 notebook 可以跨多个阶段迭代，每次 merge 只把 `.deliverables/` 增量交付到 main。

### 3.5 Notebook 重执行（Pipeline 模式）

场景：notebook 定型为一个"配方"（如生成视频、生成报告），需要以新 target 为输入从头执行。

```
已有 notebook（cells = [prompt1, prompt2, ..., promptN]，带历史 outputs）
    │
    ▼ 用户触发 "重执行"
    │
    ├─ 保存当前 notebook 为 snapshot（可选：git tag / 归档）
    ├─ 清空所有 cells 的 outputs，重置 status 为 pending
    ├─ 更新 .working/.target.md（新的输入参数）
    │
    ├─ 从 cell[0] 开始依次执行
    │   ├─ cell[0].source → Claude 执行 → cell[0].outputs 更新
    │   ├─ cell[1].source → Claude 执行 → cell[1].outputs 更新
    │   └─ ...
    │
    └─ .deliverables/ 内生成新的交付物（视频、文档等）
```

核心能力：
- **清空 outputs** — 保留 prompt（配方），清空历史结果
- **顺序重执行** — 按 cell 顺序重新提交给 Claude
- **交付物覆盖** — 新产出物覆盖 `.deliverables/` 中的旧文件
- **版本管理** — 每次重执行前可 git tag 保存快照，便于回溯

#### UI 支持

**Notebook 状态栏**（`.notebook-statusbar`）新增：

```
[▶ 重执行] 按钮 — 触发 Pipeline 模式
```

点击后弹出确认对话框：
```
┌─────────────────────────────────┐
│  重执行 Notebook                 │
│                                 │
│  将清空所有输出，从头执行全部     │
│  prompt。当前输出会自动保存为     │
│  git snapshot。                  │
│                                 │
│  [取消]            [确认重执行]  │
└─────────────────────────────────┘
```

**执行过程 UI**：
- 所有 cell 状态重置为 `pending`，outputs 清空
- 从 cell[0] 开始自动逐条执行，当前执行的 cell 显示 `running` 状态
- 用户可以观看实时输出流（和手动执行时一样）
- 执行完最后一个 cell 后恢复正常交互模式

**后端新增**：
- WS 消息 `{ type: 'rerun_notebook', session_id }` — 触发重执行
- 后端流程：

```
rerun_notebook
    │
    ├─ 1. git tag "rerun-{timestamp}" — 保存快照
    ├─ 2. 清空所有 cells 的 outputs，status → pending
    ├─ 3. 重建 Claude 子进程（清除上下文）：
    │      session.agentProcess.stop()
    │      session.agentProcess = new AgentProcess(engine, cwd, MEMORY_SYSTEM_PROMPT)
    │      await session.agentProcess.start(onMsg)  ← 不传 resumeSessionId
    │      // 关键：不传 resumeSessionId → Claude 从零开始，无历史对话
    ├─ 4. 从 cell[0] 开始逐条执行
    │      for (const cell of notebook.cells) {
    │        await executeCell(cell.id, cell.source)  // 复用现有执行管道
    │      }
    └─ 5. 全部完成后恢复正常交互模式
```

与 `restartSession` 的区别：restart 传 `resumeSessionId` 恢复上下文（断线重连），rerun **不传** resumeSessionId（全新上下文）。

---

## 四、改动清单

### 4.1 后端

| 文件 | 改动 |
|------|------|
| `packages/server/src/routes/projects.ts` | **创建 notebook**：移除 `nbDir` 目录创建；`notebookPath` 改为 `worktreePath/{slug}.notebook.json`；`initTaskWorkingDir` 只写入 worktree；确保 `worktreePath/.deliverables/` 存在 |
| `packages/server/src/task-init.ts` | `initTaskWorkingDir` 参数简化：移除 `nbDir`，只接受 `worktreePath`；`.working/` 只在 worktree 内创建 |
| `packages/server/src/session.ts` | `createSession` 新增 `gitRoot` 参数；`GitManager` 用 `gitRoot` 初始化（而非 `cwd`）；`AgentProcess` 用 `cwd` 初始化（不变） |
| `packages/server/src/routes/notebooks.ts` | **restore**：`cwd` 从 `workspace_dir` 改为 `path.join(workspace_dir, '.deliverables')`；`gitRoot` 传 `workspace_dir` |
| `packages/server/src/routes/projects.ts` | **文件列表**：`.deliverables` 从 `HIDDEN_TOPDIRS` 移除（改为 main 分支可见）|
| `packages/server/src/git.ts` | 无改动（GitManager 始终在 `gitRoot` 操作，`git add -A` 覆盖全 worktree） |

### 4.2 前端

| 文件 | 改动 |
|------|------|
| `packages/web/src/components/RightPanel.tsx` | `.deliverables` 不再需要作为隐藏路径特殊处理，右面板仍然展示 `.deliverables/` 内容，但改为 main 分支跟踪后可在左侧文件面板也看到 |

### 4.3 task-ai

| 文件 | 改动 |
|------|------|
| `task-ai/skills/init/scripts/init.sh` | `.working/` 只在 worktree 内创建，移除对 `$TARGET_DIR/.working` 的写入 |
| `task-ai/skills/merge/scripts/merge.sh` | merge 后 `.deliverables/` 内容自然进入 main；可选：讨论是否将 notebook.json 和 .working/ 加入 `.gitignore` 避免 merge 到 main |

### 4.4 titleToSlug 统一 + 重复名拒绝

**问题**：
- `projects.ts` 的 `titleToSlug` 只保留 `a-z0-9`，中文标题（如 "测试1"）变成 "1"
- `workspace.ts` 的 `titleToSlug` 保留了中文（`\u4e00-\u9fff`），但只覆盖 CJK 基本区
- 两处实现不一致

**改动**：

1. **统一 `titleToSlug`**（`workspace.ts` 导出，`projects.ts` 引用）：

```typescript
export function titleToSlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')  // 保留所有 Unicode 字母+数字
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'notebook';
}
// "测试 Task 1!" → "测试-task-1"
// "用户认证模块 v2" → "用户认证模块-v2"
```

2. **重复名直接拒绝**（取代当前的追加 UUID 后缀）：

```typescript
// projects.ts — 创建 notebook
const worktreePath = path.join(project.path, '.worktrees', `task-${nbSlug}`);
if (existsSync(worktreePath)) {
  return res.status(409).json({ error: `名称 "${title}" 已存在，请使用其他名称` });
}

// projects.ts — 创建 project
const projectPath = path.join(workspacesRoot, slug);
if (existsSync(projectPath)) {
  return res.status(409).json({ error: `项目 "${title}" 已存在，请使用其他名称` });
}
```

3. **前端处理 409**：捕获错误，在输入框下方展示提示，用户重新输入即可。

| 文件 | 改动 |
|------|------|
| `packages/server/src/workspace.ts` | `titleToSlug` 改用 `\p{L}\p{N}` Unicode 匹配 |
| `packages/server/src/routes/projects.ts` | 移除本地 `titleToSlug`，从 `workspace.ts` 导入；冲突时返回 409 |
| `packages/web/src/components/ProjectSidebar.tsx` | 捕获 409 展示 "名称已存在" 提示 |

### 4.5 数据库硬迁移

服务启动时扫描所有 project notebook，将 `notebook_path` 从旧路径 `project/{slug}/{slug}.notebook.json` 迁移到新路径 `worktree/{slug}.notebook.json`，移动文件并更新 DB，清理旧空目录。详见第七节。

### 4.6 Merge 脚本改造

`task-ai/skills/merge/scripts/merge.sh` 需改为**选择性合入**（而非全分支 merge）：

```bash
# 旧方案：git merge task/$NOTEBOOK --no-ff（会把 .working/ 和 notebook.json 带入 main）
# 新方案：只提取 .deliverables/ 的内容到 main

git checkout main
git checkout "task/$NOTEBOOK" -- .deliverables/
git add .deliverables/
git commit -m "task-ai($NOTEBOOK): merge deliverables from task/$NOTEBOOK"
```

这样 `.working/` 和 `*.notebook.json` 始终只存在于 task 分支，不会污染 main。

---

## 五、Session 参数变更

### 当前

```typescript
createSession(notebookPath: string, cwd: string)
//            ↑                      ↑
//  notebook.json 路径     Claude cwd = GitManager root = worktree 根
```

### 改为

```typescript
createSession(notebookPath: string, cwd: string, gitRoot: string)
//            ↑                      ↑             ↑
//  notebook.json 路径     Claude cwd            GitManager root
//  (worktree 内)         (.deliverables/)       (worktree 根)
```

- `cwd`：Claude 进程的工作目录 → `worktreePath/.deliverables/`
- `gitRoot`：GitManager 的操作根 → `worktreePath`（确保 `git add -A` 覆盖全 worktree）
- `notebookPath`：notebook.json 路径 → `worktreePath/{slug}.notebook.json`

---

## 六、Merge 后 main 分支内容决策

| 内容 | 进入 main | 机制 |
|------|-----------|------|
| `.deliverables/**` | **是** | merge 脚本用 `git checkout task/xxx -- .deliverables/` 选择性合入 |
| `.working/` | **否** | merge 脚本不涉及此目录 |
| `*.notebook.json` | **否** | merge 脚本不涉及此文件 |

`.working/` 和 notebook.json 只在 task 分支内存在，是该 notebook 的私有状态，不污染 main。通过选择性合入（而非 `git merge`）实现精确隔离。

---

## 七、数据库迁移

直接硬迁移，不考虑旧路径兼容：

```typescript
// 服务启动时，扫描所有 project notebook DB 记录
for (const row of db.listAllNotebooks()) {
  if (!row.project_id) continue;  // 跳过独立 notebook

  const slug = path.basename(row.notebook_path, '.notebook.json');
  const worktreePath = row.workspace_dir;  // 已经是 worktree 路径
  const newNotebookPath = path.join(worktreePath, `${slug}.notebook.json`);

  if (row.notebook_path !== newNotebookPath) {
    // 移动文件
    await rename(row.notebook_path, newNotebookPath);
    // 更新 DB
    db.updateNotebookPath(row.id, newNotebookPath);
    // 清理旧的空 nbDir（如果只剩空目录）
    await rm(path.dirname(row.notebook_path), { recursive: true, force: true });
  }
}
```

无 project 的独立 notebook 不受影响，`workspace_dir` 即为 notebook 所在目录，`cwd` 和 `gitRoot` 相同。

---

## 八、目录对比

### Before

```
my-project/
├── .deliverables/                  ← 独立目录，不被 main 跟踪
├── my-task/                        ← notebook 目录
│   ├── my-task.notebook.json       ← 不被 git 跟踪
│   └── .working/                   ← 重复
└── .worktrees/task-my-task/        ← worktree
    ├── .working/                   ← 重复
    └── <files>                     ← Claude 产出
```

### After

```
my-project/
├── .deliverables/                  ← main 分支跟踪（merge 后可见）
└── .worktrees/task-my-task/        ← worktree（唯一工作区）
    ├── .deliverables/              ← Claude 的 cwd
    ├── .working/                   ← task 元数据（唯一一份）
    └── my-task.notebook.json       ← 对话记录（git 跟踪）
```

**消除**：`my-task/` 目录 + `.working/` 重复。
**获得**：notebook.json 版本化 + 交付物 merge 到 main 的自然路径。

---

## 九、创建顺序

新设计下，notebook 创建严格遵循 **先有容器，再有内容** 的顺序：

```
1. git branch task/{slug}
2. git worktree add .worktrees/task-{slug} task/{slug}     ← 先创建 worktree 目录
3. mkdir .worktrees/task-{slug}/.working/
4. mkdir .worktrees/task-{slug}/.deliverables/
5. 写入 .working/.index.json + .target.md                  ← task 元数据
6. 写入 .worktrees/task-{slug}/{slug}.notebook.json         ← 再创建 notebook
7. git add -A && git commit "initialize notebook"           ← 初始 commit（全部纳入版本控制）
```

不再创建 `project/{slug}/` 目录。worktree 是 notebook 的唯一物理载体。

---

## 十、打包下载

一个 worktree 目录 = 一个 notebook 的**完整自包含快照**：

```
.worktrees/task-my-task/           ← 打包下载范围
├── my-task.notebook.json          ← 对话记录
├── .working/                      ← task 元数据（目标、状态、计划）
│   ├── .index.json
│   └── .target.md
└── .deliverables/                 ← 代码/文档产出
    ├── src/app.py
    └── docs/report.pdf
```

下载 API 只需打包 `workspace_dir`（即 worktree 根）即可，包含：
- **对话历史**（notebook.json）
- **任务上下文**（.working/）
- **全部交付物**（.deliverables/）

独立可恢复，无需拼接多个目录。

---

## 十一、TDD 步骤

按依赖顺序，每步先 RED 再 GREEN。

### Step 1 — titleToSlug Unicode 支持

**测试文件**：`packages/server/src/__tests__/workspace.test.ts`（新建或追加）

```
RED tests:
  ✗ titleToSlug("测试1") → "测试1"            // 当前返回 "1"
  ✗ titleToSlug("用户认证 v2") → "用户认证-v2"
  ✗ titleToSlug("My Task!") → "my-task"
  ✗ titleToSlug("  --test--  ") → "test"
```

**GREEN**：统一 `workspace.ts` 的 `titleToSlug`，用 `\p{L}\p{N}` 替换旧正则。`projects.ts` 移除本地 `titleToSlug`，改为从 `workspace.ts` 导入。

### Step 2 — 重复名拒绝（409）

**测试文件**：`packages/server/src/__tests__/projects-files.test.ts`（追加）

```
RED tests:
  ✗ POST /projects/:id/notebooks { title: "X" } 第一次 → 201
    POST /projects/:id/notebooks { title: "X" } 第二次 → 409 + error message
  ✗ POST /projects { title: "Y" } 第一次 → 201
    POST /projects { title: "Y" } 第二次 → 409 + error message
```

**GREEN**：`projects.ts` 创建 notebook/project 时 `existsSync` 检测冲突返回 409，移除 UUID 后缀追加逻辑。

### Step 3 — notebookPath 移入 worktree

**测试文件**：`packages/server/src/__tests__/projects-files.test.ts`（追加）

```
RED tests:
  ✗ 创建 notebook 后，notebook.json 存在于 worktreePath/{slug}.notebook.json
  ✗ 创建 notebook 后，project/{slug}/ 目录不存在
  ✗ 创建 notebook 后，worktreePath/.deliverables/ 目录存在
  ✗ 创建 notebook 后，worktreePath/.working/.index.json 存在
  ✗ DB 中 notebook_path 指向 worktree 内路径
```

**GREEN**：
- `projects.ts`：移除 `nbDir` 创建，`notebookPath` 改为 `worktreePath/{slug}.notebook.json`，`mkdir .deliverables/`
- `task-init.ts`：`initTaskWorkingDir` 只写入 worktree

### Step 4 — Session gitRoot 解耦

**测试文件**：`packages/server/src/__tests__/session-restart.test.ts`（追加）

```
RED tests:
  ✗ createSession(nbPath, cwd, gitRoot) — gitManager.repoRoot === gitRoot
  ✗ createSession(nbPath, cwd, gitRoot) — session.cwd === cwd（≠ gitRoot）
  ✗ AgentProcess 用 cwd 初始化，不用 gitRoot
```

**GREEN**：
- `session.ts`：`createSession` 新增 `gitRoot` 参数，`GitManager` 用 `gitRoot`，`AgentProcess` 用 `cwd`
- `notebooks.ts` restore：`cwd = path.join(workspace_dir, '.deliverables')`，`gitRoot = workspace_dir`

### Step 5 — DB 硬迁移

**测试文件**：`packages/server/src/__tests__/migration.test.ts`（新建）

```
RED tests:
  ✗ 迁移将 notebook.json 从 project/{slug}/{slug}.notebook.json 移动到 worktree/{slug}.notebook.json
  ✗ 迁移后 DB notebook_path 已更新
  ✗ 迁移后旧 project/{slug}/ 空目录已删除
  ✗ 独立 notebook（无 project_id）不受影响
  ✗ notebook.json 已在新路径时跳过（幂等）
```

**GREEN**：实现启动时迁移逻辑（独立模块），在 server 启动时调用。

### Step 6 — Merge 选择性合入

**测试文件**：`packages/server/src/__tests__/git.test.ts`（追加）

```
RED tests:
  ✗ mergeDeliverables(branch) — main 上出现 .deliverables/ 内的文件
  ✗ mergeDeliverables(branch) — main 上不出现 .working/ 文件
  ✗ mergeDeliverables(branch) — main 上不出现 *.notebook.json
```

**GREEN**：
- `git.ts` 新增 `mergeDeliverables(branch)` 方法
- `merge.sh` 调用新方法或直接改为 `git checkout $branch -- .deliverables/`

### Step 7 — Notebook 重执行

**测试文件**：`packages/server/src/__tests__/rerun.test.ts`（新建）

```
RED tests:
  ✗ rerunNotebook(sessionId) — 所有 cells 的 outputs 被清空
  ✗ rerunNotebook(sessionId) — 所有 cells 的 status 重置为 pending
  ✗ rerunNotebook(sessionId) — agentProcess 被重建（新实例，旧实例 stopped）
  ✗ rerunNotebook(sessionId) — 不传 resumeSessionId（干净上下文）
  ✗ rerunNotebook(sessionId) — 执行完成后 cells 按序有 outputs
```

**GREEN**：
- `session.ts` 新增 `rerunNotebook(sessionId)` 方法
- `ws-handler.ts` 新增 `rerun_notebook` 消息处理

### Step 8 — 前端 409 处理 + 重执行 UI

**测试文件**：`packages/web/src/__tests__/projectSidebar.test.ts`（新建或追加）

```
RED tests:
  ✗ createNotebook 返回 409 时，显示 "名称已存在" 错误
  ✗ createProject 返回 409 时，显示 "名称已存在" 错误
```

**测试文件**：`packages/web/src/__tests__/notebookSlice.test.ts`（追加）

```
RED tests:
  ✗ rerun_notebook WS 消息 → 清空所有 cells outputs
  ✗ rerun_notebook WS 消息 → 所有 cells status 重置为 pending
```

**GREEN**：
- `ProjectSidebar.tsx`：捕获 409，显示错误提示
- `Notebook.tsx`：新增重执行按钮 + 确认对话框
- `wsSlice.ts`：处理 `rerun_started` 服务端消息

---

## 十二、实施顺序

```
Step 1 (titleToSlug)
  │
  ▼
Step 2 (409 拒绝)     ← 可与 Step 1 并行
  │
  ▼
Step 3 (notebookPath 移入 worktree)
  │
  ▼
Step 4 (Session gitRoot)  ← 依赖 Step 3
  │
  ▼
Step 5 (DB 迁移)          ← 依赖 Step 3
  │
  ▼
Step 6 (Merge 选择性合入)  ← 独立
  │
  ▼
Step 7 (重执行后端)        ← 独立
  │
  ▼
Step 8 (前端 UI)           ← 依赖 Step 2, 7
```

Step 1-2 可并行，Step 6-7 可并行，其余按顺序。
