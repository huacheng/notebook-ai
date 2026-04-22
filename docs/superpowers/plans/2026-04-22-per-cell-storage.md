# Per-Cell File Storage (方案 C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 notebook 存储从单体 JSON 拆分为 index 文件 + per-cell 文件，使 auto-save 写入量从全量降至单个 cell（~1000x 减少）。

**Architecture:** 新增 `NotebookIndex` 类型（含 `cell_ids[]`，不含 cells），每个 cell 独立存储在 `.cells/<nb-slug>/<cell-id>.json`。`load()` 检测 version 字段，自动将 v1 迁移到 v2。session 的 autoSave/tryGitCommit 改为只写当前 cell 文件；addCell/removeCell 走严格两步原子写。

**Tech Stack:** TypeScript, Node.js `fs/promises`, Zod, Vitest

---

## 文件映射

| 文件 | 操作 | 职责 |
|---|---|---|
| `packages/shared/src/types.ts` | Modify | 新增 `NotebookIndexSchema`，version 字段收窄 |
| `packages/server/src/notebook-store.ts` | Modify | 新增 per-cell 读写方法，修改 save/load |
| `packages/server/src/__tests__/notebook-store.test.ts` | Modify | per-cell 方法测试、迁移测试 |
| `packages/server/src/session.ts` | Modify | autoSave/tryGitCommit/addCell/removeCell 改写 |
| `packages/server/src/gitignore.template` | Modify | 排除 `.cells/**/*.tmp` |

---

## Task 1：共享类型 — `NotebookIndexSchema` + version 收窄

**Files:**
- Modify: `packages/shared/src/types.ts:218-225`

### 背景

当前 `NotebookSchema.version` 是 `z.number().int().default(1)`，无法区分 v1/v2。`NotebookIndexSchema` 是 v2 磁盘格式，只含 `cell_ids`，不含 `cells`。

- [ ] **Step 1：修改 `packages/shared/src/types.ts`**

在 `NotebookSchema` **之前**（约第 218 行）插入：

```typescript
// ─── Notebook Index (v2 磁盘格式) ───

export const NotebookIndexSchema = z.object({
  version: z.literal(2),
  metadata: NotebookMetadataSchema,
  cell_ids: z.array(z.string()).default([]),
  slide: SlideSchema.default({ generated: false, sections: [] }),
  annotations: z.array(AnnotationSchema).default([]),
  assets: AssetsSchema.default({ intermediate_files: [] }),
});
export type NotebookIndex = z.infer<typeof NotebookIndexSchema>;
```

同时将 `NotebookSchema` 的 `version` 行由：

```typescript
  version: z.number().int().default(1),
```

改为：

```typescript
  version: z.union([z.literal(1), z.literal(2)]).default(1),
```

- [ ] **Step 2：确认类型编译通过**

```bash
cd /home/ubuntu/notebook-ai-v2
npx tsc -p packages/shared/tsconfig.json --noEmit 2>&1 | head -20
```

预期：无错误输出。

- [ ] **Step 3：运行全量测试确认无回归**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run 2>&1 | tail -10
```

预期：所有测试通过。

- [ ] **Step 4：Commit**

```bash
git add packages/shared/src/types.ts
git diff --cached --stat
git commit -m "feat(shared): add NotebookIndexSchema and narrow version to 1|2"
```

---

## Task 2：NotebookStore — 路径工具方法 + saveCell/loadCell/saveIndex

**Files:**
- Modify: `packages/server/src/notebook-store.ts`
- Test: `packages/server/src/__tests__/notebook-store.test.ts`

### 背景

新增三个基础方法：`cellDir` / `cellPath`（静态路径工具）、`saveCell`（原子写单个 cell）、`loadCell`（读 + schema 校验）、`saveIndex`（原子写 index）。

- [ ] **Step 1：写失败测试**

在 `packages/server/src/__tests__/notebook-store.test.ts` 末尾追加：

```typescript
// ── per-cell path helpers ────────────────────────────────────────────────────

describe('cellDir / cellPath', () => {
  it('cellDir returns .cells/<slug> under notebook directory', () => {
    const nbPath = '/workspace/project/my-notebook.notebook.json';
    expect(NotebookStore.cellDir(nbPath)).toBe(
      '/workspace/project/.cells/my-notebook',
    );
  });

  it('cellPath returns .cells/<slug>/<cellId>.json', () => {
    const nbPath = '/workspace/project/my-notebook.notebook.json';
    expect(NotebookStore.cellPath(nbPath, 'abc123')).toBe(
      '/workspace/project/.cells/my-notebook/abc123.json',
    );
  });
});

// ── saveCell / loadCell ──────────────────────────────────────────────────────

describe('saveCell / loadCell', () => {
  it('round-trips a cell through saveCell + loadCell', async () => {
    const nb = store.createNew('CellTest', '/tmp');
    const nbPath = path.join(tmpDir, 'celltest.notebook.json');

    const cell = {
      id: 'c-test-1',
      type: 'markdown' as const,
      source: '# Hello',
      execution_count: 0,
      status: 'idle' as const,
    };
    await store.saveCell(nbPath, cell);
    const loaded = await store.loadCell(nbPath, 'c-test-1');
    expect(loaded.id).toBe('c-test-1');
    expect(loaded.source).toBe('# Hello');
  });

  it('leaves no .tmp file after saveCell', async () => {
    const nbPath = path.join(tmpDir, 'celltest2.notebook.json');

    const cell = {
      id: 'c-test-2',
      type: 'markdown' as const,
      source: 'content',
      execution_count: 0,
      status: 'idle' as const,
    };
    await store.saveCell(nbPath, cell);
    const entries = await readdir(NotebookStore.cellDir(nbPath));
    expect(entries.every((e) => !e.endsWith('.tmp'))).toBe(true);
    expect(entries).toContain('c-test-2.json');
  });

  it('loadCell throws on missing cell file', async () => {
    const nbPath = path.join(tmpDir, 'missing.notebook.json');
    await expect(store.loadCell(nbPath, 'nonexistent')).rejects.toThrow();
  });
});

// ── saveIndex ────────────────────────────────────────────────────────────────

describe('saveIndex', () => {
  it('writes a valid NotebookIndex file', async () => {
    const nbPath = path.join(tmpDir, 'idxtest.notebook.json');
    const nb = store.createNew('IdxTest', '/tmp');
    const index: import('@notebook-ai/shared').NotebookIndex = {
      version: 2,
      metadata: nb.metadata,
      cell_ids: ['c-1', 'c-2'],
      slide: nb.slide,
      annotations: [],
      assets: nb.assets,
    };
    await store.saveIndex(nbPath, index);
    const raw = await readFile(nbPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(2);
    expect(parsed.cell_ids).toEqual(['c-1', 'c-2']);
    const savedEntries = await readdir(tmpDir);
    expect(savedEntries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run packages/server/src/__tests__/notebook-store.test.ts 2>&1 | tail -20
```

预期：新增测试失败（`NotebookStore.cellDir is not a function` 等）。

- [ ] **Step 3：实现路径工具方法和 saveCell/loadCell/saveIndex**

在 `packages/server/src/notebook-store.ts` 顶部 import 中补充：

```typescript
import { readFile, writeFile, rename, unlink, readdir, mkdir } from 'fs/promises';
```

在 `packages/shared` import 中补充 `NotebookIndexSchema, NotebookIndex, CellSchema, type Cell`：

```typescript
import {
  NotebookSchema,
  NotebookIndexSchema,
  CellSchema,
  type Notebook,
  type NotebookIndex,
  type Cell,
} from '@notebook-ai/shared';
```

在 `NotebookStore` 类中，在 `save()` 方法之前插入：

```typescript
  // ── Path helpers ─────────────────────────────────────────────────────────

  static cellDir(notebookPath: string): string {
    return path.join(
      path.dirname(notebookPath),
      '.cells',
      path.basename(notebookPath, '.notebook.json'),
    );
  }

  static cellPath(notebookPath: string, cellId: string): string {
    return path.join(NotebookStore.cellDir(notebookPath), `${cellId}.json`);
  }

  // ── Per-cell atomic write ─────────────────────────────────────────────────

  async saveCell(notebookPath: string, cell: Cell): Promise<void> {
    const validated = CellSchema.parse(cell);
    const filePath = NotebookStore.cellPath(notebookPath, cell.id);
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(validated, null, 2) + '\n', 'utf8');
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new Error(`Failed to write cell tmp "${tmpPath}": ${String(err)}`);
    }
    try {
      await rename(tmpPath, filePath);
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new Error(`Failed to rename cell tmp to "${filePath}": ${String(err)}`);
    }
  }

  async loadCell(notebookPath: string, cellId: string): Promise<Cell> {
    const filePath = NotebookStore.cellPath(notebookPath, cellId);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read cell "${cellId}" from "${filePath}": ${String(err)}`);
    }
    const result = CellSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      throw new Error(`Cell "${cellId}" failed schema validation: ${result.error.message}`);
    }
    return result.data;
  }

  async saveIndex(notebookPath: string, index: NotebookIndex): Promise<void> {
    const validated = NotebookIndexSchema.parse(index);
    const tmpPath = `${notebookPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(validated, null, 2) + '\n', 'utf8');
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new Error(`Failed to write index tmp "${tmpPath}": ${String(err)}`);
    }
    try {
      await rename(tmpPath, notebookPath);
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new Error(`Failed to rename index tmp to "${notebookPath}": ${String(err)}`);
    }
  }
```

- [ ] **Step 4：运行测试确认通过**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run packages/server/src/__tests__/notebook-store.test.ts 2>&1 | tail -20
```

预期：所有测试通过。

- [ ] **Step 5：Commit**

```bash
git add packages/server/src/notebook-store.ts packages/server/src/__tests__/notebook-store.test.ts
git diff --cached --stat
git commit -m "feat(server): add cellDir/cellPath/saveCell/loadCell/saveIndex to NotebookStore"
```

---

## Task 3：NotebookStore — addCell / removeCell

**Files:**
- Modify: `packages/server/src/notebook-store.ts`
- Test: `packages/server/src/__tests__/notebook-store.test.ts`

### 背景

`addCell` 严格两步：① 写 cell 文件 → ② 更新 index；② 失败时回滚删除 cell 文件。`removeCell` 严格两步：① 更新 index（移除 id）→ ② unlink cell 文件（best-effort）。

- [ ] **Step 1：写失败测试**

在 `packages/server/src/__tests__/notebook-store.test.ts` 末尾追加：

```typescript
// ── addCell ──────────────────────────────────────────────────────────────────

describe('addCell', () => {
  const makeCell = (id: string) => ({
    id,
    type: 'markdown' as const,
    source: `# ${id}`,
    execution_count: 0,
    status: 'idle' as const,
  });

  const makeIndex = (nb: import('@notebook-ai/shared').Notebook): import('@notebook-ai/shared').NotebookIndex => ({
    version: 2 as const,
    metadata: nb.metadata,
    cell_ids: [],
    slide: nb.slide,
    annotations: [],
    assets: nb.assets,
  });

  it('adds cell file and updates index', async () => {
    const nbPath = path.join(tmpDir, 'addcell.notebook.json');
    const nb = store.createNew('AddCell', '/tmp');

    const index = makeIndex(nb);
    const cell = makeCell('c-new');
    const newIndex = await store.addCell(nbPath, index, cell);

    expect(newIndex.cell_ids).toContain('c-new');
    // cell file exists
    const cellData = await store.loadCell(nbPath, 'c-new');
    expect(cellData.id).toBe('c-new');
    // index file written
    const raw = await readFile(nbPath, 'utf8');
    expect(JSON.parse(raw).cell_ids).toContain('c-new');
  });

  it('rolls back cell file if index write fails', async () => {
    const nbPath = path.join(tmpDir, 'rollback.notebook.json');
    const nb = store.createNew('Rollback', '/tmp');

    // Make index write fail by making nbPath a directory
    const { mkdir } = await import('fs/promises');
    await mkdir(nbPath, { recursive: true });

    const index = makeIndex(nb);
    const cell = makeCell('c-rollback');
    await expect(store.addCell(nbPath, index, cell)).rejects.toThrow();

    // cell file should be deleted (rollback)
    await expect(store.loadCell(nbPath, 'c-rollback')).rejects.toThrow();
  });
});

// ── removeCell ───────────────────────────────────────────────────────────────

describe('removeCell', () => {
  const makeCell = (id: string) => ({
    id,
    type: 'markdown' as const,
    source: `# ${id}`,
    execution_count: 0,
    status: 'idle' as const,
  });

  it('removes cell from index and deletes cell file', async () => {
    const nbPath = path.join(tmpDir, 'removecell.notebook.json');
    const nb = store.createNew('RemoveCell', '/tmp');

    // Setup: add a cell first
    const index0: import('@notebook-ai/shared').NotebookIndex = {
      version: 2,
      metadata: nb.metadata,
      cell_ids: [],
      slide: nb.slide,
      annotations: [],
      assets: nb.assets,
    };
    const cell = makeCell('c-del');
    const index1 = await store.addCell(nbPath, index0, cell);
    expect(index1.cell_ids).toContain('c-del');

    // Now remove
    const index2 = await store.removeCell(nbPath, index1, 'c-del');
    expect(index2.cell_ids).not.toContain('c-del');

    // Cell file gone (best-effort, should be deleted)
    await expect(store.loadCell(nbPath, 'c-del')).rejects.toThrow();
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run packages/server/src/__tests__/notebook-store.test.ts 2>&1 | tail -20
```

预期：`addCell` / `removeCell` 相关测试失败（方法不存在）。

- [ ] **Step 3：实现 addCell 和 removeCell**

在 `packages/server/src/notebook-store.ts` 的 `saveIndex()` 之后插入：

```typescript
  async addCell(
    notebookPath: string,
    index: NotebookIndex,
    cell: Cell,
  ): Promise<NotebookIndex> {
    // Step ①: write cell file (atomic)
    await this.saveCell(notebookPath, cell);

    // Step ②: update index
    const newIndex: NotebookIndex = {
      ...index,
      cell_ids: [...index.cell_ids, cell.id],
    };
    try {
      await this.saveIndex(notebookPath, newIndex);
    } catch (err) {
      // Rollback: delete cell file
      try { await unlink(NotebookStore.cellPath(notebookPath, cell.id)); } catch { /* ignore */ }
      throw err;
    }
    return newIndex;
  }

  async removeCell(
    notebookPath: string,
    index: NotebookIndex,
    cellId: string,
  ): Promise<NotebookIndex> {
    // Step ①: update index (remove id) — if this fails, cell file is preserved
    const newIndex: NotebookIndex = {
      ...index,
      cell_ids: index.cell_ids.filter((id) => id !== cellId),
    };
    await this.saveIndex(notebookPath, newIndex);

    // Step ②: unlink cell file (best-effort)
    try {
      await unlink(NotebookStore.cellPath(notebookPath, cellId));
    } catch {
      // Orphaned file; harmless (not referenced by index)
    }
    return newIndex;
  }
```

- [ ] **Step 4：运行测试确认通过**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run packages/server/src/__tests__/notebook-store.test.ts 2>&1 | tail -20
```

预期：所有测试通过。

- [ ] **Step 5：Commit**

```bash
git add packages/server/src/notebook-store.ts packages/server/src/__tests__/notebook-store.test.ts
git diff --cached --stat
git commit -m "feat(server): add addCell/removeCell with strict two-step atomicity"
```

---

## Task 4：NotebookStore — 修改 save() 和 load()（含 v1→v2 迁移）

**Files:**
- Modify: `packages/server/src/notebook-store.ts`
- Test: `packages/server/src/__tests__/notebook-store.test.ts`

### 背景

`save()` 改为：mkdir cellDir → 并行写所有 cell 文件 → 写 index。`load()` 检测 version：v1 → 先迁移再读；v2 → 读 index + 并行读所有 cell 文件，缺失 cell 记录 warning 并从 index 移除，并清理孤立文件。

- [ ] **Step 1：写失败测试**

在 `packages/server/src/__tests__/notebook-store.test.ts` 末尾追加：

```typescript
// ── save() v2 全量写 ──────────────────────────────────────────────────────────

describe('save() v2 full write', () => {
  it('creates cell files and index when saving notebook with cells', async () => {
    const nb = store.createNew('SaveV2', '/tmp');
    // Add two cells manually
    const cells = [
      { id: 'c-1', type: 'markdown' as const, source: '# Cell 1', execution_count: 0, status: 'idle' as const },
      { id: 'c-2', type: 'markdown' as const, source: '# Cell 2', execution_count: 0, status: 'idle' as const },
    ];
    const nbWithCells = { ...nb, cells };
    const nbPath = path.join(tmpDir, 'savev2.notebook.json');

    await store.save(nbPath, nbWithCells);

    // Index file should be version 2 with cell_ids
    const raw = await readFile(nbPath, 'utf8');
    const index = JSON.parse(raw);
    expect(index.version).toBe(2);
    expect(index.cell_ids).toEqual(['c-1', 'c-2']);
    expect(index.cells).toBeUndefined();

    // Cell files should exist
    const c1 = await store.loadCell(nbPath, 'c-1');
    expect(c1.source).toBe('# Cell 1');
    const c2 = await store.loadCell(nbPath, 'c-2');
    expect(c2.source).toBe('# Cell 2');
  });

  it('save is idempotent: re-saving overwrites cell files without error', async () => {
    const nb = store.createNew('Idempotent', '/tmp');
    const cells = [
      { id: 'c-idem', type: 'markdown' as const, source: 'v1', execution_count: 0, status: 'idle' as const },
    ];
    const nbPath = path.join(tmpDir, 'idempotent.notebook.json');
    await store.save(nbPath, { ...nb, cells });

    const cells2 = [
      { id: 'c-idem', type: 'markdown' as const, source: 'v2', execution_count: 0, status: 'idle' as const },
    ];
    await store.save(nbPath, { ...nb, cells: cells2 });

    const loaded = await store.loadCell(nbPath, 'c-idem');
    expect(loaded.source).toBe('v2');
  });
});

// ── load() v1 auto-migration ──────────────────────────────────────────────────

describe('load() v1 auto-migration', () => {
  it('migrates v1 notebook to v2 on load', async () => {
    const v1Notebook = {
      version: 1,
      metadata: { title: 'V1 Notebook', created: '2024-01-01T00:00:00Z', git_repo: false },
      cells: [
        { id: 'c-v1-1', type: 'markdown', source: '# Migrated', execution_count: 0, status: 'idle' },
        { id: 'c-v1-2', type: 'markdown', source: '## Second', execution_count: 0, status: 'idle' },
      ],
      slide: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    };
    const nbPath = path.join(tmpDir, 'v1migrate.notebook.json');
    await writeFile(nbPath, JSON.stringify(v1Notebook), 'utf8');

    const loaded = await store.load(nbPath);

    // In-memory result has full cells
    expect(loaded.cells).toHaveLength(2);
    expect(loaded.cells[0].id).toBe('c-v1-1');
    expect(loaded.cells[1].id).toBe('c-v1-2');

    // On-disk: index is now v2
    const raw = await readFile(nbPath, 'utf8');
    const index = JSON.parse(raw);
    expect(index.version).toBe(2);
    expect(index.cell_ids).toEqual(['c-v1-1', 'c-v1-2']);

    // Cell files exist
    const c1 = await store.loadCell(nbPath, 'c-v1-1');
    expect(c1.source).toBe('# Migrated');
  });
});

// ── load() v2 normal ──────────────────────────────────────────────────────────

describe('load() v2', () => {
  it('loads v2 notebook preserving cell order', async () => {
    const nb = store.createNew('LoadV2', '/tmp');
    const cells = [
      { id: 'c-a', type: 'markdown' as const, source: 'A', execution_count: 0, status: 'idle' as const },
      { id: 'c-b', type: 'markdown' as const, source: 'B', execution_count: 0, status: 'idle' as const },
      { id: 'c-c', type: 'markdown' as const, source: 'C', execution_count: 0, status: 'idle' as const },
    ];
    const nbPath = path.join(tmpDir, 'loadv2.notebook.json');
    await store.save(nbPath, { ...nb, cells });

    const loaded = await store.load(nbPath);
    expect(loaded.cells.map((c) => c.id)).toEqual(['c-a', 'c-b', 'c-c']);
    expect(loaded.cells[1].source).toBe('B');
  });

  it('skips missing cell files and updates index (no throw)', async () => {
    const nb = store.createNew('MissingCell', '/tmp');
    const cells = [
      { id: 'c-present', type: 'markdown' as const, source: 'here', execution_count: 0, status: 'idle' as const },
    ];
    const nbPath = path.join(tmpDir, 'missingcell.notebook.json');
    await store.save(nbPath, { ...nb, cells });

    // Manually inject a missing cell id into the index
    const raw = JSON.parse(await readFile(nbPath, 'utf8'));
    raw.cell_ids = ['c-present', 'c-ghost'];
    await writeFile(nbPath, JSON.stringify(raw), 'utf8');

    const loaded = await store.load(nbPath);
    // c-ghost silently dropped
    expect(loaded.cells.map((c) => c.id)).toEqual(['c-present']);

    // Index on disk updated (c-ghost removed)
    const updated = JSON.parse(await readFile(nbPath, 'utf8'));
    expect(updated.cell_ids).toEqual(['c-present']);
  });

  it('deletes orphaned cell files on load', async () => {
    const nb = store.createNew('Orphan', '/tmp');
    const cells = [
      { id: 'c-kept', type: 'markdown' as const, source: 'keep', execution_count: 0, status: 'idle' as const },
    ];
    const nbPath = path.join(tmpDir, 'orphan.notebook.json');
    await store.save(nbPath, { ...nb, cells });

    // Create an orphan cell file not referenced in index
    const orphanPath = NotebookStore.cellPath(nbPath, 'c-orphan');
    await writeFile(orphanPath, JSON.stringify({ id: 'c-orphan', type: 'markdown', source: 'orphan', execution_count: 0, status: 'idle' }), 'utf8');

    await store.load(nbPath);

    // Orphan file deleted
    await expect(readFile(orphanPath, 'utf8')).rejects.toThrow();
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run packages/server/src/__tests__/notebook-store.test.ts 2>&1 | tail -30
```

预期：v2 save/load 测试失败（当前 save 写全量 JSON，load 不做 v2 解析）。

- [ ] **Step 3：重写 save() 方法**

将 `packages/server/src/notebook-store.ts` 中的 `save()` 方法整体替换为：

```typescript
  async save(filePath: string, notebook: Notebook): Promise<void> {
    const validated = NotebookSchema.parse({
      ...notebook,
      metadata: {
        ...notebook.metadata,
        updated: new Date().toISOString(),
      },
    });

    const cellDir = NotebookStore.cellDir(filePath);
    await mkdir(cellDir, { recursive: true });

    // Write all cell files in parallel
    await Promise.all(validated.cells.map((cell) => this.saveCell(filePath, cell)));

    // Write index (no cells array)
    const index: NotebookIndex = {
      version: 2,
      metadata: validated.metadata,
      cell_ids: validated.cells.map((c) => c.id),
      slide: validated.slide,
      annotations: validated.annotations,
      assets: validated.assets,
    };
    await this.saveIndex(filePath, index);
  }
```

- [ ] **Step 4：重写 load() 方法**

将 `packages/server/src/notebook-store.ts` 中的 `load()` 方法整体替换为：

```typescript
  async load(filePath: string): Promise<Notebook> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read notebook from "${filePath}": ${String(err)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse notebook JSON at "${filePath}": ${String(err)}`);
    }

    // Detect version and branch
    const version = (parsed as Record<string, unknown>)?.version;

    if (version === 1) {
      return this.migrateV1ToV2(filePath, parsed);
    }

    if (version === 2) {
      return this.loadV2(filePath, parsed);
    }

    // Fallback: try v1 parse for unversioned or unknown version
    const result = NotebookSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Notebook at "${filePath}" failed schema validation: ${result.error.message}`,
      );
    }
    return result.data;
  }

  private async migrateV1ToV2(filePath: string, raw: unknown): Promise<Notebook> {
    const result = NotebookSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `v1 notebook at "${filePath}" failed schema validation: ${result.error.message}`,
      );
    }
    const v1 = result.data;

    // Step 1: mkdir .cells/<slug>/
    const cellDir = NotebookStore.cellDir(filePath);
    await mkdir(cellDir, { recursive: true });

    // Step 2: write all cell files in parallel (atomic, idempotent)
    await Promise.all(v1.cells.map((cell) => this.saveCell(filePath, cell)));

    // Step 3: write v2 index (atomic)
    const index: NotebookIndex = {
      version: 2,
      metadata: v1.metadata,
      cell_ids: v1.cells.map((c) => c.id),
      slide: v1.slide,
      annotations: v1.annotations,
      assets: v1.assets,
    };
    await this.saveIndex(filePath, index);

    return v1;
  }

  private async loadV2(filePath: string, raw: unknown): Promise<Notebook> {
    const indexResult = NotebookIndexSchema.safeParse(raw);
    if (!indexResult.success) {
      throw new Error(
        `v2 index at "${filePath}" failed schema validation: ${indexResult.error.message}`,
      );
    }
    const index = indexResult.data;

    // Read all cell files in parallel; handle missing cells gracefully
    const cellResults = await Promise.all(
      index.cell_ids.map(async (cellId) => {
        try {
          return await this.loadCell(filePath, cellId);
        } catch {
          console.warn(`[NotebookStore] Missing cell file for "${cellId}" in "${filePath}"; skipping.`);
          return null;
        }
      }),
    );

    const cells = cellResults.filter((c): c is NonNullable<typeof c> => c !== null);
    const presentIds = new Set(cells.map((c) => c.id));

    // If any cells were missing, update index on disk
    if (cells.length < index.cell_ids.length) {
      const updatedIndex: NotebookIndex = { ...index, cell_ids: cells.map((c) => c.id) };
      await this.saveIndex(filePath, updatedIndex).catch((err) => {
        console.warn(`[NotebookStore] Failed to update index after dropping missing cells: ${err}`);
      });
    }

    // Clean up orphaned cell files (not referenced by index)
    const cellDir = NotebookStore.cellDir(filePath);
    try {
      const entries = await readdir(cellDir);
      await Promise.all(
        entries
          .filter((e) => e.endsWith('.json') && !presentIds.has(path.basename(e, '.json')))
          .map(async (e) => {
            const orphanPath = path.join(cellDir, e);
            console.warn(`[NotebookStore] Deleting orphaned cell file: ${orphanPath}`);
            await unlink(orphanPath).catch(() => {});
          }),
      );
    } catch {
      // cellDir may not exist (edge case); not an error
    }

    return NotebookSchema.parse({
      version: 2,
      metadata: index.metadata,
      cells,
      slide: index.slide,
      annotations: index.annotations,
      assets: index.assets,
    });
  }
```

- [ ] **Step 5：运行测试确认通过**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run packages/server/src/__tests__/notebook-store.test.ts 2>&1 | tail -20
```

预期：所有测试通过。

- [ ] **Step 6：运行全量测试**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run 2>&1 | tail -10
```

预期：所有测试通过，无新增失败。

- [ ] **Step 7：Commit**

```bash
git add packages/server/src/notebook-store.ts packages/server/src/__tests__/notebook-store.test.ts
git diff --cached --stat
git commit -m "feat(server): rewrite save/load for v2 per-cell storage with v1 auto-migration"
```

---

## Task 5：session.ts — autoSave / tryGitCommit 改为 per-cell 写

**Files:**
- Modify: `packages/server/src/session.ts`

### 背景

`autoSave()` 目前用 `writeFile` 全量写整个 notebook；`tryGitCommit()` 也全量写一次再 git commit。改为只写正在执行的 cell 文件，大幅降低写放大。

`toIndex()` 辅助函数从 `session.notebook` 派生 `NotebookIndex`，避免维护独立缓存。

- [ ] **Step 1：写测试（session auto-save 只写 cell 文件）**

在 `packages/server/src/__tests__/` 目录下查看是否有 session 测试：

```bash
ls /home/ubuntu/notebook-ai-v2/packages/server/src/__tests__/
```

如有 `session.test.ts`，在其中追加；否则跳过测试（session 测试需要完整进程环境，改为手动验证）。

- [ ] **Step 2：在 session.ts 顶部 import 中添加 NotebookStore 和 NotebookIndex**

检查当前 session.ts 是否已 import `NotebookStore`：

```bash
grep -n "NotebookStore\|notebook-store" /home/ubuntu/notebook-ai-v2/packages/server/src/session.ts | head -5
```

在 session.ts 的 imports 区域（与其他 import 相邻）确保有：

```typescript
import { NotebookStore } from './notebook-store.js';
import type { NotebookIndex } from '@notebook-ai/shared';
```

如果 `NotebookIndex` 已在 shared imports 中，则只补充 `NotebookStore`。

- [ ] **Step 3：添加 `toIndex` 辅助函数**

在 session.ts 中，在 `// ── Heartbeat Constants` 注释区域**之前**添加辅助函数：

```typescript
function toIndex(notebook: Notebook): NotebookIndex {
  return {
    version: 2 as const,
    metadata: notebook.metadata,
    cell_ids: notebook.cells.map((c) => c.id),
    slide: notebook.slide,
    annotations: notebook.annotations,
    assets: notebook.assets,
  };
}
```

- [ ] **Step 4：修改 `autoSave()` 写当前 cell 文件 + index**

将 `packages/server/src/session.ts` 的 `autoSave()` 方法（约第 1227 行）改为：

```typescript
  private async autoSave(session: NotebookSession): Promise<void> {
    try {
      // Write the running cell file (or last cell) — avoids full notebook write
      const runningCell = session.notebook.cells.find((c) => c.status === 'running')
        ?? session.notebook.cells[session.notebook.cells.length - 1];

      if (runningCell) {
        await this.store.saveCell(session.notebookPath, runningCell);
      }

      // Always sync index (<5KB) to persist metadata changes (model, git_repo, etc.)
      await this.store.saveIndex(session.notebookPath, toIndex(session.notebook));

      if (session.notebookDbId) {
        this.onAutoSave?.(session.notebookDbId, session.notebook.cells.length);
      }
    } catch (err) {
      console.error(`[session ${session.id}] autoSave error:`, err);
      // D3: notify client of autosave failure
      session.broadcast({ type: 'autosave_error', session_id: session.id, error: String(err) });
    }
  }
```

- [ ] **Step 5：修改 `tryGitCommit()` 只写当前 cell**

将 `packages/server/src/session.ts` 的 `tryGitCommit()` 方法（约第 1245 行）中的全量写行：

```typescript
      await writeFile(session.notebookPath, JSON.stringify(session.notebook, null, 2), 'utf-8');
```

改为：

```typescript
      const cell = session.notebook.cells.find((c) => c.id === cellId);
      if (cell) {
        await this.store.saveCell(session.notebookPath, cell);
      }
```

同时确认方法签名行上方的注释仍准确（`tryGitCommit` 在 git commit 前持久化 cell 到磁盘）。

- [ ] **Step 6：检查 `store` 属性是否在 session 中存在**

```bash
grep -n "this\.store\|new NotebookStore\|store:" /home/ubuntu/notebook-ai-v2/packages/server/src/session.ts | head -10
```

如果 session 没有 `this.store`，需要在 `SessionManager` class 中添加：

在 `SessionManager` class 顶部属性区域添加：

```typescript
  private store = new NotebookStore();
```

- [ ] **Step 7：移除已不再需要的 `writeFile` 导入（如果 session.ts 不再使用它）**

```bash
grep -n "writeFile" /home/ubuntu/notebook-ai-v2/packages/server/src/session.ts
```

如果 `writeFile` 只出现在 autoSave 和 tryGitCommit 中（已改写），则从 import 移除：

```typescript
// 改前
import { readFile, writeFile, appendFile } from 'fs/promises';
// 改后（如果 writeFile 不再使用）
import { readFile, appendFile } from 'fs/promises';
```

- [ ] **Step 8：运行全量测试**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run 2>&1 | tail -10
```

预期：所有测试通过，无新增失败。

- [ ] **Step 9：Commit**

```bash
git add packages/server/src/session.ts
git diff --cached --stat
git commit -m "perf(server): autoSave and tryGitCommit write only the active cell file"
```

---

## Task 6：session.ts — addCell / removeCell 走 per-cell 路径

**Files:**
- Modify: `packages/server/src/session.ts`

### 背景

新增 cell 时调用 `store.addCell()`（严格两步），删除 cell 时调用 `store.removeCell()`。当前新增 cell 完全依赖下次 autoSave 带上，删除 cell 调用全量 `store.save()`。

- [ ] **Step 1：找到 session.ts 中 remove_cells 和新增 cell 的处理位置**

```bash
grep -n "remove_cells\|addCell\|removeCell\|cells\.push\|session\.notebook\.cells" /home/ubuntu/notebook-ai-v2/packages/server/src/session.ts | head -20
```

记录关键行号。

- [ ] **Step 2：找到新增 cell 的代码路径**

```bash
grep -n "execute_request\|createCell\|cell_id.*push\|cells.*push" /home/ubuntu/notebook-ai-v2/packages/server/src/session.ts | head -20
```

找到新 cell 被添加到 `session.notebook.cells` 的位置（通常在 `executeCell` 或处理 `execute_request` 的代码块中）。

- [ ] **Step 3：修改新增 cell 后立即持久化**

在新 cell 添加到 `session.notebook.cells` 的代码**之后**，使用 `store.addCell()` 严格两步持久化（含回滚）：

由于 session 内部先 push newCell 进 `session.notebook.cells`，传入 `addCell` 时需传不含新 cell 的 index：

```typescript
// 在 cells 数组 push 新 cell 之后，立即走严格两步持久化（含回滚）
const indexBeforeAdd = toIndex({
  ...session.notebook,
  cells: session.notebook.cells.slice(0, -1), // exclude the just-pushed newCell
});
try {
  await this.store.addCell(session.notebookPath, indexBeforeAdd, newCell);
} catch (err) {
  // Persistence failed: roll back in-memory state to stay consistent
  session.notebook = {
    ...session.notebook,
    cells: session.notebook.cells.filter((c) => c.id !== newCell.id),
  };
  console.error(`[session ${session.id}] Failed to persist new cell, rolled back:`, err);
}
```

- [ ] **Step 4：找到 remove_cells 处理代码**

```bash
grep -n "remove_cells\|RemoveCells\|cells\.filter\|cell_ids.*delete" /home/ubuntu/notebook-ai-v2/packages/server/src/session.ts | head -10
```

- [ ] **Step 5：修改 remove_cells 处理为 per-cell 删除**

找到 `remove_cells` 处理代码中调用 `store.save()` 全量写的位置，改为：

```typescript
// 逐个调用 removeCell（严格两步：先更新 index，再删文件）
let currentIndex = toIndex(session.notebook);
for (const cellId of cellIds) {
  currentIndex = await this.store.removeCell(session.notebookPath, currentIndex, cellId).catch((err) => {
    console.error(`[session ${session.id}] removeCell failed for ${cellId}:`, err);
    return currentIndex;
  });
}
```

- [ ] **Step 6：运行全量测试**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run 2>&1 | tail -10
```

预期：所有测试通过。

- [ ] **Step 7：Commit**

```bash
git add packages/server/src/session.ts
git diff --cached --stat
git commit -m "perf(server): addCell/removeCell use per-cell store methods instead of full save"
```

---

## Task 7：更新 gitignore.template

**Files:**
- Modify: `packages/server/gitignore.template`

- [ ] **Step 1：在 `gitignore.template` 末尾追加**

在 `packages/server/gitignore.template` 末尾添加：

```
# atomic write tmp files for cell storage
.cells/**/*.tmp
```

- [ ] **Step 2：验证格式**

```bash
cat /home/ubuntu/notebook-ai-v2/packages/server/gitignore.template
```

预期：末尾有两行新增内容，无多余空行。

- [ ] **Step 3：Commit**

```bash
git add packages/server/gitignore.template
git diff --cached --stat
git commit -m "chore: exclude .cells/**/*.tmp from git via gitignore.template"
```

---

## Task 8：全量测试 + list() 兼容性验证

**Files:**
- Test: `packages/server/src/__tests__/notebook-store.test.ts`

### 背景

`list()` 方法调用 `this.load()`，load 现在走 v2 路径。需要验证 list 对 v2 notebooks 仍然正常工作（只读 metadata.title）。

- [ ] **Step 1：补充 list() 与 v2 兼容性测试**

在 `packages/server/src/__tests__/notebook-store.test.ts` 末尾追加：

```typescript
// ── list() v2 compatibility ───────────────────────────────────────────────────

describe('list() with v2 notebooks', () => {
  it('lists v2 notebooks correctly', async () => {
    const nb1 = store.createNew('Alpha', '/tmp');
    const nb2 = store.createNew('Beta', '/tmp');
    await store.save(path.join(tmpDir, 'alpha.notebook.json'), nb1);
    await store.save(path.join(tmpDir, 'beta.notebook.json'), nb2);

    const result = await store.list(tmpDir);
    const titles = result.map((r) => r.title);
    expect(titles).toContain('Alpha');
    expect(titles).toContain('Beta');
  });
});
```

- [ ] **Step 2：运行全量测试**

```bash
cd /home/ubuntu/notebook-ai-v2
npx vitest run 2>&1 | tail -10
```

预期：所有测试通过，报告总 pass 数（参考当前约 150+ server tests + web tests）。

- [ ] **Step 3：Commit**

```bash
git add packages/server/src/__tests__/notebook-store.test.ts
git diff --cached --stat
git commit -m "test(server): add list() v2 compatibility test"
```

---

## 自检（Self-Review）

**Spec coverage：**

| Spec 要求 | 实现任务 |
|---|---|
| `NotebookIndexSchema` + version 收窄 | Task 1 |
| `cellDir` / `cellPath` 静态方法 | Task 2 |
| `saveCell` / `loadCell` / `saveIndex` 原子写 | Task 2 |
| `addCell` 严格两步 + 回滚 | Task 3 |
| `removeCell` 严格两步 + best-effort unlink | Task 3 |
| `save()` v2 全量写（mkdir + 并行 cell 写 + index 写） | Task 4 |
| `load()` 版本检测 + v1 自动迁移 | Task 4 |
| 缺失 cell 文件跳过 + 更新 index | Task 4 |
| 孤立 cell 文件清理 | Task 4 |
| autoSave 写当前 cell 文件 + index（保证 metadata 持久化） | Task 5 |
| tryGitCommit 只写当前 cell | Task 5 |
| addCell 立即持久化 | Task 6 |
| removeCell 走 per-cell 删除 | Task 6 |
| `.cells/**/*.tmp` 加入 gitignore.template | Task 7 |
| `list()` v2 兼容性 | Task 8 |

**Placeholder scan：** 无 TBD / TODO。

**Type consistency：**
- `NotebookIndex` 在 Task 1 定义，Task 2-6 全部使用同一类型。
- `toIndex()` 在 Task 5 定义，Task 6 复用同一函数。
- `CellSchema.parse()` 用于 saveCell 校验，与 shared types 一致。
