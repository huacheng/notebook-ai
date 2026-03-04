# notebook-ai 多租户架构设计

> 创建日期: 2026-03-02
> 状态: 需求收集阶段

## 目标

在单台物理机上支持多用户，通过资源共享与隔离实现多租户。

---

## Part 1: 资源计费系统（待实现）

### 套餐定价示例

| 套餐 | 月费 | 免费 CU | CU 单价 | 并发会话 | 内存 | 存储 | 支持 |
|------|------|---------|---------|----------|------|------|------|
| Free | $0 | $5 worth | $0.30 | 2 | 4 GB | 1 GB | Community |
| Starter | $9 | $20 worth | $0.25 | 5 | 8 GB | 5 GB | Email |
| Pro | $29 | $100 worth | $0.20 | 15 | 16 GB | 20 GB | Priority |
| Enterprise | $99 | $500 worth | $0.15 | 50 | 32 GB | 100 GB | Dedicated |

### CU (计算单元) 换算规则

```typescript
const CU_RATES = {
  'claude-sonnet-4': {
    inputTokens: 0.3,    // $3/M tokens → 0.3 CU/M
    outputTokens: 1.5,   // $15/M tokens → 1.5 CU/M
    cacheRead: 0.03,
    cacheWrite: 0.375,
  },
  'claude-opus-4': {
    inputTokens: 1.5,    // $15/M tokens → 1.5 CU/M
    outputTokens: 7.5,   // $75/M tokens → 7.5 CU/M
    cacheRead: 0.15,
    cacheWrite: 1.875,
  },
};
```

### 数据库 Schema

```sql
-- 套餐定义
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_price_cents INTEGER,
  free_cu DECIMAL(10,2),
  cu_price DECIMAL(10,4),
  max_concurrent_sessions INTEGER,
  max_ram_mb INTEGER,
  max_storage_mb INTEGER,
  support_level TEXT
);

-- 用户订阅
CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  plan_id TEXT REFERENCES plans(id),
  billing_cycle_start DATE,
  status TEXT CHECK (status IN ('active', 'past_due', 'cancelled'))
);

-- 用量事件（时序）
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,        -- 'claude_tokens', 'storage', 'api_call'
  quantity DECIMAL(20,6),
  unit TEXT,                       -- 'tokens', 'bytes', 'requests'
  cu_equivalent DECIMAL(10,6),
  session_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 月度汇总
CREATE TABLE usage_monthly (
  user_id TEXT,
  month DATE,
  total_cu DECIMAL(12,4),
  total_tokens BIGINT,
  total_storage_mb DECIMAL(10,2),
  total_api_calls INTEGER,
  PRIMARY KEY (user_id, month)
);

-- 实时余额
CREATE TABLE user_balances (
  user_id TEXT PRIMARY KEY,
  cu_used DECIMAL(12,4) DEFAULT 0,
  cu_remaining DECIMAL(12,4),
  last_updated TIMESTAMP
);
```

### 核心组件

1. **QuotaGuard** - 执行前配额检查
2. **UsageTracker** - 实时用量追踪
3. **BillingCycle** - 月度重置 cron job
4. **UsageDashboard** - 前端用量仪表盘

### 前端用量指示器

- 工具栏显示 CU 使用百分比进度条
- >70% 黄色警告，>90% 红色
- 点击跳转升级页面

---

## Part 2: 多用户架构（研究中）

### 当前状态

| 组件 | 现状 | 多用户就绪度 |
|------|------|-------------|
| 认证 | 单一共享 token | ❌ |
| 数据库 | user_id 列存在但未启用 | 🟡 |
| 工作空间 | 全局共享目录 | ❌ |
| 会话 | 按 WebSocket 追踪 | ❌ |
| Claude 进程 | 无目录限制 | 🟡 |

### 目标架构

```
物理机
├── 共享层
│   ├── PostgreSQL/SQLite
│   ├── Redis (session ticket)
│   └── /data/library/ (只读共享)
│
└── 用户隔离层
    ├── /data/users/{user_id}/{slug}/
    ├── Claude 进程 (allowedDirs 限制)
    └── 资源配额 (CU/存储/并发)
```

### 关键变更点

1. **认证**: 共享 token → JWT + users 表
2. **路径**: `/{slug}` → `/{user_id}/{slug}`
3. **会话**: 添加 user_id 绑定
4. **WS handler**: 40+ 消息类型添加权限检查
5. **Claude 进程**: allowedDirs 限制到用户目录

### 实施阶段

- Phase 1: 基础认证 (2周)
- Phase 2: 数据隔离 (3周)
- Phase 3: 访问控制 (2周)
- Phase 4: 高级功能 (可选)

---

## Part 3: 待研究问题

- [ ] 隔离方案选择：进程级 vs 容器级 vs VM级
- [ ] Claude 进程资源限制：cgroups / ulimit
- [ ] 协作编辑：实时同步机制
- [ ] 数据迁移：现有单用户数据处理

---

## 参考

- Apify 定价模型
- Vercel/Netlify 多租户架构
