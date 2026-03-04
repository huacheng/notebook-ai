# Prompt 队列功能实现计划

> 状态：待确认 | 创建日期：2026-03-03

## 概述

为每个 notebook 实现一个 prompt 队列，用户可以连续提交多个 prompt，系统按顺序执行，并支持可视化管理（删除、拖拽排序）。

**核心需求：**
- Notebook 执行完成一个 prompt 后，自动从队列取下一个执行
- 队列保存在后端，支持持久化
- 前端显示等待的 prompt 列表
- 用户可删除队列项、拖拽调整顺序
- 适配桌面端与移动端

---

## 架构设计

### 持久化策略

**方案：独立队列文件（推荐）**

```
workspace/
├── .notebook.json      (cells, outputs - 大文件，cell 完成时写)
└── .prompt-queue.json  (队列 - 小文件，队列变化时写)
```

**原因：**
- notebook.json 可能达到几百 MB，每次队列变化都写入整个文件性能不可接受
- 独立队列文件通常 < 100KB，写入快速（< 50ms）
- 完全解耦，互不影响

### 数据结构

#### shared/types.ts
```typescript
/** Queued prompt waiting for execution */
export interface QueuedPrompt {
  id: string;              // uuid
  source: string;          // prompt text
  images?: PromptImage[];  // optional images (base64)
  createdAt: string;       // ISO timestamp
}
```

#### 后端 session.ts
```typescript
interface NotebookSession {
  // ...existing fields...
  _promptQueue: QueuedPrompt[];  // pending prompts
  _queueVersion: number;         // optimistic lock version
}
```

#### 队列文件格式 `.prompt-queue.json`
```json
{
  "version": 3,
  "items": [
    { "id": "uuid1", "source": "Analyze the data...", "createdAt": "2026-03-03T10:00:00Z" },
    { "id": "uuid2", "source": "Write tests...", "images": [...], "createdAt": "2026-03-03T10:01:00Z" }
  ]
}
```

---

## WebSocket 消息协议

| 消息类型 | 方向 | 用途 | 参数 |
|---------|------|------|------|
| `queue_prompt` | Client → Server | 添加 prompt 到队列 | `{ source, images?, version }` |
| `queue_remove` | Client → Server | 删除队列中的 prompt | `{ id, version }` |
| `queue_reorder` | Client → Server | 重新排序队列 | `{ order: string[], version }` |
| `queue_state` | Server → Client | 同步完整队列状态 | `{ items: QueuedPrompt[], version }` |
| `queue_error` | Server → Client | 操作失败（版本冲突/限制） | `{ error, code }` |

---

## 风险分析与解决方案

### 1. 持久化性能

| 问题 | 解决方案 |
|------|----------|
| notebook.json 几百 MB，写入慢 | 独立 `.prompt-queue.json` 文件 |
| 频繁写入 | Debounce 500ms |
| 文件损坏 | 损坏时回退空队列，不崩溃 |

### 2. 并发安全（多客户端）

**问题：** 多个浏览器标签同时操作同一个 notebook 的队列

**解决方案：乐观锁 + 全量广播**

```typescript
// 客户端发送操作时带版本号
{ type: 'queue_remove', id: 'xxx', version: 3 }

// 服务端验证
if (session._queueVersion !== msg.version) {
  // 版本冲突，拒绝操作，返回最新状态
  broadcast({ type: 'queue_state', items: [...], version: session._queueVersion });
  sendToClient(ws, { type: 'queue_error', error: 'Version conflict', code: 'VERSION_MISMATCH' });
  return;
}

// 版本匹配，执行操作
session._queueVersion++;
// ... 执行操作 ...
broadcast({ type: 'queue_state', items: session._promptQueue, version: session._queueVersion });
```

### 3. 大队列 UI 性能

| 限制项 | 值 | 原因 |
|--------|-----|------|
| 最大队列长度 | 30 项 | 实际使用很难超过，简单列表足够 |
| 单条显示 | 前 80 字符 + "..." | 保持 UI 整洁 |
| hover 提示 | 完整内容（最多 500 字） | 需要时可查看 |

### 4. 图片存储

| 限制项 | 值 |
|--------|-----|
| 单张图片大小 | ≤ 5 MB |
| 队列总图片数 | ≤ 10 张 |
| 队列总图片大小 | ≤ 30 MB |

**存储策略：** 图片直接存储在队列 JSON 中（base64），队列文件最大约 30-40 MB。

### 5. 断线重连

**方案：订阅时自动同步**

```typescript
// ws-handler.ts: subscribe 处理
case 'subscribe': {
  // ...现有逻辑...

  // 订阅成功后，发送当前队列状态
  sendToClient(ws, {
    type: 'queue_state',
    session_id,
    items: session._promptQueue ?? [],
    version: session._queueVersion ?? 0,
  });
  break;
}
```

---

## UI 设计

### 桌面端

```
┌──────────────────────────────────────────────┐
│  Notebook Content Area                       │
├──────────────────────────────────────────────┤
│  ▼ Queue (3)                                 │  ← Collapsible header
│  ┌────────────────────────────────────────┐  │
│  │ ≡ "Analyze the data and create..." [×] │  │  ← Drag handle + delete
│  │ ≡ "Write unit tests for..."        [×] │  │
│  │ ≡ "Refactor the auth module..."    [×] │  │
│  └────────────────────────────────────────┘  │
├──────────────────────────────────────────────┤
│  [📎] [🎤] [  Type your prompt...  ] [▶ Run]│  ← InputBar (always enabled)
└──────────────────────────────────────────────┘
```

### 移动端

```
┌─────────────────────┐        ┌─────────────────────┐
│  Notebook Content   │        │  Notebook Content   │
│                     │        │                     │
│                     │   →    ├─────────────────────┤
├─────────────────────┤  点击  │  ▼ Pending (3)      │  ← Bottom drawer
│ (3) [  Prompt...  ] │ 徽章   │  ┌─────────────────┐│
└─────────────────────┘        │  │ Analyze data... ││  ← Swipe left to delete
   Queue badge                 │  │ Write tests...  ││
                               │  │ Refactor auth...││
                               │  └─────────────────┘│
                               │ (3) [  Prompt...  ] │
                               └─────────────────────┘
```

---

## 任务拆分

### Task 1: 后端队列数据结构与独立文件持久化

**Files:**
- Modify: `packages/shared/src/types.ts` - 添加 QueuedPrompt 类型
- Modify: `packages/server/src/session.ts` - 添加 _promptQueue, _queueVersion 字段
- Create: `packages/server/src/queue-file.ts` - 队列文件读写工具
- Test: `packages/server/src/__tests__/promptQueueFile.test.ts`

**功能：**
- `loadQueueFromFile(queuePath)` - 启动时加载
- `saveQueueToFile(queuePath)` - 队列变化时保存（debounce 500ms）
- 队列文件路径：`path.join(cwd, '.prompt-queue.json')`

### Task 2: 后端并发安全（乐观锁）

**Files:**
- Modify: `packages/server/src/session.ts` - 版本号验证
- Modify: `packages/shared/src/types.ts` - WS 消息类型
- Test: `packages/server/src/__tests__/promptQueueConcurrency.test.ts`

### Task 3: 后端 WebSocket 消息处理

**Files:**
- Modify: `packages/server/src/ws-handler.ts` - 处理 queue_* 消息
- Modify: `packages/server/src/session.ts` - 队列操作方法
- Test: `packages/server/src/__tests__/promptQueueWs.test.ts`

### Task 4: 后端队列限制

**Files:**
- Modify: `packages/server/src/session.ts` - 限制检查
- Test: `packages/server/src/__tests__/promptQueueLimits.test.ts`

### Task 5: 后端自动执行队列

**Files:**
- Modify: `packages/server/src/session.ts` - completeCell 后检查队列
- Modify: `packages/server/src/session.ts` - executeCell 智能分流
- Test: `packages/server/src/__tests__/promptQueueExec.test.ts`

### Task 6: 前端 Store 队列状态

**Files:**
- Modify: `packages/web/src/store/types.ts` - 添加 promptQueue 状态
- Create: `packages/web/src/store/queueSlice.ts` - 队列操作
- Modify: `packages/web/src/store/wsSlice.ts` - 处理 queue_* 消息
- Test: `packages/web/src/__tests__/queueSlice.test.ts`

### Task 7: 桌面端队列 UI 组件

**Files:**
- Create: `packages/web/src/components/PromptQueue.tsx` - 队列列表
- Create: `packages/web/src/components/QueueItem.tsx` - 单项组件（拖拽）
- Modify: `packages/web/src/styles.css` - 队列样式
- Modify: `packages/web/src/App.tsx` - 集成队列 UI
- Test: `packages/web/src/__tests__/promptQueueUI.test.ts`

### Task 8: 移动端队列 UI 适配

**Files:**
- Create: `packages/web/src/components/mobile/MobilePromptQueue.tsx`
- Modify: `packages/web/src/components/mobile/MobileApp.tsx` - 集成队列 UI
- Modify: `packages/web/src/components/mobile/MobileInputBar.tsx` - 队列徽章
- Modify: `packages/web/src/styles.css` - 移动端样式
- Test: `packages/web/src/__tests__/mobilePromptQueue.test.ts`

### Task 9: 断线重连同步

**Files:**
- Modify: `packages/server/src/ws-handler.ts` - subscribe 时发送 queue_state
- Test: `packages/server/src/__tests__/promptQueueReconnect.test.ts`

---

## 红绿测试（TDD）

### Task 1: 独立队列文件持久化

```typescript
// packages/server/src/__tests__/promptQueueFile.test.ts

describe('Prompt Queue File Persistence', () => {
  // Red: 队列文件独立于 notebook.json
  it('should save queue to separate .prompt-queue.json file')
  it('should NOT trigger notebook.json write when queue changes')
  it('should load queue from file on session create')
  it('should create empty queue if file does not exist')
  it('should recover empty queue if file is corrupted JSON')
  it('should debounce queue file writes (500ms)')

  // 性能相关
  it('should write queue file in < 50ms for 30 items')
  it('should not block execution while saving queue file')
});
```

### Task 2: 并发安全（乐观锁）

```typescript
// packages/server/src/__tests__/promptQueueConcurrency.test.ts

describe('Prompt Queue Concurrency (Optimistic Lock)', () => {
  // Red: 版本号机制
  it('should include version number in queue_state message')
  it('should reject queue_remove with stale version')
  it('should reject queue_reorder with stale version')
  it('should increment version on successful operation')
  it('should broadcast latest queue_state after version conflict')

  // 多客户端场景
  it('should sync queue state to all subscribers after change')
  it('should handle rapid concurrent operations correctly')
});
```

### Task 3: WebSocket 消息处理

```typescript
// packages/server/src/__tests__/promptQueueWs.test.ts

describe('Prompt Queue WebSocket Messages', () => {
  it('should add prompt to queue on queue_prompt message')
  it('should remove prompt from queue on queue_remove message')
  it('should reorder queue on queue_reorder message')
  it('should broadcast queue_state to all subscribers')
});
```

### Task 4: 队列限制

```typescript
// packages/server/src/__tests__/promptQueueLimits.test.ts

describe('Prompt Queue Limits', () => {
  // Red: 队列长度限制
  it('should reject queue_prompt when queue has 30 items')
  it('should return error message with current queue size')

  // Red: 图片限制
  it('should reject prompt with image > 5MB')
  it('should reject prompt when total queue images > 30MB')
  it('should reject prompt when queue has 10 images already')
  it('should count images correctly across all queued prompts')
});
```

### Task 5: 自动执行队列

```typescript
// packages/server/src/__tests__/promptQueueExec.test.ts

describe('Prompt Queue Auto Execution', () => {
  // Red: 执行流程
  it('should execute prompt immediately when no cell running')
  it('should queue prompt when cell is running')
  it('should execute next queued prompt after cell completes')
  it('should broadcast queue_state after item dequeued for execution')

  // Red: 中断行为
  it('should stop queue execution on interrupt')
  it('should preserve remaining queue items after interrupt')
  it('should clear interrupted flag before executing next queue item')

  // Red: 错误处理
  it('should continue queue execution after cell error')
  it('should skip and remove corrupted queue item')
});
```

### Task 6: 前端 Store

```typescript
// packages/web/src/__tests__/queueSlice.test.ts

describe('Queue Store Slice', () => {
  // Red: 状态
  it('should have promptQueue array in store')
  it('should have queueVersion number in store')
  it('should update both on queue_state message')

  // Red: 操作
  it('should send queue_prompt with current version')
  it('should send queue_remove with current version')
  it('should send queue_reorder with current version')

  // Red: 乐观更新
  it('should optimistically update queue on local action')
  it('should rollback on version conflict response')
});
```

### Task 7: 桌面端 UI

```typescript
// packages/web/src/__tests__/promptQueueUI.test.ts

describe('Prompt Queue UI (Desktop)', () => {
  // Red: 显示
  it('should render queue items with truncated text (80 chars)')
  it('should show full text on hover (max 500 chars)')
  it('should show image count badge for items with images')
  it('should show queue count badge on InputBar')
  it('should collapse/expand queue panel')

  // Red: 交互
  it('should delete item on delete button click')
  it('should reorder items on drag and drop')
  it('should show version conflict toast and refresh')
  it('should disable add when queue is full (30 items)')
});
```

### Task 8: 移动端 UI

```typescript
// packages/web/src/__tests__/mobilePromptQueue.test.ts

describe('Prompt Queue UI (Mobile)', () => {
  it('should show queue drawer on badge tap')
  it('should support touch drag for reorder')
  it('should support swipe left to delete')
  it('should close drawer after action')
});
```

### Task 9: 断线重连

```typescript
// packages/server/src/__tests__/promptQueueReconnect.test.ts

describe('Prompt Queue Reconnect', () => {
  // Red: 订阅时同步队列
  it('should send queue_state immediately after subscribe')
  it('should include current version in queue_state')
  it('should send empty queue if no items queued')

  // resume-after 场景
  it('should not duplicate queue_state on resume_after reconnect')
});
```

---

## 回归测试清单

| 分类 | 测试场景 | 验收标准 |
|------|----------|----------|
| **基本执行** | 单个 prompt 提交后立即执行 | 无队列时直接执行，status → running |
| **队列执行** | 多个 prompt 按顺序执行 | 3 个 prompt，按 1→2→3 顺序完成 |
| **中断行为** | interrupt 后队列不继续执行 | 中断后队列保留，不自动执行下一个 |
| **独立持久化** | 队列文件独立写入 | 队列变化不触发 notebook.json 写入 |
| **文件恢复** | 队列文件损坏时恢复 | 损坏 JSON 返回空队列，不崩溃 |
| **并发-版本匹配** | 版本号匹配时操作成功 | 删除/重排序正常执行 |
| **并发-版本冲突** | 版本号不匹配时拒绝 | 返回错误 + 最新 queue_state |
| **并发-多客户端** | 多标签页同步 | Tab A 操作后 Tab B 立即收到更新 |
| **限制-队列长度** | 超过 30 项时拒绝 | 返回 queue_full 错误 |
| **限制-图片大小** | 单张 > 5MB 时拒绝 | 返回 image_too_large 错误 |
| **限制-图片总量** | 总量 > 30MB 时拒绝 | 返回 queue_images_limit 错误 |
| **断线重连** | 重连后队列同步 | subscribe 后收到 queue_state |
| **删除操作** | 删除队列中的 prompt | 删除后不再执行，队列更新 |
| **重排序** | 拖拽调整顺序 | 执行顺序按新顺序 |
| **通知集成** | 队列中 AskUserQuestion | 触发通知提醒用户 |
| **移动端触摸** | 长按拖拽、左滑删除 | 触摸操作正常响应 |
| **桌面端展开/收起** | 队列面板折叠 | 点击展开/收起，记住状态 |
| **现有功能** | 执行、中断、通知等 | 无回归 |

---

## 测试执行顺序

```
1. 后端单元测试（Task 1-5, 9）
   └─ promptQueueFile.test.ts       → 独立文件持久化
   └─ promptQueueConcurrency.test.ts → 乐观锁
   └─ promptQueueWs.test.ts         → WS 消息
   └─ promptQueueLimits.test.ts     → 限制条件
   └─ promptQueueExec.test.ts       → 自动执行
   └─ promptQueueReconnect.test.ts  → 断线重连

2. 前端单元测试（Task 6-8）
   └─ queueSlice.test.ts            → Store 状态
   └─ promptQueueUI.test.ts         → 桌面端 UI
   └─ mobilePromptQueue.test.ts     → 移动端 UI

3. 集成测试
   └─ 完整流程：提交 → 队列 → 执行 → 完成 → 下一个
   └─ 并发场景：双标签页同时操作
   └─ 断线恢复：断开 → 重连 → 队列同步

4. 回归测试
   └─ 现有功能不受影响（执行、中断、通知等）
```

---

## 预估工作量

| Task | 预估 | 说明 |
|------|------|------|
| Task 1 | 2h | 数据结构 + 文件持久化 |
| Task 2 | 1h | 乐观锁机制 |
| Task 3 | 1.5h | WS 消息处理 |
| Task 4 | 1h | 限制检查 |
| Task 5 | 2h | 自动执行逻辑（核心） |
| Task 6 | 1.5h | 前端 Store |
| Task 7 | 3h | 桌面端 UI + 拖拽 |
| Task 8 | 2h | 移动端适配 |
| Task 9 | 0.5h | 断线重连 |
| **总计** | **~15h** | |

---

## 依赖关系

```
Task 1 (数据结构) ─┬─→ Task 2 (乐观锁) ─→ Task 3 (WS 消息)
                  │
                  └─→ Task 4 (限制) ─→ Task 5 (自动执行)
                                              │
Task 6 (前端 Store) ←────────────────────────┘
       │
       ├─→ Task 7 (桌面端 UI)
       │
       └─→ Task 8 (移动端 UI)

Task 9 (断线重连) 可并行
```
