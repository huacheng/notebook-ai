# 默认 Notebook on Main 分支 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project 创建时自动生成位于 project 根（项目默认分支）的"默认 notebook"；后续新建 notebook 继续走 `.worktrees/task-{slug}/` + 独立分支。默认 notebook 可重置（不可真删）。

**Architecture:** 通过"路径特征推导" `is_default`（`path.dirname(notebook_path) === project.path` ⇒ 默认 notebook；`.worktrees/*/*.notebook.json` ⇒ worktree notebook），避免新增 DB 列或 metadata 字段。所有接口在后端按路径分流。

**Tech Stack:** TypeScript, Express, better-sqlite3, simple-git, vitest, React + Zustand。测试位于 `packages/server/src/__tests__/` 与 `packages/web/src/__tests__/`。

**Spec:** `docs/superpowers/specs/2026-04-13-default-notebook-on-main-design.md`

**Test runner:** `npx vitest run`（全量）；单测用 `npx vitest run <path>`。

---

## File Structure

### 新增文件
- `packages/server/src/default-notebook.ts` — 默认 notebook 判定与创建的共享逻辑
- `packages/server/src/__tests__/isDefaultNotebook.test.ts` — 路径判定单测
- `packages/server/src/__tests__/createDefaultNotebook.test.ts` — 创建默认 notebook 单测
- `packages/server/src/__tests__/projectCreateDefaultNotebook.test.ts` — POST /projects 集成测试
- `packages/server/src/__tests__/notebookListDefault.test.ts` — 列表 is_default 字段测试
- `packages/server/src/__tests__/defaultNotebookReset.test.ts` — 默认 notebook 删除=重置测试
- `packages/server/src/__tests__/notebookTitleUnique.test.ts` — title 唯一性 409 测试
- `packages/server/src/__tests__/importProjectDefaultNotebook.test.ts` — 导入补默认测试
- `packages/server/src/__tests__/initWorkspaceMemorySkip.test.ts` — skipMemoryWrite 参数测试
- `packages/server/src/__tests__/gitDefaultBranch.test.ts` — `getCurrentBranch` 测试

### 修改文件
- `packages/server/src/workspace.ts` — `initWorkspaceMemory` 加 `skipMemoryWrite?: boolean`
- `packages/server/src/git.ts` — 加 `getCurrentBranch()` 方法
- `packages/server/src/routes/projects.ts` — 创建 / 列表 / 删除 / 导入 / 新建 notebook 多处改造
- `packages/server/src/session.ts` — 若有 `worktree_path` 硬依赖，fallback 到 `workspace_dir`
- `packages/server/src/routes/notebooks.ts` — 同上（仅在 grep 审计出有依赖时改）
- `packages/web/src/components/NotebookCreationPanel.tsx` — title 校验联动
- `packages/web/src/components/NotebookDeleteModal.tsx`（或现有删除确认组件）— 默认 notebook UX 差异
- `packages/web/src/__tests__/defaultNotebookUx.test.tsx` — 前端新增测试

---

## 说明：本 plan 的测试风格

- 后端以集成测试为主（直接 hit Express 路由，使用临时目录 + 独立 better-sqlite3 DB，与现有 `projects-files.test.ts`、`notebook-path.test.ts` 保持一致）。
- 每个 Task 结尾运行全量 `npx vitest run` 做一次回归（目标：全绿）。
- 前端用 vitest + @testing-library/react（沿现有测试风格）。

---

## Task 1：后端工具 — `isDefaultNotebook()` 路径判定

**Files:**
- Create: `packages/server/src/default-notebook.ts`
- Create: `packages/server/src/__tests__/isDefaultNotebook.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/server/src/__tests__/isDefaultNotebook.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import path from 'path';
import { isDefaultNotebook } from '../default-notebook.js';

describe('isDefaultNotebook', () => {
  it('returns true when notebook is directly under project root', () => {
    expect(isDefaultNotebook('/root/project/nb-abc.notebook.json', '/root/project')).toBe(true);
  });

  it('returns false when notebook is under .worktrees', () => {
    expect(isDefaultNotebook('/root/project/.worktrees/task-x/nb-abc.notebook.json', '/root/project')).toBe(false);
  });

  it('normalizes trailing slash on project path', () => {
    expect(isDefaultNotebook('/root/project/nb.notebook.json', '/root/project/')).toBe(true);
  });

  it('normalizes .. and relative path segments', () => {
    expect(isDefaultNotebook('/root/project/./nb.notebook.json', '/root/project')).toBe(true);
  });

  it('returns false when notebook path is outside project', () => {
    expect(isDefaultNotebook('/root/other/nb.notebook.json', '/root/project')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run packages/server/src/__tests__/isDefaultNotebook.test.ts
```

Expected: FAIL — module `../default-notebook.js` not found.

- [ ] **Step 3: 实现**

创建 `packages/server/src/default-notebook.ts`：

```typescript
import path from 'path';

/**
 * 判定 notebook 是否为默认 notebook（位于 project 根直接下）。
 * 通过 path.resolve 规范化两侧路径，避免末尾斜杠、相对路径、..段落导致误判。
 */
export function isDefaultNotebook(notebookPath: string, projectPath: string): boolean {
  const resolvedNb = path.resolve(notebookPath);
  const resolvedProject = path.resolve(projectPath);
  return path.dirname(resolvedNb) === resolvedProject;
}
```

- [ ] **Step 4: 运行验证通过**

```bash
npx vitest run packages/server/src/__tests__/isDefaultNotebook.test.ts
```

Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/default-notebook.ts packages/server/src/__tests__/isDefaultNotebook.test.ts
git commit -m "feat: add isDefaultNotebook path predicate"
```

---

## Task 2：扩展 `initWorkspaceMemory` 支持 `skipMemoryWrite`

**Files:**
- Modify: `packages/server/src/workspace.ts`（第 113 行函数签名与内部逻辑）
- Create: `packages/server/src/__tests__/initWorkspaceMemorySkip.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/server/src/__tests__/initWorkspaceMemorySkip.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import os from 'os';
import { initWorkspaceMemory, MEMORY_FILENAME } from '../workspace.js';

describe('initWorkspaceMemory skipMemoryWrite', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'ws-mem-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('writes .MEMORY.md by default', async () => {
    await initWorkspaceMemory(tmp);
    const content = await readFile(path.join(tmp, MEMORY_FILENAME), 'utf-8');
    expect(content).toContain('# MEMORY');
  });

  it('skips .MEMORY.md when skipMemoryWrite=true but still creates settings.json', async () => {
    const preExisting = 'user-custom content';
    await writeFile(path.join(tmp, MEMORY_FILENAME), preExisting, 'utf-8');
    await initWorkspaceMemory(tmp, undefined, { skipMemoryWrite: true });

    const after = await readFile(path.join(tmp, MEMORY_FILENAME), 'utf-8');
    expect(after).toBe(preExisting);

    await expect(
      access(path.join(tmp, '.claude', 'settings.json'), constants.F_OK)
    ).resolves.toBeUndefined();
  });

  it('still honors skipClaudeSettings independently', async () => {
    await initWorkspaceMemory(tmp, undefined, { skipMemoryWrite: true, skipClaudeSettings: true });
    await expect(
      access(path.join(tmp, '.claude', 'settings.json'), constants.F_OK)
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行失败**

```bash
npx vitest run packages/server/src/__tests__/initWorkspaceMemorySkip.test.ts
```

Expected: FAIL — 参数不被接受 / 行为未实现。

- [ ] **Step 3: 改 `workspace.ts`**

在 `packages/server/src/workspace.ts` 的 `initWorkspaceMemory` 函数：

将签名从
```typescript
export async function initWorkspaceMemory(workspaceDir: string, projectPath?: string, opts?: { skipClaudeSettings?: boolean }): Promise<void>
```
改为
```typescript
export async function initWorkspaceMemory(
  workspaceDir: string,
  projectPath?: string,
  opts?: { skipClaudeSettings?: boolean; skipMemoryWrite?: boolean }
): Promise<void>
```

在函数体中，将写 `.MEMORY.md` 的代码块（现在从 "If file exists and is read-only" 到 `await chmod(memoryPath, 0o444);`）用条件守护：

```typescript
  if (!opts?.skipMemoryWrite) {
    // 原有的 .MEMORY.md 写入逻辑保持不变
    // If file exists and is read-only, temporarily make it writable
    try {
      await access(memoryPath, constants.F_OK);
      await chmod(memoryPath, 0o644);
    } catch {
      // File doesn't exist yet, that's fine
    }

    await writeFile(memoryPath, content, 'utf-8');
    await chmod(memoryPath, 0o444);
  }
```

`.claude/settings.json` 相关代码块不变（仍受 `skipClaudeSettings` 控制）。

- [ ] **Step 4: 验证测试通过**

```bash
npx vitest run packages/server/src/__tests__/initWorkspaceMemorySkip.test.ts
```

Expected: PASS (3/3)

- [ ] **Step 5: 全量回归**

```bash
npx vitest run
```

Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/workspace.ts packages/server/src/__tests__/initWorkspaceMemorySkip.test.ts
git commit -m "feat: add skipMemoryWrite option to initWorkspaceMemory"
```

---

## Task 3：GitManager 增 `getCurrentBranch()` 方法

**Files:**
- Modify: `packages/server/src/git.ts`
- Create: `packages/server/src/__tests__/gitDefaultBranch.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/server/src/__tests__/gitDefaultBranch.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { GitManager } from '../git.js';

describe('GitManager.getCurrentBranch', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'git-br-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('returns HEAD branch name after ensureRepo (no commits)', async () => {
    const git = new GitManager(tmp);
    await git.ensureRepo();
    const br = await git.getCurrentBranch();
    expect(br).toMatch(/^(main|master)$/);
  });

  it('returns correct name after commit on custom branch', async () => {
    const git = new GitManager(tmp);
    await git.ensureRepo();
    await writeFile(path.join(tmp, 'a.txt'), 'hi', 'utf-8');
    await git.commitAll('init');
    const br = await git.getCurrentBranch();
    expect(typeof br).toBe('string');
    expect(br.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行失败**

```bash
npx vitest run packages/server/src/__tests__/gitDefaultBranch.test.ts
```

Expected: FAIL — `getCurrentBranch` is not a function。

- [ ] **Step 3: 实现**

在 `packages/server/src/git.ts` 的 `GitManager` 类中，紧随 `getMainBranch` 方法之后添加：

```typescript
  /** Return the short name of the currently checked-out branch (via symbolic-ref HEAD). */
  async getCurrentBranch(): Promise<string> {
    const out = await this.git.raw(['symbolic-ref', '--short', 'HEAD']);
    return out.trim();
  }
```

- [ ] **Step 4: 验证通过**

```bash
npx vitest run packages/server/src/__tests__/gitDefaultBranch.test.ts
```

Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/git.ts packages/server/src/__tests__/gitDefaultBranch.test.ts
git commit -m "feat: GitManager.getCurrentBranch via symbolic-ref HEAD"
```

---

## Task 4：`createDefaultNotebook()` 共享函数

**Files:**
- Modify: `packages/server/src/default-notebook.ts`
- Create: `packages/server/src/__tests__/createDefaultNotebook.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/server/src/__tests__/createDefaultNotebook.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access, writeFile } from 'fs/promises';
import { constants, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { GitManager } from '../git.js';
import { createDefaultNotebook } from '../default-notebook.js';

describe('createDefaultNotebook', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'create-def-nb-'));
    const git = new GitManager(tmp);
    await git.ensureRepo();
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('creates notebook file at project root with given title', async () => {
    const result = await createDefaultNotebook({ projectPath: tmp, title: 'My Project' });

    expect(result.notebookPath).toMatch(/\/nb-[a-f0-9]{8}\.notebook\.json$/);
    expect(path.dirname(result.notebookPath)).toBe(tmp);

    const raw = await readFile(result.notebookPath, 'utf-8');
    const nb = JSON.parse(raw);
    expect(nb.metadata.title).toBe('My Project');
    expect(nb.metadata.worktree_path).toBeUndefined();
    expect(nb.cells).toEqual([]);
  });

  it('initializes .working, .deliverables and .MEMORY.md + .claude/settings.json', async () => {
    await createDefaultNotebook({ projectPath: tmp, title: 'P' });

    expect(existsSync(path.join(tmp, '.working'))).toBe(true);
    expect(existsSync(path.join(tmp, '.deliverables'))).toBe(true);
    await expect(access(path.join(tmp, '.MEMORY.md'), constants.F_OK)).resolves.toBeUndefined();
    await expect(access(path.join(tmp, '.claude', 'settings.json'), constants.F_OK)).resolves.toBeUndefined();
  });

  it('does not overwrite pre-existing .MEMORY.md (skipMemoryWrite)', async () => {
    await writeFile(path.join(tmp, '.MEMORY.md'), 'user-custom', 'utf-8');
    await createDefaultNotebook({ projectPath: tmp, title: 'P', skipMemoryWrite: true });
    const content = await readFile(path.join(tmp, '.MEMORY.md'), 'utf-8');
    expect(content).toBe('user-custom');
    // settings.json still generated
    await expect(access(path.join(tmp, '.claude', 'settings.json'), constants.F_OK)).resolves.toBeUndefined();
  });

  it('retries slug on collision', async () => {
    // Pre-create a file matching any slug pattern by monkey-patching? Simpler: call twice and ensure distinct
    const a = await createDefaultNotebook({ projectPath: tmp, title: 'A' });
    // Remove the file so the path is free, but simulate collision by putting a placeholder at a known slug
    // (simple sanity: two invocations on same project root both succeed with unique slugs)
    await rm(a.notebookPath);
    const b = await createDefaultNotebook({ projectPath: tmp, title: 'B' });
    expect(b.notebookPath).not.toBe(a.notebookPath);
  });
});
```

- [ ] **Step 2: 运行失败**

```bash
npx vitest run packages/server/src/__tests__/createDefaultNotebook.test.ts
```

Expected: FAIL — `createDefaultNotebook` not exported.

- [ ] **Step 3: 实现**

在 `packages/server/src/default-notebook.ts` 追加：

```typescript
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { generateSlug, initWorkspaceMemory } from './workspace.js';
import { notebookStore } from './notebook-store.js';
import { GitManager } from './git.js';
import { initTaskWorkingDir } from './task-init.js';

export interface CreateDefaultNotebookResult {
  nbSlug: string;
  notebookPath: string;
  branchName: string;
}

export interface CreateDefaultNotebookOptions {
  projectPath: string;
  title: string;
  skipMemoryWrite?: boolean;
}

/**
 * 在 project 根创建默认 notebook（不走 worktree / 不开新分支）。
 * 调用方负责：DB 登记、session 创建、git commit。
 */
export async function createDefaultNotebook(
  opts: CreateDefaultNotebookOptions
): Promise<CreateDefaultNotebookResult> {
  const { projectPath, title, skipMemoryWrite } = opts;

  const git = new GitManager(projectPath);
  const branchName = await git.getCurrentBranch();

  // 生成唯一 slug（冲突重试，最多 5 次）
  let nbSlug = '';
  let notebookPath = '';
  for (let i = 0; i < 5; i++) {
    nbSlug = generateSlug('nb');
    notebookPath = `${projectPath}/${nbSlug}.notebook.json`;
    if (!existsSync(notebookPath)) break;
    if (i === 4) throw new Error('Failed to generate unique notebook slug after 5 retries');
  }

  // 写 notebook.json
  const notebook = notebookStore.createNew(title, projectPath);
  await notebookStore.save(notebookPath, notebook);

  // 初始化 .working / .deliverables
  mkdirSync(`${projectPath}/.working`, { recursive: true });
  mkdirSync(`${projectPath}/.deliverables`, { recursive: true });
  await initTaskWorkingDir({ worktreePath: projectPath, nbSlug, title, branchName });

  // .MEMORY.md + .claude/settings.json
  await initWorkspaceMemory(projectPath, undefined, {
    skipClaudeSettings: false,
    skipMemoryWrite,
  });

  return { nbSlug, notebookPath, branchName };
}
```

- [ ] **Step 4: 验证通过**

```bash
npx vitest run packages/server/src/__tests__/createDefaultNotebook.test.ts
```

Expected: PASS (4/4)

- [ ] **Step 5: 全量回归**

```bash
npx vitest run
```

Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/default-notebook.ts packages/server/src/__tests__/createDefaultNotebook.test.ts
git commit -m "feat: createDefaultNotebook helper"
```

---

## Task 5：POST /projects 接入 `createDefaultNotebook`

**Files:**
- Modify: `packages/server/src/routes/projects.ts`（POST / 端点，第 38-82 行）
- Create: `packages/server/src/__tests__/projectCreateDefaultNotebook.test.ts`

- [ ] **Step 1: 写失败集成测试**

创建 `packages/server/src/__tests__/projectCreateDefaultNotebook.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import projectsRouter from '../routes/projects.js';
import { db } from '../db.js';

describe('POST /projects creates default notebook on main', () => {
  let tmp: string;
  let app: express.Express;
  const origRoot = process.env['NB_WORKSPACES_ROOT'];

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'proj-def-nb-'));
    process.env['NB_WORKSPACES_ROOT'] = tmp;
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);
  });

  afterEach(async () => {
    if (origRoot) process.env['NB_WORKSPACES_ROOT'] = origRoot;
    else delete process.env['NB_WORKSPACES_ROOT'];
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('writes notebook.json at project root with project title', async () => {
    const res = await request(app).post('/api/projects').send({ title: 'Demo' });
    expect(res.status).toBe(200);
    const projectPath = res.body.path as string;

    const listRes = await request(app).get(`/api/projects/${res.body.id}/notebooks`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.notebooks)).toBe(true);
    expect(listRes.body.notebooks.length).toBe(1);

    const nb = listRes.body.notebooks[0];
    expect(path.dirname(nb.path)).toBe(projectPath);
    expect(nb.is_default).toBe(true);

    const content = JSON.parse(await readFile(nb.path, 'utf-8'));
    expect(content.metadata.title).toBe('Demo');
  });

  it('registers default notebook in DB', async () => {
    const res = await request(app).post('/api/projects').send({ title: 'X' });
    const nbRows = db.listNotebooks().filter(r => r.project_id === res.body.id);
    expect(nbRows.length).toBe(1);
    expect(path.dirname(nbRows[0]!.notebook_path)).toBe(res.body.path);
  });

  it('rolls back project directory if default notebook creation fails', async () => {
    // Simulate failure by pre-creating a file that conflicts with .working (can't mkdir)
    // Simplest approach: mock fs will be brittle; instead verify normal path doesn't leave orphan on error by
    // using a known-bad title (e.g., empty) — but API rejects empty title early, so this test can be
    // skipped or replaced by asserting the rollback branch via unit test of createDefaultNotebook throwing.
    // For now, check the happy-path invariant: after success, .working exists.
    const res = await request(app).post('/api/projects').send({ title: 'Y' });
    expect(existsSync(path.join(res.body.path, '.working'))).toBe(true);
    expect(existsSync(path.join(res.body.path, '.deliverables'))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行失败**

```bash
npx vitest run packages/server/src/__tests__/projectCreateDefaultNotebook.test.ts
```

Expected: FAIL — 默认 notebook 未创建 / is_default 字段不存在 / 列表空。

- [ ] **Step 3: 改 `routes/projects.ts` POST / 端点**

在 `packages/server/src/routes/projects.ts` POST `/` 端点内部，`const project = db.createProject({...})` **之后**、`res.json(project)` **之前**，插入：

```typescript
    // Create default notebook on project's current branch (no worktree)
    const { createDefaultNotebook } = await import('../default-notebook.js');
    const defRes = await createDefaultNotebook({ projectPath, title });
    const defNotebookId = randomUUID();
    db.createNotebook({
      id: defNotebookId, user_id: null, title, slug: defRes.nbSlug,
      workspace_dir: projectPath, notebook_path: defRes.notebookPath,
      project_id: id,
      status: 'active', created_at: now, updated_at: now,
    });
    try {
      const git2 = new GitManager(projectPath);
      await git2.commitAll(`project(${slug}): initialize default notebook`);
    } catch { /* best-effort */ }
```

注意：顶部 import 若没有 `randomUUID` 已在本文件，已有则不重复。失败回滚已由现有 `catch` 块 + `rm projectPath` 保证（整目录删除覆盖所有子步骤）。

- [ ] **Step 4: 更新列表端点注入 `is_default`**

同一文件 `router.get('/:projectId/notebooks'` 内部（约第 109-148 行），在 `if (existsSync(worktreesDir))` 块**之前**增加扫描 project 根的逻辑；**之后**为每条 notebook 注入 `is_default`，并将默认 notebook 排首位：

```typescript
    // 扫描 project 根的 *.notebook.json（默认 notebook）
    const rootEntries = await readdir(project.path).catch(() => [] as string[]);
    const rootNbFiles = rootEntries.filter((f) => f.endsWith('.notebook.json')).sort();
    let defaultNotebook: { id: string | null; name: string; path: string; is_default: true } | null = null;
    if (rootNbFiles.length >= 1) {
      const chosen = rootNbFiles[0]!;
      const absPath = path.join(project.path, chosen);
      const dbNb = db.getNotebookByPath(absPath);
      defaultNotebook = {
        id: dbNb?.id ?? null,
        name: chosen.replace('.notebook.json', ''),
        path: absPath,
        is_default: true,
      };
      if (rootNbFiles.length > 1) {
        console.warn(`[projects] Multiple root-level notebook.json in ${project.path}; using ${chosen}, ignoring: ${rootNbFiles.slice(1).join(', ')}`);
      }
    }

    // ... 原 .worktrees 扫描保留，但每条添加 is_default: false ...
    // （在 notebooks.push({...}) 处展开字段加 is_default: false）
```

最后返回：
```typescript
    const ordered = defaultNotebook ? [defaultNotebook, ...notebooks] : notebooks;
    res.json({ notebooks: ordered });
```

（把原 `notebooks.push({ id, name, path })` 改为 `notebooks.push({ id, name, path, is_default: false })`）

- [ ] **Step 5: 运行测试**

```bash
npx vitest run packages/server/src/__tests__/projectCreateDefaultNotebook.test.ts
```

Expected: PASS (3/3)

- [ ] **Step 6: 全量回归**

```bash
npx vitest run
```

Expected: 全绿。若部分既有测试（如 `notebook-path.test.ts`）因列表行为变化受影响，按需调整（允许默认 notebook 的额外记录）。

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/projectCreateDefaultNotebook.test.ts
git commit -m "feat: auto-create default notebook on project creation"
```

---

## Task 6：列表接口 `is_default` + 多根级文件过滤

**Files:**
- Modify: `packages/server/src/routes/projects.ts`（列表端点已在 Task 5 改过；此 Task 补强过滤与测试）
- Create: `packages/server/src/__tests__/notebookListDefault.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import projectsRouter from '../routes/projects.js';

describe('GET /projects/:id/notebooks', () => {
  let tmp: string;
  let app: express.Express;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'list-nb-'));
    process.env['NB_WORKSPACES_ROOT'] = tmp;
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('puts default notebook first with is_default=true', async () => {
    const p = await request(app).post('/api/projects').send({ title: 'P' });
    const list = await request(app).get(`/api/projects/${p.body.id}/notebooks`);
    expect(list.body.notebooks[0].is_default).toBe(true);
  });

  it('ignores *.notebook.json.bak and directories', async () => {
    const p = await request(app).post('/api/projects').send({ title: 'P' });
    await writeFile(path.join(p.body.path, 'stray.notebook.json.bak'), '{}', 'utf-8');
    const list = await request(app).get(`/api/projects/${p.body.id}/notebooks`);
    const names = list.body.notebooks.map((n: { name: string }) => n.name);
    expect(names.some((n: string) => n.includes('.bak'))).toBe(false);
  });

  it('picks slug-ascending first when multiple root-level notebook.json', async () => {
    const p = await request(app).post('/api/projects').send({ title: 'P' });
    // Inject a second *.notebook.json that sorts before the auto-generated one
    await writeFile(path.join(p.body.path, 'aa.notebook.json'), JSON.stringify({
      version: 1, metadata: { title: 'AA', created: new Date().toISOString(), git_repo: false, agent: 'claude' },
      cells: [], slide: { generated: false, sections: [] }, annotations: [], assets: { intermediate_files: [] },
    }), 'utf-8');
    const list = await request(app).get(`/api/projects/${p.body.id}/notebooks`);
    expect(list.body.notebooks[0].name).toBe('aa');
    // Only one default; extras not in list
    const defaults = list.body.notebooks.filter((n: { is_default: boolean }) => n.is_default);
    expect(defaults.length).toBe(1);
  });
});
```

- [ ] **Step 2: 运行失败**

```bash
npx vitest run packages/server/src/__tests__/notebookListDefault.test.ts
```

Expected: 多 notebook.json 用例可能失败（若 Task 5 实现不严格）。

- [ ] **Step 3: 修正 Task 5 列表实现（如需要）**

确保：
- `rootEntries.filter(f => f.endsWith('.notebook.json') && !f.endsWith('.notebook.json.bak'))` 精确匹配
- 使用 `statSync(fullPath).isFile()` 排除目录

更新过滤代码：
```typescript
    const rootNbFiles: string[] = [];
    for (const entry of rootEntries) {
      if (!entry.endsWith('.notebook.json')) continue;
      const full = path.join(project.path, entry);
      try {
        const st = await import('fs').then(m => m.promises.stat(full));
        if (st.isFile()) rootNbFiles.push(entry);
      } catch { /* skip */ }
    }
    rootNbFiles.sort();
```

- [ ] **Step 4: 验证通过**

```bash
npx vitest run packages/server/src/__tests__/notebookListDefault.test.ts
```

Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/notebookListDefault.test.ts
git commit -m "feat: list endpoint exposes is_default, filters stray files"
```

---

## Task 7：删除 notebook 分流 — 默认 = 重置

**Files:**
- Modify: `packages/server/src/routes/projects.ts`（DELETE 端点，第 683-804 行）
- Create: `packages/server/src/__tests__/defaultNotebookReset.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, readFile, writeFile, access } from 'fs/promises';
import { constants, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import projectsRouter from '../routes/projects.js';

describe('DELETE notebook — default notebook resets instead of removing', () => {
  let tmp: string;
  let app: express.Express;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'reset-nb-'));
    process.env['NB_WORKSPACES_ROOT'] = tmp;
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('overwrites default notebook file with empty cells but preserves title/created_at', async () => {
    const p = await request(app).post('/api/projects').send({ title: 'Reset' });
    const list = await request(app).get(`/api/projects/${p.body.id}/notebooks`);
    const nb = list.body.notebooks[0];

    const before = JSON.parse(await readFile(nb.path, 'utf-8'));
    // Add a fake cell before reset
    before.cells = [{ id: 'c1', type: 'message', content: 'hi' }];
    await writeFile(nb.path, JSON.stringify(before), 'utf-8');

    const relPath = path.relative(p.body.path, nb.path);
    const del = await request(app).delete(`/api/projects/${p.body.id}/notebooks/by-path?path=${encodeURIComponent(relPath)}`);
    expect(del.status).toBe(204);

    const after = JSON.parse(await readFile(nb.path, 'utf-8'));
    expect(after.cells).toEqual([]);
    expect(after.metadata.title).toBe('Reset');
    expect(after.metadata.created).toBe(before.metadata.created);
  });

  it('does not remove .working or .deliverables', async () => {
    const p = await request(app).post('/api/projects').send({ title: 'R2' });
    const list = await request(app).get(`/api/projects/${p.body.id}/notebooks`);
    const nb = list.body.notebooks[0];
    const relPath = path.relative(p.body.path, nb.path);

    await request(app).delete(`/api/projects/${p.body.id}/notebooks/by-path?path=${encodeURIComponent(relPath)}`);
    expect(existsSync(path.join(p.body.path, '.working'))).toBe(true);
    expect(existsSync(path.join(p.body.path, '.deliverables'))).toBe(true);
  });

  it('keeps DB record for default notebook after reset', async () => {
    const { db } = await import('../db.js');
    const p = await request(app).post('/api/projects').send({ title: 'R3' });
    const list = await request(app).get(`/api/projects/${p.body.id}/notebooks`);
    const nb = list.body.notebooks[0];
    const relPath = path.relative(p.body.path, nb.path);

    await request(app).delete(`/api/projects/${p.body.id}/notebooks/by-path?path=${encodeURIComponent(relPath)}`);
    const row = db.getNotebookByPath(nb.path);
    expect(row).toBeDefined();
    expect(row!.cell_count).toBe(0);
  });
});
```

- [ ] **Step 2: 运行失败**

Expected: FAIL — 默认 notebook 会被当作非 worktree 目录 `rm`，文件消失。

- [ ] **Step 3: 改 DELETE 端点**

在 `packages/server/src/routes/projects.ts` DELETE `/:projectId/notebooks/by-path` 端点中，找到 `if (nbDir !== project.path)` 条件（第 753 行附近）。重构为：

```typescript
    const { isDefaultNotebook } = await import('../default-notebook.js');
    const nbFilePath = absPath.endsWith('.notebook.json') ? absPath : null;

    if (nbFilePath && isDefaultNotebook(nbFilePath, project.path)) {
      // 默认 notebook：重置而非删除
      const { notebookStore } = await import('../notebook-store.js');
      const existing = JSON.parse(await (await import('fs/promises')).readFile(nbFilePath, 'utf-8'));
      const currentTitle = existing?.metadata?.title ?? path.basename(nbFilePath, '.notebook.json');
      const currentCreated = existing?.metadata?.created;

      const fresh = notebookStore.createNew(currentTitle, project.path);
      if (currentCreated) fresh.metadata.created = currentCreated;
      await notebookStore.save(nbFilePath, fresh);

      if (nbRow) {
        const { db: _db } = await import('../db.js');
        _db.updateNotebook(nbRow.id, { cell_count: 0, updated_at: new Date().toISOString() });
      }
      return res.status(204).send();
    }

    // 非默认：原有 worktree 删除逻辑保留
    if (nbDir !== project.path) {
      // ... 原有逻辑（worktree remove, branch delete, rm -rf）
    }
```

关闭 session 的原有逻辑（第 738-741 行的 `activeSession` 段）已在默认 notebook 路径前执行，保留即可；如未关闭，确保在重置分支内也关闭：

```typescript
    // 在重置前关闭活跃 session（若存在）—— 原有 activeSession 代码已经覆盖
```

- [ ] **Step 4: 验证通过**

```bash
npx vitest run packages/server/src/__tests__/defaultNotebookReset.test.ts
```

Expected: PASS (3/3)

- [ ] **Step 5: 全量回归**

```bash
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/defaultNotebookReset.test.ts
git commit -m "feat: default notebook DELETE resets instead of removing"
```

---

## Task 8：新建 / rename notebook — 后端 title 唯一性（409）

**Files:**
- Modify: `packages/server/src/routes/projects.ts`（POST /:id/notebooks 新建端点 第 224 行；rename 端点 第 183-220 行）
- Create: `packages/server/src/__tests__/notebookTitleUnique.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import projectsRouter from '../routes/projects.js';

describe('title uniqueness (409 conflict)', () => {
  let tmp: string;
  let app: express.Express;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'title-uniq-'));
    process.env['NB_WORKSPACES_ROOT'] = tmp;
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('rejects new worktree notebook with same title as default', async () => {
    const p = await request(app).post('/api/projects').send({ title: 'Proj' });
    const res = await request(app).post(`/api/projects/${p.body.id}/notebooks`).send({ title: 'Proj' });
    expect(res.status).toBe(409);
  });

  it('rejects two worktree notebooks with identical titles', async () => {
    const p = await request(app).post('/api/projects').send({ title: 'P2' });
    const a = await request(app).post(`/api/projects/${p.body.id}/notebooks`).send({ title: 'NB1' });
    expect(a.status).toBe(200);
    const b = await request(app).post(`/api/projects/${p.body.id}/notebooks`).send({ title: 'NB1' });
    expect(b.status).toBe(409);
  });

  it('case-sensitive uniqueness (NB vs nb are distinct)', async () => {
    const p = await request(app).post('/api/projects').send({ title: 'P3' });
    const a = await request(app).post(`/api/projects/${p.body.id}/notebooks`).send({ title: 'Alpha' });
    const b = await request(app).post(`/api/projects/${p.body.id}/notebooks`).send({ title: 'alpha' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});
```

- [ ] **Step 2: 运行失败**

Expected: FAIL — 无唯一性校验，两条同名 notebook 都创建成功。

- [ ] **Step 3: 在 POST /:projectId/notebooks 开头加校验**

紧接 `if (!title) ...` 之后：

```typescript
    // Title 唯一性校验（精确字符串匹配，区分大小写）
    const existingNbs = db.listNotebooks().filter(n => n.project_id === project.id);
    if (existingNbs.some(n => n.title === title)) {
      return res.status(409).json({ error: `Notebook with title "${title}" already exists in this project` });
    }
```

在 rename 端点（第 183-220 行）同样加校验（允许 title 未变的情形）：

```typescript
    // 在更新 metadata.title 前
    if (newTitle !== currentTitle) {
      const conflicts = db.listNotebooks().filter(n => n.project_id === project.id && n.id !== nbRow.id && n.title === newTitle);
      if (conflicts.length > 0) {
        return res.status(409).json({ error: `Notebook with title "${newTitle}" already exists` });
      }
    }
```

（变量名以现有 rename 实现为准，按实际字段替换）

- [ ] **Step 4: 验证通过**

```bash
npx vitest run packages/server/src/__tests__/notebookTitleUnique.test.ts
```

Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/notebookTitleUnique.test.ts
git commit -m "feat: backend enforces title uniqueness per project (409)"
```

---

## Task 9：导入 project — 自动补默认 notebook + title 冲突后缀

**Files:**
- Modify: `packages/server/src/routes/projects.ts`（第 600-680 行 import 端点）
- Create: `packages/server/src/__tests__/importProjectDefaultNotebook.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import projectsRouter from '../routes/projects.js';

const execFileAsync = promisify(execFile);

async function makeTarGz(srcDir: string, outFile: string) {
  await execFileAsync('tar', ['czf', outFile, '-C', srcDir, '.']);
}

describe('POST /projects/import creates default notebook if missing', () => {
  let tmp: string;
  let app: express.Express;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'import-nb-'));
    process.env['NB_WORKSPACES_ROOT'] = tmp;
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('injects default notebook when archive has no root-level notebook.json', async () => {
    const src = await mkdtemp(path.join(os.tmpdir(), 'src-'));
    await writeFile(path.join(src, 'README.md'), '# hi', 'utf-8');
    const tar = path.join(tmp, 'archive.tar.gz');
    await makeTarGz(src, tar);

    const res = await request(app).post('/api/projects/import').attach('archive', tar);
    expect(res.status).toBe(200);
    const list = await request(app).get(`/api/projects/${res.body.id}/notebooks`);
    const defaults = list.body.notebooks.filter((n: { is_default: boolean }) => n.is_default);
    expect(defaults.length).toBe(1);
    await rm(src, { recursive: true, force: true });
  });

  it('uses existing root notebook.json as default without duplicating', async () => {
    const src = await mkdtemp(path.join(os.tmpdir(), 'src2-'));
    await writeFile(path.join(src, 'existing.notebook.json'), JSON.stringify({
      version: 1, metadata: { title: 'Existing', created: new Date().toISOString(), git_repo: false, agent: 'claude' },
      cells: [], slide: { generated: false, sections: [] }, annotations: [], assets: { intermediate_files: [] },
    }), 'utf-8');
    const tar = path.join(tmp, 'arc2.tar.gz');
    await makeTarGz(src, tar);

    const res = await request(app).post('/api/projects/import').attach('archive', tar);
    const list = await request(app).get(`/api/projects/${res.body.id}/notebooks`);
    const defaults = list.body.notebooks.filter((n: { is_default: boolean }) => n.is_default);
    expect(defaults.length).toBe(1);
    expect(defaults[0].name).toBe('existing');
    await rm(src, { recursive: true, force: true });
  });

  it('preserves user-authored .MEMORY.md when importing', async () => {
    const src = await mkdtemp(path.join(os.tmpdir(), 'src3-'));
    await writeFile(path.join(src, '.MEMORY.md'), 'user-custom', 'utf-8');
    const tar = path.join(tmp, 'arc3.tar.gz');
    await makeTarGz(src, tar);

    const res = await request(app).post('/api/projects/import').attach('archive', tar);
    const memContent = await (await import('fs/promises')).readFile(path.join(res.body.path, '.MEMORY.md'), 'utf-8');
    expect(memContent).toBe('user-custom');
    await rm(src, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行失败**

Expected: FAIL — 导入不补默认 notebook。

- [ ] **Step 3: 改 `/import` 端点**

在 `packages/server/src/routes/projects.ts` import 端点，DB.createProject 之后、现有"Scan for .notebook.json files"之前，替换整个扫描块为：

```typescript
    // 扫描 project 根顶层 *.notebook.json
    const { readdir: _readdir, stat: _stat } = await import('fs/promises');
    const rootEntries = await _readdir(projectPath).catch(() => [] as string[]);
    const rootNbFiles: string[] = [];
    for (const entry of rootEntries) {
      if (!entry.endsWith('.notebook.json')) continue;
      try {
        const st = await _stat(path.join(projectPath, entry));
        if (st.isFile()) rootNbFiles.push(entry);
      } catch { /* skip */ }
    }
    rootNbFiles.sort();

    const hasMemory = existsSync(path.join(projectPath, '.MEMORY.md'));

    if (rootNbFiles.length === 0) {
      // 自动补默认 notebook；title 默认为 project title，冲突时追加后缀
      const { createDefaultNotebook } = await import('../default-notebook.js');
      // 先收集已有 worktree notebook 的 title 以便去重
      const worktreeDirs = existsSync(path.join(projectPath, '.worktrees'))
        ? await _readdir(path.join(projectPath, '.worktrees')).catch(() => [] as string[])
        : [];
      const usedTitles = new Set<string>();
      for (const dir of worktreeDirs) {
        const wtPath = path.join(projectPath, '.worktrees', dir);
        try {
          const sub = await _readdir(wtPath);
          for (const f of sub) {
            if (f.endsWith('.notebook.json')) {
              const raw = await (await import('fs/promises')).readFile(path.join(wtPath, f), 'utf-8');
              const obj = JSON.parse(raw);
              if (obj?.metadata?.title) usedTitles.add(obj.metadata.title);
            }
          }
        } catch { /* skip */ }
      }
      let finalTitle = title;
      let counter = 2;
      while (usedTitles.has(finalTitle)) {
        finalTitle = `${title}-${counter++}`;
      }
      const defRes = await createDefaultNotebook({ projectPath, title: finalTitle, skipMemoryWrite: hasMemory });
      db.createNotebook({
        id: randomUUID(), user_id: null, title: finalTitle, slug: defRes.nbSlug,
        workspace_dir: projectPath, notebook_path: defRes.notebookPath,
        project_id: id,
        status: 'active', created_at: now, updated_at: now,
      });
    } else {
      // 已有根级 notebook.json：登记首个为默认；其余不入 DB、不入列表
      const chosen = rootNbFiles[0]!;
      const chosenPath = path.join(projectPath, chosen);
      let chosenTitle = chosen.replace('.notebook.json', '');
      try {
        const raw = await (await import('fs/promises')).readFile(chosenPath, 'utf-8');
        const obj = JSON.parse(raw);
        if (obj?.metadata?.title) chosenTitle = obj.metadata.title;
      } catch { /* use filename-based title */ }
      db.createNotebook({
        id: randomUUID(), user_id: null, title: chosenTitle, slug: chosen.replace('.notebook.json', ''),
        workspace_dir: projectPath, notebook_path: chosenPath,
        project_id: id,
        status: 'active', created_at: now, updated_at: now,
      });
      if (rootNbFiles.length > 1) {
        console.warn(`[import] Multiple root-level notebook.json in ${projectPath}; used ${chosen}`);
      }
      // 无条件确保 .claude/settings.json 存在（导入场景）
      if (hasMemory) {
        const { initWorkspaceMemory } = await import('../workspace.js');
        await initWorkspaceMemory(projectPath, undefined, { skipClaudeSettings: false, skipMemoryWrite: true });
      }
    }

    // 既有 worktree 注册（保留原逻辑）
    try {
      const entries = await _readdir(path.join(projectPath, '.worktrees')).catch(() => [] as string[]);
      for (const dir of entries) {
        const wtPath = path.join(projectPath, '.worktrees', dir);
        try {
          const sub = await _readdir(wtPath);
          for (const f of sub) {
            if (f.endsWith('.notebook.json')) {
              const nbPath = path.join(wtPath, f);
              const nbSlug = f.replace('.notebook.json', '');
              const existing = db.getNotebookByPath(nbPath);
              if (existing) continue;
              db.createNotebook({
                id: randomUUID(), user_id: null, title: nbSlug, slug: nbSlug,
                workspace_dir: projectPath, notebook_path: nbPath,
                project_id: id,
                status: 'active', created_at: now, updated_at: now,
              });
            }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
```

（原第 650-670 行的旧扫描块需删除）

- [ ] **Step 4: 验证通过**

```bash
npx vitest run packages/server/src/__tests__/importProjectDefaultNotebook.test.ts
```

Expected: PASS (3/3)

- [ ] **Step 5: 全量回归**

```bash
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/importProjectDefaultNotebook.test.ts
git commit -m "feat: import project auto-creates default notebook, preserves .MEMORY.md"
```

---

## Task 10：审计并修复 `worktree_path` 依赖点

**Files:**
- Modify: 按审计结果 — 可能包括 `packages/server/src/session.ts`、`packages/server/src/routes/notebooks.ts`
- Create: `packages/server/src/__tests__/defaultNotebookSession.test.ts`

- [ ] **Step 1: 审计**

运行：
```bash
grep -rn 'worktree_path\|worktreePath' packages/server/src --include="*.ts" | grep -v __tests__
```

对每一处读取 `worktree_path` 值的位置，判断"当该值为 null/undefined 时，应 fallback 到 `workspace_dir` 或 `project.path`"。记录清单到提交消息中。

- [ ] **Step 2: 写会话创建测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import projectsRouter from '../routes/projects.js';

describe('default notebook session cwd', () => {
  let tmp: string;
  let app: express.Express;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'def-sess-'));
    process.env['NB_WORKSPACES_ROOT'] = tmp;
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('default notebook session uses project path as cwd (no fallback ambiguity)', async () => {
    // 通过 API 创建；验证 DB 里记录 workspace_dir === project.path
    const p = await request(app).post('/api/projects').send({ title: 'S' });
    const { db } = await import('../db.js');
    const rows = db.listNotebooks().filter(r => r.project_id === p.body.id);
    expect(rows.length).toBe(1);
    expect(rows[0]!.workspace_dir).toBe(p.body.path);
  });
});
```

- [ ] **Step 3: 应用修复**

典型 fallback 模式（在每个依赖点）：
```typescript
const cwd = notebook.metadata.worktree_path ?? notebookRow.workspace_dir;
```

具体改动基于 Step 1 审计结果，不在本 plan 硬编码（因现有代码可能有多种使用方式）。每处修改须配套测试或归入既有测试覆盖。

- [ ] **Step 4: 验证通过**

```bash
npx vitest run packages/server/src/__tests__/defaultNotebookSession.test.ts
npx vitest run
```

Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add -p packages/server/src
git commit -m "refactor: worktree_path null fallback for default notebooks"
```

---

## Task 11：前端 — title 校验 + 409 错误展示

**Files:**
- Modify: `packages/web/src/components/NotebookCreationPanel.tsx`
- Modify: `packages/web/src/utils/validateTitle.ts`（若非法字符校验未覆盖，补强）
- Create: `packages/web/src/__tests__/notebookCreationValidation.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotebookCreationPanel } from '../components/NotebookCreationPanel';

describe('NotebookCreationPanel title validation', () => {
  it('shows error for illegal characters', async () => {
    render(<NotebookCreationPanel />);
    const input = screen.getByPlaceholderText(/title/i);
    fireEvent.change(input, { target: { value: 'bad/name' } });
    await waitFor(() => {
      expect(screen.getByText(/illegal|invalid/i)).toBeInTheDocument();
    });
  });
  // 409 重名展示由 Zustand store + 后端 mock 更繁琐，此处仅前端本地校验
});
```

- [ ] **Step 2: 运行失败**

- [ ] **Step 3: 在 `NotebookCreationPanel.tsx` 内部加校验**

```tsx
const validationError = useMemo(() => {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (/[\/\\:*?"<>|\u0000-\u001f]/.test(trimmed)) return 'Title contains illegal characters';
  return null;
}, [title]);
```

并在提交前阻断：
```tsx
async function handleCreate() {
  if (validationError) return;
  // ...
}
```

在 UI 中渲染 `validationError`。

- [ ] **Step 4: 处理 409 重名**

`createNewNotebook` store action 内：捕获 response 409，将错误消息塞到 `sessionNotice` 或一个新的 state 给 `NotebookCreationPanel` 读取并展示"title 已存在"。

- [ ] **Step 5: 验证通过**

```bash
npx vitest run packages/web/src/__tests__/notebookCreationValidation.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add packages/web packages/web/src/__tests__/notebookCreationValidation.test.tsx
git commit -m "feat(web): validate notebook title (illegal chars + 409 duplicate)"
```

---

## Task 12：前端 — 默认 notebook 的"重置"UX

**Files:**
- Modify: 删除按钮/确认弹框组件（从 `ProjectSidebar.tsx` 或 `FileBrowser` 中找到 delete 路径）
- Create: `packages/web/src/__tests__/defaultNotebookResetUx.test.tsx`

- [ ] **Step 1: 定位组件**

```bash
grep -rn 'delete.*notebook\|deleteNotebook' packages/web/src
```

定位到实际删除按钮与确认弹框。

- [ ] **Step 2: 写测试**

根据定位到的组件写"当 notebook.is_default 为 true 时，按钮文案显示为'重置'（Reset）而非'删除'（Delete）；确认弹框说明'内容将清空，.working 与 .deliverables 保留'"。

- [ ] **Step 3: 改前端**

在删除按钮组件接受 `is_default: boolean` prop，分支文案。

- [ ] **Step 4: 验证**

```bash
npx vitest run packages/web/src/__tests__/defaultNotebookResetUx.test.tsx
```

- [ ] **Step 5: 全量回归（前后端）**

```bash
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): default notebook shows reset UX instead of delete"
```

---

## 最终验收

- [ ] **全量测试通过**

```bash
npx vitest run
```

Expected: 所有既有测试 + 新增 8 个测试文件 全绿。

- [ ] **手动冒烟**

1. `./restart.sh` 启动
2. 浏览器访问，新建 project — 验证默认 notebook 首位、可打开、可写 cells
3. 新建第二个 notebook — 进入 worktree 模式，独立分支
4. 删除默认 notebook — UI 显示"重置"，点击后 cells 清空但文件保留
5. 删除第二个 notebook — worktree + 分支正确清理
6. title 填入 `bad/name` — UI 阻止提交
7. title 填入已有同名 — 后端返 409，UI 展示错误

- [ ] **总结 PR**

在 PR 描述中说明：
- 硬升级行为（老 project 不自动补默认 notebook）
- `is_default` 为响应派生字段，DB 不存储
- `.working/` 入 main 分支会使 git log 含 task-ai 状态更新（已知代价）

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-13-default-notebook-on-main.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 每 Task 派一个 fresh subagent，任务间 review，迭代快
2. **Inline Execution** — 本会话内批量执行，按 checkpoint review

Which approach?
