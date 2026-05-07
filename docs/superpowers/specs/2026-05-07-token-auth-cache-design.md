# Token 认证缓存优化设计

**日期**：2026-05-07
**作者**：huacheng
**状态**：Draft（待评审）

## 1. 背景与动机

### 1.1 用户反馈

用户报告："认证过后，认证很快就过期了，希望同一设备 7 天免登"。

### 1.2 根因分析

- 服务端 `SESSION_TOKEN_TTL_MS` 已经是 7 天（`packages/server/src/auth.ts:85`），且已通过 SQLite 持久化跨重启不丢
- 真实根因在前端：`packages/web/src/store/authSlice.ts:10` 把 token 存在 `sessionStorage` 里
  - `sessionStorage` 关闭浏览器即清空，不跨标签页共享
  - 这是当时为防 XSS 故意做的安全 trade-off（见 `packages/web/src/__tests__/authTokenStorage.test.ts:11-12`）
- 因此即使后端 7 天有效，用户重启浏览器就要重登，体验上像"很快过期"

### 1.3 优化目标（用户全选）

1. **体验**：同一设备 7 天免登，跨标签页 / 跨浏览器重启共享登录态
2. **性能 / 减少 DB 查询**：减少 `authMiddleware` 路径上的 SQLite 命中
3. **安全 / 防滥用**：防止无效 token 反复打 DB、Map 无界增长
4. **内存 / 资源占用**：cache 加 LRU 上限，避免长跑进程内存累积
5. **代码整洁 / 重构**：消除三处重复的 Bearer 解析

### 1.4 不在范围内

- 滑动续期（用户明确排除）
- WebSocket ticket 流程改动（已是 30s 一次性 ticket，安全）
- 多机分布式 cache（项目当前是单机 SQLite）
- 引入 Redis / JWT 等替代方案

## 2. 架构总览

三个独立但配套的工作面：

```
Frontend
├── authSlice.ts        删除 sessionStorage 读写；移除 authToken 字段
├── ~22 个 fetch 调用点  删除 Authorization header；显式 credentials
├── AuthImage.tsx       删除 Bearer header 注入（cookie 自动带）
└── authTokenStorage    断言：sessionStorage 与 localStorage 都不应再含 token

Backend
├── index.ts            装 cookie-parser；挂载 csrf 中间件
├── auth.ts             登录/logout 改为发 Set-Cookie；瘦身委托 sessionCache
├── auth-helpers.ts [新] extractToken / requireAuth
├── csrf.ts        [新] Origin 白名单校验
└── session-cache.ts [新] LRU + negative cache + stats

Cookie 配置
- name      nb-auth-token
- HttpOnly  true
- Secure    NODE_ENV === 'production'
- SameSite  Lax
- Path      /
- Max-Age   7 * 86400

CSRF 策略
- SameSite=Lax + Origin 白名单（NB_ALLOWED_ORIGINS env）
- 仅对带 cookie 的 mutate 请求生效
- Bearer header 客户端不受影响（curl / NB_AUTH_TOKEN 模式可用）
- NB_CSRF_DISABLED=1 仅测试关闭
```

### 2.1 关键设计决策

| 决策 | 选项 | 选定 | 理由 |
|---|---|---|---|
| Token 存储 | sessionStorage / localStorage / HttpOnly cookie / 双存储 | **HttpOnly cookie** | 最安全，且原生支持跨标签页 |
| CSRF 防护 | 双提交 token / Origin 校验 | **Origin 校验** | SameSite=Lax 已挡大部分；Origin 白名单足够，省一份前端复杂度 |
| Bearer 兼容 | 彻底切换 / 双兼容 | **双兼容** | 保留 curl / NB_AUTH_TOKEN / 自动化客户端 |
| Dev Secure | 强制 / NODE_ENV 切换 | **NODE_ENV 切换** | dev 是 http://localhost，Secure=true 会让 cookie 不发 |
| 滑动续期 | 启用 / 不启用 | **不启用** | 用户明确排除，YAGNI |
| LRU 上限 | 1k / 10k / 100k | **10k** | 单机典型规模，evictions 上涨可调 |
| Negative cache TTL | 30s / 60s / 5min | **60s** | 平衡安全与响应敏捷度 |

### 2.2 模块依赖

```
session-cache.ts → db.ts（注入式）
auth-helpers.ts  → session-cache.ts
csrf.ts          → 仅依赖 cookie-parser 注入的 req.cookies
auth.ts          → session-cache + auth-helpers（实例化单例）
index.ts         → cookie-parser → csrf → authMiddleware（顺序敏感）
```

## 3. 核心组件细节

### 3.1 `session-cache.ts`（新增 ~150 行）

```ts
class SessionCache {
  private cache = new Map<string, SessionToken>();   // Map 顺序即 LRU 顺序
  private negCache = new Map<string, number>();      // token → expireAt
  private stats = { hits: 0, misses: 0, negHits: 0, evictions: 0 };

  constructor(
    private maxSize: number = 10_000,
    private negTtlMs: number = 60_000,
    private getDb: () => NotebookDb,
  ) {
    setInterval(() => this.sweep(), 30 * 60_000).unref();
  }

  validate(token: string): SessionToken | null { /* 见 4.2 */ }
  create(userId: string, email: string): string { /* 同步生成 + 异步落盘 */ }
  revoke(token: string): void { /* 清三处 */ }
  getStats() { /* 含 hitRate */ }

  private touch(token, value) {
    this.cache.delete(token);
    this.cache.set(token, value);
  }
  private evictIfFull() {
    if (this.cache.size <= this.maxSize) return;
    const oldest = this.cache.keys().next().value;
    this.cache.delete(oldest);
    this.stats.evictions++;
  }
  private sweep() { /* 扫过期 + 同步删 DB */ }
}
```

`validate` 分支顺序：
1. negCache 命中且未过期 → 返回 null（不打 DB）
2. cache 命中且未过期 → touch + 返回
3. cache 命中但过期 → 删 cache + 转 DB
4. DB 命中且未过期 → 写 cache + evictIfFull
5. DB miss / 过期 / 异常 → 写 negCache + 返回 null

LRU 用 `Map` 插入顺序代替双向链表：`delete + set` 即 O(1) 移到末尾。

### 3.2 `auth-helpers.ts`（新增 ~50 行）

```ts
export function extractToken(req: Request): string | null {
  const cookie = req.cookies?.['nb-auth-token'];
  if (cookie) return cookie;
  const h = req.headers['authorization'];
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return null;
}

export function requireAuth(req: Request):
  | { session: SessionToken }
  | { error: string; status: number } {
  const token = extractToken(req);
  if (!token) return { error: 'Authorization required.', status: 401 };
  const session = sessionCache.validate(token);
  if (!session) return { error: 'Invalid or expired token.', status: 401 };
  return { session };
}
```

三个 handler（`handleVerify` / `handleWsTicket` / `authMiddleware`）从 ~10 行缩到 3 行。

### 3.3 `csrf.ts`（新增 ~40 行）

```ts
const ALLOWED_ORIGINS = (process.env['NB_ALLOWED_ORIGINS']
  ?? 'http://localhost:3003,http://localhost:4003')
  .split(',').map(s => s.trim());

export function csrfMiddleware(req, res, next) {
  if (process.env['NB_CSRF_DISABLED'] === '1') return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!req.cookies?.['nb-auth-token']) return next();  // Bearer 客户端不受影响

  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return res.status(403).json({ error: 'Origin required.' });
  const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  if (!isAllowed) return res.status(403).json({ error: 'Forbidden origin.' });
  next();
}
```

挂载顺序（`packages/server/src/index.ts`）：
```ts
app.use(cookieParser());
app.use(csrfMiddleware);
app.use(authMiddleware);
```

### 3.4 `auth.ts` 重构

- **删除**：`sessionTokens` Map、相关 cleanup interval、原 `validateSessionToken/createSessionToken/revokeSessionToken` 实现
- **保留薄 wrapper**（不破坏外部 import）：
  ```ts
  export const validateSessionToken = (t) => sessionCache.validate(t);
  export const createSessionToken = (u, e) => sessionCache.create(u, e);
  export const revokeSessionToken = (t) => sessionCache.revoke(t);
  ```
- **`handleLogin` / `handleTokenLogin` / `handleRegister`**：成功时 `res.cookie('nb-auth-token', token, COOKIE_OPTS)`
- **`handleLogout`**：除原逻辑外 `res.clearCookie('nb-auth-token', COOKIE_OPTS)`
- **失效路径**：middleware 在 `validate` 返回 null 时 `res.clearCookie`，避免浏览器一直拿烂 cookie

### 3.5 前端改动

| 文件 | 改动 |
|---|---|
| `authSlice.ts` | 删除 `sessionStorage` 三处；移除 `authToken` 字段；登录响应只用 `userId`/`email` 表达登录态 |
| ~22 处 `fetch` 调用 | 删除 `Authorization: Bearer ${token}`；显式加 `credentials: 'same-origin'` |
| `AuthImage.tsx` | 删除 `sessionStorage.getItem` + `Authorization` header；fetch 加 `credentials` |
| `wsSlice.ts` | WS ticket 流程不变（cookie 自动带到 `/api/auth/ws-ticket`）|
| `__tests__/authTokenStorage.test.ts` | 断言改为：source 不应再含 `sessionStorage.setItem('nb-auth-token'`；新增"也不应含 localStorage" |

## 4. 数据流（关键路径）

### 4.1 登录流（`POST /api/auth/login`）

```
浏览器                              服务端
 ├─ POST {email,password}
 ├─────────────────────────────────►
 │                                   verifyPassword
 │                                   sessionCache.create():
 │                                     - randomBytes(32) → token
 │                                     - cache.set(); evictIfFull()
 │                                     - setImmediate(db.upsertSessionToken) ← 异步落盘
 │                                   res.cookie('nb-auth-token', token, COOKIE_OPTS)
 ◄───── Set-Cookie + JSON {ok, userId, email}    ← 响应不再含 token
 authSlice 设置 state.user
```

### 4.2 普通 API 请求流（mutate）

```
浏览器                              服务端
 ├─ POST + Cookie + Origin
 ├─────────────────────────────────► cookieParser → req.cookies
 │                                   csrfMiddleware:
 │                                     mutate + cookie + origin in 白名单 ✓
 │                                   authMiddleware:
 │                                     extractToken → sessionCache.validate
 │                                     ├ negCache 命中 → 401（不打 DB）
 │                                     ├ cache 命中 → touch + 通过
 │                                     └ DB miss → 写 negCache → 401
 ◄───── 业务响应
```

### 4.3 失效路径

```
浏览器                              服务端
 ├─ GET /api/x + 旧 cookie
 ├─────────────────────────────────► sessionCache.validate → null
 ◄───── 401 + Set-Cookie: nb-auth-token=; Max-Age=0
 authSlice → state.user = null → 路由到登录页
```

### 4.4 WebSocket（不变）

```
浏览器                              服务端
 ├─ POST /api/auth/ws-ticket + Cookie
 ├─────────────────────────────────► requireAuth(cookie) → createWsTicket
 ◄───── {ticket: "uuid"}            ← 30s TTL 一次性
 ├─ WS upgrade ?ticket=uuid
 ├─────────────────────────────────► consumeWsTicket → 握手
```

### 4.5 缓存命中曲线

| 场景 | 期望路径 |
|---|---|
| 同一 token 高频请求 | LRU 命中：cache hit，0 DB |
| 服务重启首次请求 | DB miss → SQLite 命中 → 回填 cache → 1 DB；之后 0 DB |
| 攻击者爆破随机 token | negCache 60s 拒绝，1 DB / 60s / 不同 token |
| 老 token 7 天后访问 | cache 过期 → DB 过期 → negCache + clearCookie |

## 5. 错误处理与边缘情况

### 5.1 错误响应一览

| 触发 | 状态 | body | cookie 动作 |
|---|---|---|---|
| 无 cookie 也无 Bearer | 401 | `Authorization required.` | 不动 |
| Cookie/Bearer 无效或过期 | 401 | `Invalid or expired token.` | `clearCookie` |
| CSRF：Origin 不在白名单 | 403 | `Forbidden origin.` | 不动 |
| CSRF：Origin 缺失 | 403 | `Origin required.` | 不动 |
| 登录密码错 | 401 | `Invalid credentials. Locked for Xs.` | 不动 |
| 爆破锁定 | 429 | `Too many failed attempts...` | 不动 |
| Logout（无 cookie 也无 Bearer） | 200 | `{ok: true}` | `clearCookie`（幂等） |

### 5.2 SessionCache 内部 fail-closed

```ts
try { /* validate 主流程 */ }
catch (err) {
  console.error('[sessionCache] validate failed:', err);
  return null;  // DB 异常时让用户重登，不复用上一次 cache
}
```

### 5.3 启动期防护

```ts
app.use(cookieParser());
// 启动时 assert：req.cookies 必须可用
```

挂载顺序错误会导致 CSRF 中间件 `req.cookies` 为 undefined → 全放行。测试用专门用例保护。

### 5.4 NB_AUTH_DISABLED / NB_CSRF_DISABLED 互相独立

- `NB_AUTH_DISABLED=1`：authMiddleware 直接 `next()`
- `NB_CSRF_DISABLED=1`：csrfMiddleware 直接 `next()`
- 生产环境两者都不设；测试环境分别开关

### 5.5 边缘情况

| 情况 | 处理 |
|---|---|
| 同浏览器多标签页登录 | cookie 同源共享，自动登录 ✅ |
| Logout 后另一标签页 in-flight 请求 | 401 拦下，浏览器丢 cookie，跳登录页 ✅ |
| 多设备（手机+电脑）同账号 | 各自独立 token，互不影响 |
| Cookie 与 SQLite 状态不一致 | 任一过期都按过期处理 + clearCookie |
| `NB_DB_PATH` 在 docker 部署变更 | 旧 cookie 进 negCache 60s → 跳登录页 ✅ |
| 用户清浏览器 cookie | 无 cookie → 401 → 跳登录页 ✅ |
| SameSite=Lax 外部链接首次访问 | GET 带 cookie，认证通过 ✅ |
| 高并发下 LRU 淘汰 | Node 单线程，Map 顺序操作天然安全 |
| 服务崩溃丢 negCache | 重启从空开始，最多多查几次 DB |

### 5.6 `/api/health` 增强

```json
{
  "ok": true,
  "session": {
    "size": 1234, "negSize": 56,
    "hits": 89012, "misses": 345, "negHits": 67,
    "evictions": 0,
    "hitRate": "0.996"
  }
}
```

便于运维：低命中率 → cache 没生效；evictions 增长 → 调高 maxSize；negHits 异常 → 可能被爆破。

## 6. 测试策略

### 6.1 新增测试文件

| 文件 | 覆盖 | 用例数 |
|---|---|---|
| `packages/server/src/__tests__/sessionCache.test.ts` | SessionCache 类单元 | ~12 |
| `packages/server/src/__tests__/cookieAuth.test.ts` | 登录 → cookie → 受保护路由 → logout | ~8 |
| `packages/server/src/__tests__/csrfMiddleware.test.ts` | Origin 校验 / 白名单 / Bearer 不影响 | ~6 |

### 6.2 SessionCache 单元测试

```
1.  cache hit: 第二次 validate 不打 DB
2.  cache miss + DB hit: 回填，下次不打 DB
3.  cache hit but expired: 删 cache，重查 DB
4.  LRU eviction: 超 maxSize 淘汰最早项
5.  LRU touch: validate 使该 token 移到末尾，避免被淘汰
6.  negative cache: 无效 token 60s 内不打 DB
7.  negative cache TTL 过期后重新查 DB
8.  revoke: 同时清 cache、negCache、DB
9.  DB 异常: validate 返回 null（fail-closed）
10. stats 计数: hits / misses / negHits / evictions
11. sweep: 30 分钟扫描清理过期项
12. create: 异步落 DB（setImmediate 后写入）
```

### 6.3 Cookie 认证 E2E

```
1. POST /login 返回 Set-Cookie: nb-auth-token; HttpOnly; SameSite=Lax
2. POST /login 响应 JSON 不含 token 字段
3. GET /api/projects 携带 cookie 通过认证
4. GET /api/projects 携带 Bearer 通过认证（向后兼容）
5. cookie 与 Bearer 同时携带，cookie 优先
6. Cookie 过期触发 clearCookie 响应头
7. POST /logout 返回 Set-Cookie: nb-auth-token=; Max-Age=0
8. Logout 后旧 cookie 立即失效（DB 中也删）
```

### 6.4 CSRF 中间件测试

```
1. GET 请求不校验 Origin
2. POST + cookie + 合法 Origin → 通过
3. POST + cookie + 非法 Origin → 403
4. POST + cookie + 缺失 Origin → 403
5. POST + 仅 Bearer（无 cookie）→ 不校验 Origin
6. NB_CSRF_DISABLED=1 全部放行
```

### 6.5 现有测试更新

| 测试 | 改动 |
|---|---|
| `authTokenStorage.test.ts` | 断言不应含 `sessionStorage.setItem` 与 `localStorage.setItem` |
| `userPasswordLogin.test.ts` | 验证响应 `Set-Cookie`；JSON 不含 token |
| `authTokenLogin.test.ts` | `/login-token` JSON 仍含 token（兼容 NB_AUTH_TOKEN 客户端）|
| `sessionTokenPersist.test.ts` | 改用 `sessionCache.validate`；DB 路径回填仍生效 |
| `wsTicket.test.ts` | 用 cookie 拿 ticket 而非 Bearer |
| `authRateLimit.test.ts` | 不动 |
| `auth-xff.test.ts` | 不动 |

### 6.6 前端测试

- 新增 `packages/web/src/__tests__/cookieAuthFetch.test.ts`：mock fetch，验证 ~22 调用点不再 set Authorization
- 更新 `authTokenStorage.test.ts`（如 6.5）

### 6.7 验证标准

- `npx vitest run` 全部通过
- 新增 ~26 用例，零回归
- 报告完整通过数（CLAUDE.md 要求）

### 6.8 手工验证清单

1. ✅ F12 → Application → Cookies：`nb-auth-token` 标记 HttpOnly
2. ✅ 关浏览器 → 重开 → 直接进入主页（**核心诉求验收点**）
3. ✅ DevTools 控制台 `document.cookie` 读不到 `nb-auth-token`
4. ✅ 多标签页同时登录态共享
5. ✅ Logout 后 cookie 立刻消失
6. ✅ `curl -H "Authorization: Bearer xxx" .../api/projects` 仍工作
7. ✅ `curl -X POST -H "Origin: https://evil.com" --cookie ... /api/projects` → 403
8. ✅ `/api/health` 看到 cache stats

## 7. 依赖与发布

### 7.1 新增依赖

```json
"cookie-parser": "^1.4.6",
"@types/cookie-parser": "^1.4.7"
```

### 7.2 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `NB_ALLOWED_ORIGINS` | `http://localhost:3003,http://localhost:4003` | CSRF 白名单，逗号分隔 |
| `NB_CSRF_DISABLED` | unset | 设为 `1` 关 CSRF（仅测试） |
| `NODE_ENV` | unset | `production` 时 cookie `Secure=true` |

`.env.example` 补充上述项。

### 7.3 发布

按 CLAUDE.md：版本升级（如 v2.3.0），更新 root + 所有 package.json，打 tag，push --tags。

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 用户已登录的 sessionStorage token 会被前端代码忽略 | 升级后所有用户首次访问需重登一次（一次性成本） |
| Origin 白名单遗漏生产域名 → 全员 CSRF 403 | 启动日志打印当前白名单；预发环境验证 |
| cookie-parser 漏装/挂载顺序错 → CSRF 失效 | 启动期 assert + 6.4#5 测试用例 |
| HttpOnly 后 token 调试不便 | 通过 `/api/health` cache stats 间接观察；保留 Bearer 路径用于 curl |

回滚：还原本次提交即可（cookie-parser 依赖、新增文件、auth.ts 改动彼此独立可还原）。

## 9. 参考

- 现有 token 实现：`packages/server/src/auth.ts:85-145`
- 前端存储位置：`packages/web/src/store/authSlice.ts:10`
- XSS trade-off 测试断言：`packages/web/src/__tests__/authTokenStorage.test.ts:11-12`
- WS ticket 流：`packages/server/src/ws-handler.ts:286`
- DB 表 schema：`packages/server/src/db.ts:225-258`
