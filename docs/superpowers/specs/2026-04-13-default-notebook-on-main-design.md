# 默认 Notebook 直接工作在项目默认分支

> 下文 `{defaultBranch}` 占位符表示 project 的初始分支名，实际值由 `git init` + `git symbolic-ref HEAD` 读取（本仓库当前为 `master`，gitconfig `init.defaultBranch` 为 `main` 的环境则为 `main`）。禁止在代码中硬编码字符串常量。

日期：2026-04-13
状态：设计待实现

## 背景与目标

当前实现中，任何 notebook 都通过 `git worktree + branch` 机制创建：每个 notebook 位于 `project/.worktrees/task-{slug}/`，持有独立分支。Project 根（{defaultBranch} 分支）上没有 notebook.json。

新方案：project 创建时自动生成一个**默认 notebook**，直接位于 project 根（{defaultBranch} 分支），不走 worktree。仅第二个及之后新建的 notebook 才继续使用 worktree + 分支机制。

## 核心约定

- 文件系统一律使用 slug（`generateSlug('nb')`）作为文件名与路径。
- 用户在前端输入的 notebook 名字存入 `metadata.title`，前端渲染用 title。
- **Title 唯一性作用域**：同一 project 内所有 notebook（默认 + worktree）的 title 精确字符串唯一（区分大小写与空格）。
- 前端对用户输入名做非法字符 / 重名校验：不允许非法字符（`/`、`:`、控制字符等）与同 project 内已有 title 重名，强制用户改名。
- 不考虑历史兼容性，直接硬升级。

## 文件布局

```
project/
  {nb-default-slug}.notebook.json   ← 默认 notebook（提交到 {defaultBranch}）
  .working/                         ← 默认 notebook 的 task-ai 工作目录
  .deliverables/                    ← 默认 notebook 的产出目录
  .claude/                          ← 不入 git（gitignore.template 已忽略）
    settings.json                   ← SessionStart hook，用于加载 .MEMORY.md（含绝对路径，机器本地）
  .MEMORY.md
  .worktrees/
    task-{slug}/                    ← 第二个及以后的 notebook
      {slug}.notebook.json
      .working/
      .deliverables/
```

默认 notebook 与项目共享 project 根下的工作区：
- **入 git**：`{slug}.notebook.json`、`.working/`（除 gitignore 覆盖的瞬时文件）、`.deliverables/`、`.MEMORY.md`
- **不入 git（本地）**：`.claude/`（gitignored，含绝对路径，机器本地生成）

## 是否为默认 notebook 的识别方式

**通过路径特征推导，不做持久化标志**：
- `notebook_path` 直接位于 `project.path` 下（同级） → 默认 notebook
- `notebook_path` 位于 `project.path/.worktrees/*/` 下 → worktree notebook

因此无需新增数据库列、也无需在 `metadata` 中写 `is_default`。列表、删除等接口按此规则判断。

**路径比较规范化**：判定前对 `notebook_path` 与 `project.path` 均调用 `path.resolve()`（或等价规范化）去除末尾斜杠、`..`、相对路径差异。具体判定式：`path.dirname(path.resolve(notebook_path)) === path.resolve(project.path)` → 默认 notebook。避免因字符串不一致导致误判。

## 行为规范

### 创建 project（`POST /projects`）

**API 入参不变**，不要求用户指定默认 notebook 名。默认 notebook 初始 `metadata.title = project 名`。

现有 project 创建流程末尾新增"创建默认 notebook"子步骤：

1. 读取项目默认分支名：`{defaultBranch} = git.raw(['symbolic-ref', '--short', 'HEAD'])`。
2. 生成 nb slug（`generateSlug('nb')`），检查 `project.path/{slug}.notebook.json` 不存在，冲突则重试。
3. 在 project 根写入 `{slug}.notebook.json`（初始空 notebook，`metadata.title = project 名`）。默认 title 合法性直接继承 project 名自身的校验（由 project 创建接口既有逻辑保证），不做二次 sanitize。
4. 在 project 根创建 `.working/`、`.deliverables/`，调用 `initTaskWorkingDir({ worktreePath: project.path, nbSlug, title, branchName: {defaultBranch} })`。（默认 notebook 没有独立分支，`branchName` 传 project 的当前分支。）
5. 在 project 根调用 `initWorkspaceMemory(project.path, /* projectPath */ undefined, { skipClaudeSettings: false })`：
   - 第二参数传 `undefined`（默认 notebook 自身即 project 级，`.MEMORY.md` 不追加"Project Deliverables"段）。
   - **不跳过** `.claude/settings.json`：默认 notebook 的 Claude session cwd 即 project 根，需要 SessionStart hook 加载 `.MEMORY.md`。
   - **时序约束**：现有 project 初始化流程中若已调用过 `initWorkspaceMemory(project.path, ..., { skipClaudeSettings: true })`，需将那次调用**移除**，只保留此处这一次，避免重复写入与覆盖冲突。
6. DB 登记该 notebook：`notebook_path = project.path/{slug}.notebook.json`，`metadata.worktree_path = null`。
7. 创建 session：`sessionManager.createSession(notebookPath, /* worktreePath */ project.path)`。默认 notebook 的 "worktreePath" 语义为"会话工作目录"，传 `project.path`（不传 `null`，避免下游 fallback 歧义）；工作分支 = {defaultBranch}（不切换分支）。
8. Git 提交到 {defaultBranch}：`git add {slug}.notebook.json .working/ .deliverables/ .MEMORY.md && git commit`（best-effort）。
   - **不**将 `.claude/` 加入提交：`.claude/` 已被 `gitignore.template` 忽略，且 `settings.json` 含机器相关绝对路径，不应跨机器共享。
   - `.working/` 中的瞬时文件（`.auto-signal`、`.lock` 等）已被 `gitignore.template` 忽略，`git add .working/` 会自动跳过。

**失败回滚**：上述任一步失败，整个 project 创建视为失败，回滚 project 目录（沿用现有 project 创建回滚机制）。

**空 notebook 初始结构**：复用 `notebookStore.createNew(title, workspaceDir)` 的返回形态（已在 `packages/server/src/notebook-store.ts` 定义），不另行约定新的 schema。

### 列出 project 的 notebooks（`GET /projects/:id/notebooks`）

1. 扫描 `.worktrees/*/` 下的 `*.notebook.json`（现有逻辑）。
2. 额外扫描 **project 根顶层**的 `*.notebook.json`（不递归、不扫隐藏目录），命中文件视为默认 notebook。
3. 默认 notebook 置于列表首位。
4. 若 project 根出现多个 `*.notebook.json`（异常情况，如用户手工放置或导入产物），按文件名 slug 升序取第一个为默认，**其余既不登记到 DB、也不纳入列表返回**，仅在后端日志记录警告。用户需手工清理冗余文件。
5. 过滤精确匹配：只识别 `*.notebook.json` 作为 notebook 文件，排除 `*.notebook.json.bak`、同名目录等。
6. **API 响应新增 `is_default: boolean` 字段**：派生字段，**不入 DB、不入 metadata**，由后端根据 `notebook_path` 相对 `project.path` 的位置推导后注入响应。前端无需再做路径判断。后端保证默认 notebook 在响应数组中排在首位。
7. 列表接口只过滤"不纳入返回"；**不**清理 DB 中可能残留的冗余 notebook 记录（DB/FS 解耦，清理由显式维护操作承担）。

### 新建 notebook（`POST /projects/:id/notebooks`）

接口逻辑不变：所有用户主动新建的 notebook 继续走 `.worktrees/task-{slug}/` + 独立分支路径。默认 notebook 仅由 project 创建流程自动生成，用户不能主动创建第二个默认 notebook。

**后端 title 唯一性兜底校验**：新建与 rename 接口都需在后端（DB 查询同 project 下所有 notebook title）做精确匹配校验，前端校验仅是 UX。冲突返回 409。

### 删除 notebook（`DELETE /projects/:id/notebooks/:slug`）

**复用现有 `DELETE` endpoint**，后端根据路径特征分流，不新增专用 reset endpoint。

- **非默认 notebook**（路径在 `.worktrees/` 下）：现有逻辑不变（关闭 session、移除 worktree、删除分支、清理 DB）。
- **默认 notebook**（路径直接在 project 根下）：**不允许真正删除**，请求语义为"重置 notebook 内容"：
  1. 若存在活跃 session，关闭之（不自动重启，用户下次打开 notebook 时再启动）。
  2. 覆写 `{slug}.notebook.json`：内容复用 `notebookStore.createNew(currentTitle, project.path)` 的初始形态，**保留 `metadata.title` 与 `metadata.created_at`**（created_at 代表 notebook 首次创建时间，不随重置改变），其他字段（cells、模型选择、运行态等）回到初始值，避免 stale 残留。
  3. DB 中 cells 清空，notebook 记录保留。
  4. **不清空** `.working/`、`.deliverables/`。
  5. **不改变 git 行为**：不回滚 commit 历史、不强制提交 reset 后的文件。

### 导入 / 解压上传 project（现有 `projects.ts:629` 附近）

扫描上传包注册 notebook 时，检查 project 根是否已含 `*.notebook.json`：
- 若已含：将其作为默认 notebook 登记（按 slug 升序取首位）；其余文件与列表接口一致——**既不登记到 DB、也不纳入列表返回**，仅后端日志记警告。
- 若未含：**自动生成一个空的默认 notebook**（同"创建 project"的默认 notebook 生成步骤，`{defaultBranch}` 从解压后 project 的 `git symbolic-ref HEAD` 读取）；若默认 title（project 名）与上传包内已有 worktree notebook title 冲突，追加 `-2`、`-3` 后缀直到唯一，保持"每个 project 必有默认 notebook"的不变式。

**`.MEMORY.md` 冲突处理（仅导入场景）**：若上传包已含 `.MEMORY.md`（用户自定义），**不覆盖**，跳过 `.MEMORY.md` 写入但仍生成 `.claude/settings.json` 以加载该已有 `.MEMORY.md`。实现上给 `initWorkspaceMemory` 新增参数 `skipMemoryWrite?: boolean`（或等价拆分），保持函数语义原子。正常创建 project 时 project 目录刚建，不会存在 `.MEMORY.md`，本规则不触发。

### 重命名

默认 notebook 的 title 可由用户修改（复用现有 rename 接口，仅改 `metadata.title`，文件名 slug 保持不变）。rename 时同样校验 title 在 project 内唯一。

**Worktree notebook 的 rename 行为本 spec 不改动**，维持现状（若现状涉及 worktree 目录或分支改名，照旧）。

## 既有代码适配（实现 plan 阶段审计）

默认 notebook 的 `metadata.worktree_path = null`、`notebook_path` 直接位于 project 根。现有代码多处依赖 `worktree_path` 非空或路径形如 `.worktrees/task-*/` 的假设，实现前需做一次 grep 审计：

- `packages/server/src/session.ts`：session cwd / 分支推导逻辑
- `packages/server/src/routes/notebooks.ts`：notebook CRUD、rename、delete 分发
- `packages/server/src/routes/projects.ts`：列表扫描、删除、导入
- `packages/server/src/git-utils.ts`、`packages/server/src/git.ts`：worktree 相关辅助

对每一处依赖 `worktree_path` 的点，改造为 `worktree_path ?? project_path` 或等价 fallback。plan 阶段需列出完整改动清单。

## 前端改动范围

- **创建 notebook 表单**：增加用户输入名的非法字符 / 重名校验。
- **Notebook 列表**：默认 notebook 首位展示，title 来自 metadata。
- **删除按钮 UX**：默认 notebook 的按钮文案改为"重置"或"清空内容"；点击时的确认弹框明确提示"默认 notebook 无法删除，该操作将清空 notebook 内容，`.working/` 与 `.deliverables/` 保留"。

## 已知代价

**`.working/` 入 main 分支会污染主干 git log**：默认 notebook 每次 task-ai 操作都会修改 `.working/.status.json`、`.plan.md` 等状态文件。worktree notebook 场景下这些 commit 落在各自任务分支，互不影响；默认 notebook 放在 main 后，这些瞬时状态的 commit 会进入主分支历史，使 `git log` 含大量任务状态更新。

**本 spec 决策**：**接受此代价**，保持与 worktree notebook 的状态文件 commit 机制一致（便于 task-ai 跨 notebook 行为统一）。若后续确有诉求，可另行扩展 `gitignore.template` 在 project 根忽略 `.working/` 下的易变文件（但要保留 `.target.md`、`.plan.md` 等长存文档的版本化）。此扩展不纳入本 spec。

## 存量 / 老 Project 行为

不做迁移、不做自动补默认、不提供"提升 worktree 为默认"操作。老 project 列表中没有默认 notebook，用户若需要可重建 project。该行为在实现 PR 描述中说明。

## 测试要点

1. 创建 project：默认 notebook 自动生成，`{slug}.notebook.json` 存在于 project 根，已提交到 {defaultBranch}，`.claude/settings.json` 存在。
2. 列表接口：默认 notebook 首位，title 正确，路径识别逻辑正确。
3. 新建第二个 notebook：走 worktree，不影响默认 notebook。
4. 删除默认 notebook：
   - `{slug}.notebook.json` 被覆写为空内容、`metadata.title` 保留
   - DB cells 清空、notebook 记录保留
   - `.working/`、`.deliverables/` 未被清空
   - git 历史未改变
5. 删除非默认 notebook：worktree 与分支被正确清理。
6. 前端校验：非法字符、重名均阻止创建。
7. 解压上传 project：
   - 含根级 notebook.json → 正确识别为默认
   - 不含 → 自动补默认 notebook（title 与已有 worktree notebook title 冲突时追加后缀）
   - 含用户自定义 `.MEMORY.md` → 不被覆盖，`.claude/settings.json` 仍正确生成
8. Project 根出现多个 `*.notebook.json`：排序首位为默认，其余不进列表、日志有警告。
9. Project 创建流程中默认 notebook 生成失败 → 整个 project 创建回滚。
10. 默认 notebook slug 冲突：`generateSlug` 首次命中已有文件名时，重试生成。
11. Title 唯一性：
    - 同 project 内默认 notebook 与 worktree notebook 不能同名（rename 或新建均阻止）。
    - 精确字符串匹配（区分大小写 / 空格）。
12. 默认 notebook rename：title 更新后列表与 session 仍正常运作。
13. 列表鲁棒性：project 根下 `foo.notebook.json.bak`、同名目录不被误识别为 notebook。
14. `worktree_path` null 兼容：所有依赖 `worktree_path` 的既有路径对默认 notebook 仍正确工作。

## 未处理项

无。存量 project 按硬升级处理，UX 决策已敲定。
