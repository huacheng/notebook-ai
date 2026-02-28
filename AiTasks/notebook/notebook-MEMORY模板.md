# Notebook MEMORY.md 生成模板

## 代码位置

- **生成函数**: `packages/server/src/workspace.ts` → `initWorkspaceMemory(workspaceDir, projectPath?)`
- **调用点 1**: `routes/notebooks.ts:232` — 独立 notebook（无 projectPath）
- **调用点 2**: `routes/projects.ts:112` — 项目 notebook（传入 project.path）
- **测试**: `packages/server/src/__tests__/workspace.test.ts`

## 独立 notebook 输出

`initWorkspaceMemory(workspaceDir)`

```markdown
# MEMORY

## Shared Library Directory

Path (relative to this workspace): `../.library`
Absolute path: `/home/ubuntu/nb-workspaces/.library`

This is the shared library directory accessible to all notebooks.
You can both read from and write to this directory.
Use it to store datasets, scripts, configuration files, and other
resources that should be shared across notebooks.

## Deliverables Directory

Path: `.deliverables`
Absolute path: `/home/ubuntu/nb-workspaces/my-notebook/.deliverables`

This is the deliverables directory for this notebook.
Place final outputs here — reports, exported files, generated artifacts,
and any other deliverables that should be presented to the user.
Files in this directory are shown in the right panel of the UI.
```

## 项目 notebook 输出

`initWorkspaceMemory(worktreePath, project.path)`

```markdown
# MEMORY

## Shared Library Directory

Path (relative to this workspace): `../../../../.library`
Absolute path: `/home/ubuntu/nb-workspaces/.library`

This is the shared library directory accessible to all notebooks.
You can both read from and write to this directory.
Use it to store datasets, scripts, configuration files, and other
resources that should be shared across notebooks.

## Deliverables Directory

Path: `.deliverables`
Absolute path: `/home/ubuntu/nb-workspaces/my-project/.worktrees/task-fix-auth/.deliverables`

This is the deliverables directory for this notebook.
Place final outputs here — reports, exported files, generated artifacts,
and any other deliverables that should be presented to the user.
Files in this directory are shown in the right panel of the UI.

## Project Deliverables Directory

Path (relative to this workspace): `../../.deliverables`
Absolute path: `/home/ubuntu/nb-workspaces/my-project/.deliverables`

This is the project-level deliverables directory shared across all notebooks in the project.
```

## 所有绝对路径均由创建时的 cwd 动态计算

| 变量 | 计算方式 |
|------|----------|
| library 相对路径 | `path.relative(workspaceDir, getLibraryDir())` |
| library 绝对路径 | `getLibraryDir()` |
| notebook deliverables 绝对路径 | `path.join(workspaceDir, '.deliverables')` |
| project deliverables 相对路径 | `path.relative(workspaceDir, path.join(projectPath, '.deliverables'))` |
| project deliverables 绝对路径 | `path.join(projectPath, '.deliverables')` |
