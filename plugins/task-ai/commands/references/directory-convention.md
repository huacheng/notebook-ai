# Directory Convention

## Directory Tree

```
$NB_WORKSPACES_ROOT/                        # 环境变量: NB_WORKSPACES_ROOT
│
├── .library/                               # 环境变量: NB_WORKSPACES_LIBRARY (共享知识库，独立 git 仓库)
│   ├── .git/
│   ├── .changelog                          # 追加日志（所有库写入，gitignore）
│   ├── .changelog-archive/                 # 归档（月度快照，git 追踪）
│   ├── .master-index.md                    # 所有库文件扁平索引（冷启动用，git 追踪）
│   ├── .type-registry.md                   # 任务类型注册表（seed + 自动扩展）
│   ├── .plugin-registry.md                 # 插件能力缓存（惰性创建，gitignore）
│   ├── .ioc.md                             # 跨文档域名聚合 IOC 记录（gitignore）
│   ├── .inconsistency.log                  # 索引不一致记录（gitignore）
│   ├── .memory/                            # 系统管理的知识库
│   │   ├── .type-profiles/                 # 共享任务类型方法论
│   │   │   ├── .lock
│   │   │   ├── .index.md                   # type → 文件指针表
│   │   │   └── <type>.md                   # 跨任务域方法论
│   │   ├── .experiences/                   # 跨任务经验库（按 type 分类）
│   │   │   ├── .lock
│   │   │   ├── .index.md                   # type → 子目录指针表
│   │   │   ├── .summary.md                 # 经验库概览
│   │   │   └── <type>/
│   │   │       ├── .index.md               # notebook → 文件查找表
│   │   │       ├── .summary.md             # 该类型经验概览
│   │   │       └── <notebook>-<source>.md  # source: complete|impl|verify|eval
│   │   ├── .references/                    # 外部参考资料（versioned）
│   │   │   ├── .lock
│   │   │   ├── .index.md                   # topic → 文件查找表（含版本、时效）
│   │   │   ├── .summary.md                 # 参考库概览
│   │   │   └── <topic>-v<N>-<date>.md      # 版本化外部参考文件
│   │   └── .thinking/                      # Thinking CoT 原始记录 + 蒸馏模式
│   │       ├── .index.md                   # raw vs patterns 导航
│   │       ├── raw/                        # L0 原始 CoT（gitignore）
│   │       │   ├── .index.md               # 追加日志索引（O_APPEND，无锁）
│   │       │   └── <notebook>-<step>-<date>.md
│   │       └── patterns/                   # L1 蒸馏推理模式（git 追踪）
│   │           ├── .lock
│   │           ├── .index.md
│   │           └── <problem-type>.md
│   └── <user-imported>/                    # 用户导入文件夹（非点前缀）
│       └── ...                             # 任意结构，library search 也会索引
│
├── project-a/                              # 项目目录（独立 git 仓库）
│   ├── .git/
│   ├── .gitignore                          # task-ai 自动添加 .working/ 临时文件忽略规则
│   ├── .deliverables/                      # project 级交付物目录（所有 notebook 共用）
│   │   └── .report-<notebook>.md           # 完成报告（由 report 子命令生成）
│   │
│   └── .worktrees/                         # git worktrees 目录
│       ├── task-notebook-1/                # 环境变量: NB_WORK_DIR — notebook 根目录
│       │   ├── .deliverables/              # 任务交付物（exec 阶段产出，merge 时复制到 project 级）
│       │   └── .working/                   # 环境变量: TASKAI_WORK_DIR — task-ai 系统文件目录
│       │       ├── .status.json            # 任务元数据（status/phase/type...）
│       │       ├── .target.md              # 需求目标（人工编写）
│       │       ├── .convergence-baseline.md # 加权 R# 收敛评分基线
│       │       ├── .pending-refinements.md # 异步需求缓冲区
│       │       ├── .plan.md                # 实施计划
│       │       ├── .plan-superseded.md     # 旧计划归档
│       │       ├── .type-profile.md        # 任务域方法论
│       │       ├── .summary.md             # 压缩上下文摘要
│       │       ├── .auto-stop              # 停止信号（临时，gitignore）
│       │       ├── .auto-timeline.md       # 执行时间线
│       │       ├── .lock                   # 并发锁（gitignore）
│       │       ├── .library-state.json     # 库读取游标（gitignore）
│       │       ├── vh-stubs.*              # VFP: 验证假设 stubs
│       │       ├── vh-baseline.md          # VFP: VH 初始失败状态基线
│       │       ├── .analysis/              # check 评估历史
│       │       │   └── .summary.md
│       │       ├── .test/                  # 测试准则 & 结果
│       │       │   ├── .summary.md
│       │       │   ├── <date>-cumulative-green.jsonl
│       │       │   └── hil-snapshots/
│       │       ├── .bugfix/                # 问题修复历史
│       │       │   └── .summary.md
│       │       └── .notes/                 # 研究笔记 & 执行日志
│       │           └── .summary.md
│       │
│       └── task-notebook-2/
│           └── .working/
│               └── ...
│
└── project-b/                              # 另一个项目（独立 git 仓库）
    ├── .git/
    └── .worktrees/
        └── ...
```

## Architecture Overview

- **Workspace** (`$NB_WORKSPACES_ROOT`): Contains multiple projects and a shared library
- **Library** (`.library/`): Shared knowledge base, independent git repository
- **Project** (`<project>/`): Each project is an independent git repository
- **Notebook** (`<project>/.worktrees/task-<notebook>/`): Each notebook is a git worktree on branch `task/<notebook>`
- **System Files** (`<notebook>/.working/`): task-ai managed files (status, plan, analysis, etc.)

## Environment Variables

| Variable | Path | Description |
|----------|------|-------------|
| `NB_WORKSPACES_ROOT` | (env var) | Workspace root containing all projects |
| `NB_WORKSPACES_LIBRARY` | `$NB_WORKSPACES_ROOT/.library/` | Shared knowledge library |
| `NB_NOTEBOOK` | — | Notebook name (without `task-` prefix) |
| `NB_WORK_DIR` | `<project>/.worktrees/task-<notebook>/` | Notebook root directory |
| `TASKAI_WORK_DIR` | `<notebook>/.working/` | task-ai system files directory |

## Path Resolution

The `resolve_nb_workdir()` function in `lib.sh` detects notebook context:

1. **From CWD**: Walk up directory tree looking for `.working/.status.json`
2. **From git branch**: Parse `task/<notebook>` branch name, search for matching worktree

```bash
source "$TASK_AI_ROOT/core/lib.sh"
resolve_nb_workdir              # Auto-detect
resolve_nb_workdir "my-task"    # Explicit notebook name

# After resolution:
echo "$NB_NOTEBOOK"       # → my-task
echo "$NB_WORK_DIR"       # → /path/to/project/.worktrees/task-my-task
echo "$TASKAI_WORK_DIR"   # → /path/to/project/.worktrees/task-my-task/.working
```

## Git Branch Convention

- Branch name: `task/<notebook>` (e.g., `task/fix-login-bug`)
- Worktree path: `<project>/.worktrees/task-<notebook>/`
- Creating a notebook = creating a git worktree from main branch

## File Conventions

- **Dot-prefixed** files in `.working/` are system-managed; `.target.md` and `.plan.md` are human-editable via the Plan annotation panel
- `.convergence-baseline.md` is generated by `target` with atomized R# requirements and weights; `check` evaluates deliverables against these R# items to compute convergence score and trigger ROLLBACK when score does not improve
- `.pending-refinements.md` is an async refinement buffer — captures new requirements or scope changes observed during auto execution, deferred until the next `evolving` → `planning` transition
- `.plan.md` is the implementation plan file, generated by `plan --generate` and editable through the Plan panel
- `.auto-stop` and `.lock` are ephemeral (in `.gitignore`)
- `.notes/` files use origin suffix: `<YYYY-MM-DD>-<summary>-plan.md` or `<YYYY-MM-DD>-<summary>-exec.md`
- `.test/` files use phase prefix: `<YYYY-MM-DD>-<phase>-criteria.md` (test plan) or `<YYYY-MM-DD>-<phase>-results.md` (test outcomes)
- `.summary.md` is a condensed context file — written by `plan`/`check`/`exec` after each run, read by subsequent steps instead of all history files. Prevents context window overflow as task accumulates history
- Each history directory (`.analysis/`, `.test/`, `.bugfix/`, `.notes/`) contains a `.summary.md` that condenses all entries in that directory

## Naming Convention

Project names and notebook names share the same validation rule: ASCII letters, digits, hyphens, underscores only (`[a-zA-Z0-9_-]+`). No whitespace, no leading dot, no path separators. Examples: `project-a`, `notebook-1`, `my-research`.

## Merge Path Mapping

During `merge`, `<notebook>/.deliverables/` on the task branch is copied to `<project>/.deliverables/` on main. No full git merge — only deliverables are transferred. All notebooks share the same project-level deliverables directory.

```
Source (task branch):  <project>/.worktrees/task-<notebook>/.deliverables/*
Target (main branch):  <project>/.deliverables/*
```

Non-system file output (code, configs, assets) during exec MUST be written to `$NB_WORK_DIR/.deliverables/`, not elsewhere in the project tree.
