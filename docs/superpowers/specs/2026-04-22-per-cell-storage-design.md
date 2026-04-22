# Per-Cell File Storage (方案 C) Design Spec

## Goal

将 notebook 存储从单体 JSON 文件拆分为 **index 文件 + per-cell 文件**，使 auto-save 写入量从全量（N cells × 平均输出大小）降低到单个 cell，解决 cell 数量增长时读写性能退化问题。

## Background

当前痛点：
- `autoSave()` 和 `tryGitCommit()` 每次写整个 notebook.json（1000 cells ≈ 25MB）
- auto-save debounce 1s，流式执行期间每秒全量覆盖
- cell 完成时额外写 2 次全量（tryGitCommit + autoSave）
- 随 cell 增长，写放大线性恶化

目标写入量：auto-save 只写当前 cell 文件（≈25KB），降低 ~1000x。

---

## 文件布局

```
project/
  nb-xxxx.notebook.json          ← v2 index（永远 <5KB）
  .cells/
    nb-xxxx/
      c-abc123.json              ← 单个 cell 全量数据
      c-def456.json
      ...
```

**路径命名规则：**
- `nb-slug` = `path.basename(notebookPath, '.notebook.json')`
- `cellDir` = `path.join(path.dirname(notebookPath), '.cells', nb-slug)`
- `cellPath(cellId)` = `path.join(cellDir, cellId + '.json')`

**`.cells/` 目录：**
- 默认隐藏（dot 前缀），git 追踪
- `gitignore.template` 补充 `.cells/**/*.tmp`（排除原子写临时文件）

---

## 类型变更

**文件：** `packages/shared/src/types.ts`

### 新增 `NotebookIndexSchema`

v2 磁盘格式（只含 index，无 cells 数组）：

```typescript
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

### `NotebookSchema` 收窄 version 字段

```typescript
// 修改前
version: z.number().int().default(1)

// 修改后
version: z.union([z.literal(1), z.literal(2)]).default(1)
```

### 内存类型 `Notebook` 不变

上层代码（session、ws-handler、前端）拿到的 `Notebook`（含 `cells: Cell[]`）与现在完全一样，无需改动。

---

## NotebookStore API

**文件：** `packages/server/src/notebook-store.ts`

### 新增静态工具方法

```typescript
static cellDir(notebookPath: string): string
// → path.join(dirname(notebookPath), '.cells', basename(notebookPath, '.notebook.json'))

static cellPath(notebookPath: string, cellId: string): string
// → path.join(cellDir(notebookPath), cellId + '.json')
```

### 新增实例方法

```typescript
// 原子写单个 cell 文件（write tmp → rename）
async saveCell(notebookPath: string, cell: Cell): Promise<void>

// 读单个 cell 文件，schema 校验
async loadCell(notebookPath: string, cellId: string): Promise<Cell>

// 原子写 index 文件（write tmp → rename）
async saveIndex(notebookPath: string, index: NotebookIndex): Promise<void>

// 严格两步新增：① write cell file → ② update index
// ② 失败时回滚删除 cell 文件，抛错
async addCell(notebookPath: string, index: NotebookIndex, cell: Cell): Promise<NotebookIndex>

// 严格两步删除：① update index → ② unlink cell file（best-effort）
// ① 失败直接抛错，cell 文件保留（数据安全）
async removeCell(notebookPath: string, index: NotebookIndex, cellId: string): Promise<NotebookIndex>

// v1 → v2 迁移（由 load() 内部调用）
private async migrateV1ToV2(notebookPath: string, v1: Notebook): Promise<void>
```

### 修改现有方法

**`save(notebookPath, notebook)`**
- 原：JSON.stringify 全量写一个文件
- 新：`mkdir -p cellDir` → 并行写所有 cell 文件（`saveCell`）→ 写 index（`saveIndex`）
- 幂等：cellDir 已存在不报错，已有 cell 文件直接覆盖
- 用于：初始创建、显式 save_notebook、全量同步场景

**`load(notebookPath)`**
- 原：读单个 JSON 文件
- 新：
  1. 读文件，检测 `version`
  2. `version === 1` → 调用 `migrateV1ToV2`，再走步骤 3
  3. `version === 2` → 读 index + 并行读 `cell_ids` 对应的所有 cell 文件 → 拼成 `Notebook` 返回
- **缺失 cell 文件处理**：若某 `cell_id` 对应的 cell 文件不存在，记录 warning 日志，跳过该 cell 并将其从 index 的 `cell_ids` 中移除（写回 index）。不抛错，让 notebook 仍可正常打开。
- 对外签名不变：`async load(filePath: string): Promise<Notebook>`

> **注意 — 读性能**：v2 的 `load()` 执行 1+N 次文件读（1 次 index + N 次 cell 文件），而 v1 只需 1 次顺序读。性能收益集中在**写路径**（auto-save 从全量降到单 cell）；读路径在 cell 数量较多时可配合前端已有的 lazy loading 优化，暂不在本次范围内。

**`list(directory)`** 不变（只读 metadata.title，现在更快了）。

---

## 迁移：v1 → v2

**触发：** `load()` 检测到 `version === 1`，自动执行，调用方无感知。

**步骤：**

```
1. mkdir -p .cells/nb-slug/
2. 并行写所有 cell 文件（原子写）
3. 原子写新 index（version: 2, cell_ids: [...], 无 cells 字段）
4. 返回完整 Notebook
```

**失败处理：** 步骤 2/3 任一失败 → 抛错，不修改原始 notebook.json（仍为 v1，下次 load 重试迁移）。重试时直接覆盖已存在的 cell 文件（幂等，无数据风险）。

---

## Session 写入路径变更

**文件：** `packages/server/src/session.ts`

| 场景 | 现在 | 方案 C |
|---|---|---|
| 流式 auto-save（1s debounce） | `writeFile`（全量） | `store.saveCell(path, activeCell)` |
| cell 完成前写盘（tryGitCommit） | `writeFile`（全量） | `store.saveCell(path, cell)` |
| 新增 cell | 无（下次 auto-save 带上） | `store.addCell(path, index, cell)` |
| 删除 cell | `store.save()`（全量） | `store.removeCell(path, index, cellId)` |
| 显式 save_notebook | `store.save()`（全量） | `store.save()`（全量，不变） |

**`NotebookIndex` 派生方式（推荐）：** session 不维护独立的 `NotebookIndex` 缓存，而是在每次调用 `addCell`/`removeCell` 前通过辅助函数从 `session.notebook` 派生：

```typescript
function toIndex(notebook: Notebook): NotebookIndex {
  return {
    version: 2,
    metadata: notebook.metadata,
    cell_ids: notebook.cells.map((c) => c.id),
    slide: notebook.slide,
    annotations: notebook.annotations,
    assets: notebook.assets,
  };
}
```

使用示例：`store.addCell(path, toIndex(session.notebook), cell)`。此方式消除独立 index 状态，不存在缓存失同步问题。若因性能原因改用缓存方案，则 index 须在 `load()` 后初始化，并在每次 `addCell`/`removeCell` 成功返回后同步更新。

---

## 一致性保障

### addCell（严格两步）

```
① write .cells/nb-slug/cell-id.json  (原子写)
② update nb-slug.notebook.json cell_ids  (原子写)

② 失败 → unlink cell file（回滚）→ 抛错
① 失败 → 直接抛错（cell 文件不存在，index 未变）
```

### removeCell（严格两步）

```
① update nb-slug.notebook.json cell_ids  (原子写，移除该 id)
② unlink .cells/nb-slug/cell-id.json  (best-effort)

① 失败 → 抛错，cell 文件保留（数据安全）
② 失败 → 孤立文件，不被 index 引用，无害
```

### 孤立文件清理

`load()` 时扫描 `.cells/nb-slug/`，将不在 `cell_ids` 中的 `.json` 文件记录日志并删除（防止长期积累孤立文件）。

---

## gitignore.template

```
# atomic write tmp files for cell storage
.cells/**/*.tmp
```

`.cells/` 目录本身不加 ignore（需要 git 追踪）。

---

## 测试策略

**`packages/server/src/__tests__/notebook-store.test.ts`（扩展）：**

- `cellDir` / `cellPath` 路径工具正确性
- `saveCell` / `loadCell` 原子写 + schema 校验
- `addCell` 正常路径：cell 文件存在 + index 已更新 + 返回新 index
- `addCell` 失败回滚：模拟 index 写入失败 → cell 文件被删除
- `removeCell` 正常路径：index 先更新，cell 文件删除
- `removeCell` index 失败：抛错，cell 文件保留
- `load()` v1 自动迁移：cell 文件正确创建、index 为 v2、数据完整
- `load()` v2 正常加载：cell 顺序与 `cell_ids` 一致
- `save()` 全量写：cell 文件 + index 均写出

**`packages/server/src/__tests__/session.test.ts`（新测试）：**

- auto-save 只写当前 cell 文件，不重写 notebook index
- cell 完成后 git commit 包含 `.cells/nb-slug/cell-id.json`

**迁移回归：**

- v1 fixture → 迁移后所有 cell 数据完整，顺序不变

---

## 不在本次范围内

- 前端 lazy loading 路径（已有 `cell_load` 机制，暂不改动）
- `session_state_chunk` 路径（已由上一次修复统一）
- auto-save debounce 时间调整（可独立优化）
