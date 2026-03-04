# notebook-ai 多用户架构设计

> 创建日期: 2026-03-02
> 状态: 调研阶段

## 目标

在单台物理机上支持多用户，通过资源共享与隔离实现多租户 SaaS 模式。

---

## 1. 当前架构评估

### 1.1 现状分析

| 组件 | 现状 | 多用户就绪度 |
|------|------|-------------|
| 认证 | 单一共享 token (`NB_AUTH_TOKEN`) | ❌ 无用户身份 |
| 数据库 | `notebooks.user_id` 列存在但未启用 | 🟡 结构可用 |
| 工作空间 | `~/.notebook-ai/{slug}` 全局共享 | ❌ 无隔离 |
| 会话 | `sessionOwners` 按 WebSocket 追踪 | ❌ 无用户绑定 |
| Claude 进程 | 每 notebook 一个，cwd=workspace | 🟡 需限制目录 |

### 1.2 关键变更点

1. **认证**: 共享 token → JWT + users 表
2. **路径**: `/{slug}` → `/{user_id}/{slug}`
3. **会话**: 添加 user_id 绑定
4. **WS handler**: 40+ 消息类型添加权限检查
5. **Claude 进程**: allowedDirs 限制到用户目录

---

## 2. 隔离方案选型

### 2.1 方案对比

| 维度 | A. 进程级隔离 | B. 容器级隔离 | C. VM级隔离 |
|------|--------------|--------------|-------------|
| **隔离强度** | 中（共享内核） | 高（namespace + cgroups） | 最高（独立内核） |
| **资源开销** | 最低 | 低（~50MB/容器） | 高（~512MB/VM） |
| **启动延迟** | <100ms | ~1s | ~10s |
| **10用户内存** | ~2GB | ~2.5GB | ~7GB |
| **运维复杂度** | 低 | 中 | 高 |
| **适用场景** | 可信团队 | SaaS 多租户 | 高安全合规 |

### 2.2 进程级隔离详细分析

#### 架构示意

```
┌─────────────────────────────────────────────────────────────────────┐
│  物理机 (单一 Node.js 进程)                                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  主进程 (index.ts)                                           │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │ Session     │  │ Session     │  │ Session     │          │   │
│  │  │ alice-nb1   │  │ alice-nb2   │  │ bob-nb1     │          │   │
│  │  │ user_id:    │  │ user_id:    │  │ user_id:    │          │   │
│  │  │ alice       │  │ alice       │  │ bob         │          │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │   │
│  └─────────┼────────────────┼────────────────┼──────────────────┘   │
│            │                │                │                      │
│            ▼                ▼                ▼                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ Claude 子进程│  │ Claude 子进程│  │ Claude 子进程│  ← 独立子进程   │
│  │ cwd: alice/ │  │ cwd: alice/ │  │ cwd: bob/   │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
│                                                                     │
│  共享内核、共享文件系统、共享网络                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 优势

| 优势 | 说明 | 对比容器 |
|------|------|----------|
| **启动速度快** | 新会话 <100ms | 容器 ~1-2s |
| **资源开销低** | 无额外 namespace/cgroups 开销 | 容器每个 ~50MB 基础开销 |
| **实现简单** | 改动现有代码最少 | 需要拆分 Control Plane/Worker |
| **调试方便** | 单进程，日志集中 | 多容器日志分散 |
| **部署简单** | 单个 Node.js 进程 | 需要 Docker/K8s |
| **内存共享** | 公共模块只加载一份 | 每容器独立加载 |
| **通信高效** | 进程内函数调用 | 需要网络/IPC |

**资源消耗对比**：

```
10 用户场景资源消耗：

进程级隔离：
├─ 主进程: 200MB
├─ 10 个 Claude 子进程: 10 × 150MB = 1.5GB
└─ 总计: ~1.7GB

容器级隔离：
├─ Control Plane: 512MB
├─ 10 个 Worker 容器: 10 × 300MB = 3GB (含 Node.js 运行时)
├─ 10 个 Claude 子进程: 10 × 150MB = 1.5GB
└─ 总计: ~5GB

差异: 容器多消耗 ~3GB (主要是重复的 Node.js 运行时)
```

#### 劣势

| 劣势 | 风险等级 | 说明 |
|------|----------|------|
| **内存隔离弱** | 🔴 高 | 一个用户的内存泄漏可能拖垮整个进程 |
| **CPU 隔离弱** | 🔴 高 | 无法限制单用户 CPU 占用 |
| **故障域大** | 🔴 高 | 主进程崩溃 = 所有用户断线 |
| **文件系统共享** | 🟡 中 | 依赖代码层面的路径检查，可能有漏洞 |
| **进程逃逸风险** | 🟡 中 | Claude 子进程可能访问其他用户文件 |
| **无法独立重启** | 🟡 中 | 无法只重启某个用户的服务 |
| **资源计量困难** | 🟡 中 | 难以精确统计单用户资源消耗 |
| **扩展性差** | 🟡 中 | 单机单进程，无法水平扩展 |

#### 关键风险详解

**风险 1：内存隔离失效**

```javascript
// 场景：恶意用户或 bug 导致内存泄漏
// 进程级：影响所有用户
// 容器级：只影响该用户容器

class SessionManager {
  private sessions = new Map();  // 所有用户共享同一个 Map

  // 如果某用户的 session 内存泄漏...
  handleMessage(userId, msg) {
    const session = this.sessions.get(userId);
    session.eventBuffer.push(msg);  // 无限增长 → OOM → 所有用户断线
  }
}
```

**风险 2：CPU 占用无法限制**

```
进程级：
┌─────────────────────────────────────────┐
│  Node.js 主进程 (单线程事件循环)         │
│                                         │
│  用户 A 的复杂计算 ─────► 阻塞事件循环    │
│                          ↓              │
│  用户 B, C, D... 全部卡住               │
└─────────────────────────────────────────┘

容器级：
┌──────────────┐  ┌──────────────┐
│ Worker A     │  │ Worker B     │
│ CPU: 100%    │  │ CPU: 正常    │  ← 互不影响
│ (被限制在2核)│  │              │
└──────────────┘  └──────────────┘
```

**风险 3：路径遍历攻击**

```javascript
// 进程级：依赖代码层面的检查，可能有漏洞
// 容器级：文件系统天然隔离，Worker-alice 根本看不到 /data/users/bob/

// 攻击向量：
// requestedPath = "../bob/secret.txt"
// requestedPath = "/data/users/bob/secret.txt"
// requestedPath = 符号链接指向其他用户目录
```

#### 进程级加固措施

如果选择进程级方案，需要以下加固：

```typescript
// 1. 会话内存限制
const MAX_BUFFER_SIZE = 500;
if (session.eventBuffer.length > MAX_BUFFER_SIZE) {
  session.eventBuffer.shift(); // 滑动窗口
}

// 2. 请求超时
const EXECUTION_TIMEOUT = 5 * 60 * 1000; // 5分钟
const controller = new AbortController();
setTimeout(() => controller.abort(), EXECUTION_TIMEOUT);

// 3. 子进程资源限制 (Linux prlimit)
spawn('prlimit', [
  '--as=4294967296',  // 4GB 地址空间
  '--cpu=300',        // 5分钟 CPU 时间
  '--nproc=50',       // 最多 50 子进程
  '--', 'claude', ...args
]);

// 4. 路径沙箱（多层检查）
function validatePath(userId, requestedPath) {
  const normalized = path.normalize(requestedPath);
  if (normalized.includes('..')) throw new Error('Path traversal');

  const realPath = fs.realpathSync(requestedPath);
  if (!realPath.startsWith(`/data/users/${userId}/`)) {
    throw new Error('Access denied');
  }
  return realPath;
}
```

### 2.3 VM 级隔离必要性分析

#### 安全边界对比

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            攻击面分析                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  进程级隔离                                                      │   │
│  │  攻破难度: ★★☆☆☆ (找到一个代码 bug 即可)                         │   │
│  │  防御: 代码审计、路径检查                                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  容器级隔离                                                      │   │
│  │  攻破难度: ★★★★☆ (需要内核 0-day 或配置错误)                      │   │
│  │  防御: 内核更新、seccomp、AppArmor                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  VM 级隔离                                                       │   │
│  │  攻破难度: ★★★★★ (需要 Hypervisor 0-day，极其罕见)               │   │
│  │  防御: Hypervisor 更新、硬件辅助虚拟化                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### VM 级隔离适用场景

| 场景 | 是否需要 VM | 原因 |
|------|-------------|------|
| **金融交易系统** | ✅ 是 | 监管合规要求，数据极其敏感 |
| **医疗健康数据** | ✅ 是 | HIPAA 等合规，患者隐私 |
| **政府/军事** | ✅ 是 | 国家安全级别 |
| **公开代码执行** (如 LeetCode) | ✅ 是 | 运行完全不可信代码 |
| **多租户云服务** (AWS/GCP) | ✅ 是 | 租户间零信任 |
| **企业内部工具** | 🟡 视情况 | 取决于数据敏感度 |
| **SaaS 产品** (一般) | ❌ 否 | 容器隔离足够 |
| **团队内部工具** | ❌ 否 | 进程/容器足够 |

#### notebook-ai 威胁模型

```
Claude 子进程的权限：
├─ cwd: /data/users/alice/project-1/
├─ 继承主进程的 UID/GID
├─ --dangerously-skip-permissions (跳过权限检查)
└─ 可以执行 shell 命令

潜在攻击向量：
1. Prompt Injection 诱导 Claude 读取其他用户文件
2. Claude 创建符号链接绕过路径检查
3. 利用 TOCTOU 竞争条件
4. 内核漏洞提权（需要容器/VM 防护）
```

#### 什么是内核 0-day

```
┌─────────────────────────────────────────────────────────────────────┐
│  漏洞生命周期                                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  发现漏洞        厂商知晓        补丁发布        用户更新             │
│     │              │              │              │                  │
│     ▼              ▼              ▼              ▼                  │
│  ───●──────────────●──────────────●──────────────●───────► 时间     │
│     │              │              │              │                  │
│     │◄─── 0-day ──►│◄── N-day ───►│◄─ 已修复 ───►│                  │
│     │   (最危险)   │  (有补丁未装) │  (安全)      │                  │
│                                                                     │
│  0-day = 厂商不知道或知道但还没补丁的漏洞                             │
│  攻击者可以利用，但防御者无法修复                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 容器为什么依赖内核安全

```
容器 vs VM 的隔离边界:

容器架构:                          VM 架构:
┌───────────┐ ┌───────────┐       ┌───────────┐ ┌───────────┐
│Container A│ │Container B│       │   VM A    │ │   VM B    │
│  App      │ │  App      │       │  App      │ │  App      │
│  Libs     │ │  Libs     │       │  Libs     │ │  Libs     │
└─────┬─────┘ └─────┬─────┘       │  Kernel A │ │  Kernel B │
      │             │             └─────┬─────┘ └─────┬─────┘
      └──────┬──────┘                   └──────┬──────┘
             ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│    共享的 Linux 内核     │       │      Hypervisor        │
│    (单点故障!)          │       │   (独立隔离层)          │
└─────────────────────────┘       └─────────────────────────┘

关键区别: 容器共享宿主机内核，内核漏洞 = 全部容器沦陷
```

#### 内核 0-day 的典型类型

| 漏洞类型 | 说明 | 容器逃逸方式 |
|----------|------|-------------|
| **权限提升** | 普通用户获得 root 权限 | 容器内 root → 宿主机 root |
| **命名空间逃逸** | 突破 namespace 隔离 | 看到/访问其他容器或宿主机 |
| **cgroups 绕过** | 突破资源限制 | 耗尽宿主机资源 |
| **文件系统漏洞** | OverlayFS/procfs 漏洞 | 读写宿主机文件 |
| **内存损坏** | 堆溢出/UAF | 任意代码执行 |

#### 历史案例

**案例 1: Dirty COW (CVE-2016-5195)**
```
漏洞: Linux 内核 Copy-on-Write 竞争条件
影响: 2007-2016 所有 Linux 版本 (9年未发现!)
危害: 普通用户可以修改只读文件，获得 root 权限

攻击路径:
容器内普通用户 → 利用 Dirty COW → 修改 /etc/passwd → root 权限 → 逃逸到宿主机

时间线:
2016-10-18: 漏洞被公开
2016-10-19: 补丁发布
2016-10-20: 野外利用代码出现
```

**案例 2: runc 逃逸 (CVE-2019-5736)**
```
漏洞: Docker/K8s 的容器运行时 runc
影响: Docker < 18.09.2, K8s 所有版本
危害: 容器内进程可以覆盖宿主机的 runc 二进制

攻击路径:
恶意容器镜像 → docker exec 时覆盖 /usr/bin/docker-runc → 下次启动容器时宿主机执行恶意代码
```

**案例 3: OverlayFS 提权 (CVE-2023-0386)**
```
漏洞: Linux 5.11-6.2 OverlayFS 文件系统
时间: 2023 年 3 月
危害: 非特权用户可以提升为 root

攻击路径:
容器用户 → 创建特殊 SUID 文件 → OverlayFS 处理错误 → 宿主机 root
```

#### 0-day 发生的场景

```
哪些情况下会遇到内核 0-day？

1. 高价值目标定向攻击
   ├─ 国家级 APT 组织
   ├─ 金融机构/交易所
   └─ 关键基础设施

2. 漏洞交易市场
   ├─ 黑市价格: Linux 内核 0-day ~$50,000-$500,000
   ├─ 合法市场: Zerodium 收购价 ~$250,000
   └─ 漏洞赏金: Google/Linux 基金会 ~$10,000-$30,000

3. 安全研究/CTF 竞赛
   ├─ Pwn2Own 比赛
   ├─ 学术研究论文
   └─ 漏洞披露 (responsible disclosure)

4. 偶然发现
   ├─ 开发者发现代码缺陷
   ├─ 代码审计工具扫描
   └─ Fuzzing 测试
```

#### notebook-ai 0-day 风险评估

```
┌─────────────────────────────────────────────────────────────────────┐
│  内核 0-day 年度统计 (Linux):                                        │
│  • 严重漏洞 (可逃逸): ~5-10 个/年                                    │
│  • 平均存活时间: 被发现前 ~2-5 年                                    │
│  • 野外利用: 大多数 0-day 从未被公开利用                              │
├─────────────────────────────────────────────────────────────────────┤
│  notebook-ai 威胁等级:                                               │
│  • 是否高价值目标？ → 否 (非金融/政府)                               │
│  • 是否运行不可信代码？ → 部分 (Claude 执行用户指令)                  │
│  • 攻击者动机？ → 低 (用户自己的 AI notebook)                        │
│  • 数据价值？ → 中等 (用户文档/代码)                                 │
├─────────────────────────────────────────────────────────────────────┤
│  结论:                                                               │
│  被内核 0-day 定向攻击的概率: 极低 (<0.01%)                          │
│  更现实的威胁: N-day (已知漏洞未打补丁)、应用层漏洞                   │
└─────────────────────────────────────────────────────────────────────┘
```

#### notebook-ai 是否需要 VM？

| 阶段 | 需要 VM？ | 原因 |
|------|-----------|------|
| 内部使用 | ❌ 否 | 用户可信，进程级足够 |
| 小型 SaaS | ❌ 否 | 容器级足够 |
| 中型 SaaS | 🟡 可选 | gVisor 加固即可 |
| 企业版 | 🟡 视客户要求 | 部分客户可能要求 |
| 金融/医疗/政府 | ✅ 是 | 合规要求 |

**实际威胁排序**（对 notebook-ai）：
1. 🔴 应用层漏洞（路径遍历、注入）— 最可能
2. 🟡 N-day（已知漏洞未打补丁）— 需要关注
3. 🟢 内核 0-day — 概率极低，除非成为高价值目标

#### 容器安全加固措施

| 层级 | 措施 | 效果 |
|------|------|------|
| **基础** | 及时更新内核 | 防护 N-day (已公开漏洞) |
| **容器加固** | seccomp (系统调用白名单) | 减少攻击面 ~80% |
| **容器加固** | AppArmor/SELinux | 限制文件/网络访问 |
| **容器加固** | 只读根文件系统 | 防止持久化攻击 |
| **容器加固** | 非 root 用户运行 | 降低提权影响 |
| **高级** | gVisor (用户态内核) | 拦截 99% 系统调用 |
| **最高** | Firecracker/VM | 硬件级隔离 |

```yaml
# Docker 安全加固配置示例
services:
  worker:
    security_opt:
      - no-new-privileges:true        # 禁止提权
      - seccomp:seccomp-default.json  # 系统调用白名单
      - apparmor:docker-default       # MAC 策略
    cap_drop:
      - ALL                           # 移除所有 capabilities
    read_only: true                   # 只读根文件系统
    user: "1000:1000"                 # 非 root 运行
```

#### 轻量级 VM 替代方案

如果确实需要更强隔离，可以考虑：

**Firecracker microVM** (AWS 开源)
- 启动时间: ~125ms (接近容器)
- 内存开销: ~5MB (远小于传统 VM)
- 安全边界: 硬件虚拟化 (KVM)

**gVisor** (Google 开源)
- 容器级启动速度
- 用户态内核拦截系统调用
- 与 Docker/K8s 兼容
- 性能损失 ~20-50%

### 2.4 推荐方案：Docker 容器

**结论：推荐使用 Docker 容器级隔离**

#### 推荐理由

| 维度 | 进程级 | **Docker 容器** | VM 级 |
|------|--------|-----------------|-------|
| **隔离强度** | 依赖代码质量 | **内核级保证** | 硬件级 |
| **资源开销** | 最低 | **低** | 高 |
| **启动速度** | <100ms | **~1s** | ~10s |
| **故障隔离** | 差 | **好** | 最好 |
| **扩展性** | 单机 | **多机** | 多机 |
| **运维复杂度** | 低 | **中** | 高 |
| **成本** | $0 | **$0** | $0-$5000/年 |
| **合规覆盖** | ❌ | **🟡 大部分** | ✅ 全部 |

#### 决策矩阵

```
┌─────────────────────────────────────────────────────────────────┐
│  notebook-ai 隔离方案决策                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Q1: 用户是否运行不可信代码？                                    │
│      │                                                          │
│      ├─ 是 (公开平台)                                           │
│      │   └─ Q2: 数据敏感度？                                    │
│      │       ├─ 高 (金融/医疗) → VM 级 或 gVisor                │
│      │       └─ 中/低 → Docker 容器 ✓                           │
│      │                                                          │
│      └─ 否 (内部/可信用户)                                       │
│          └─ Q3: 用户规模？                                      │
│              ├─ <50 人 → 进程级 (起步)                          │
│              └─ >50 人 → Docker 容器 ✓                          │
│                                                                 │
│  notebook-ai 定位: SaaS 产品，用户量 >50                         │
│  推荐方案: Docker 容器级隔离 ✓                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 推荐演进路径

```
阶段 1: 进程级 (当前，快速验证)
   │
   │  用户量 >50 或 SaaS 上线
   ▼
阶段 2: Docker 容器 ✓ (推荐目标)
   │
   │  企业客户/合规需求
   ▼
阶段 3: Docker + gVisor (加固)
   │
   │  金融/医疗/政府客户
   ▼
阶段 4: Firecracker/VM (按需)
```

**Docker 容器是 notebook-ai 多用户隔离的最佳平衡点**：
- 提供内核级隔离，防止跨用户攻击
- 资源开销可接受（~300MB/用户）
- 支持 cgroups 硬性资源限制
- 易于扩展到多机集群
- 免费开源，无额外成本
- 满足大多数 SaaS 场景的安全需求

---

## 3. 容器隔离原理

### 3.1 Linux 容器核心技术

```
┌─────────────────────────────────────────────────────────────────────┐
│  物理机 Linux 内核                                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ Container A │  │ Container B │  │ Container C │                 │
│  │             │  │             │  │             │                 │
│  │ PID: 1,2,3  │  │ PID: 1,2    │  │ PID: 1      │  ← 独立 PID     │
│  │ Net: eth0   │  │ Net: eth0   │  │ Net: eth0   │  ← 独立网卡     │
│  │ UID: 0-65535│  │ UID: 0-65535│  │ UID: 0-65535│  ← 独立用户     │
│  │ /: rootfs-a │  │ /: rootfs-b │  │ /: rootfs-c │  ← 独立根目录   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │
│         │                │                │                         │
│  ┌──────▼────────────────▼────────────────▼──────┐                 │
│  │              Namespace 隔离层                  │                 │
│  │  • PID namespace  - 进程树隔离                 │                 │
│  │  • NET namespace  - 网络栈隔离                 │                 │
│  │  • MNT namespace  - 挂载点隔离                 │                 │
│  │  • UTS namespace  - 主机名隔离                 │                 │
│  │  • IPC namespace  - 进程间通信隔离             │                 │
│  │  • USER namespace - 用户/组 ID 隔离            │                 │
│  └──────────────────────────────────────────────┘                 │
│                          │                                         │
│  ┌──────────────────────▼──────────────────────┐                  │
│  │              Cgroups 资源限制                 │                  │
│  │  • cpu     - CPU 时间片配额                   │                  │
│  │  • memory  - 内存上限 (OOM killer)            │                  │
│  │  • blkio   - 磁盘 I/O 带宽                    │                  │
│  │  • pids    - 进程数量上限                     │                  │
│  │  • devices - 设备访问控制                     │                  │
│  └─────────────────────────────────────────────┘                  │
│                          │                                         │
│  ┌──────────────────────▼──────────────────────┐                  │
│  │           OverlayFS 文件系统                  │                  │
│  │  • 只读层: 基础镜像 (共享，节省空间)           │                  │
│  │  • 读写层: 容器修改 (Copy-on-Write)           │                  │
│  └─────────────────────────────────────────────┘                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 隔离机制详解

| 机制 | 作用 | 多用户隔离效果 |
|------|------|----------------|
| **PID Namespace** | 容器内 PID 从 1 开始，看不到其他容器进程 | 用户 A 无法 kill 用户 B 的进程 |
| **NET Namespace** | 独立网络栈、IP、端口 | 用户 A 无法嗅探用户 B 的网络流量 |
| **MNT Namespace** | 独立挂载表 | 用户 A 看不到用户 B 的文件系统 |
| **USER Namespace** | 容器内 root ≠ 宿主机 root | 即使容器内提权也无法逃逸 |
| **Cgroups** | 硬性资源上限 | 用户 A 无法耗尽 CPU/内存影响用户 B |
| **Seccomp** | 系统调用白名单 | 禁止危险操作 (reboot, mount 等) |

---

## 4. 容器级架构设计

### 4.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           物理机 / 云主机                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  nginx (443)                                                     │   │
│  │  ├─ /api/auth/*  → control-plane:3002                           │   │
│  │  ├─ /api/notebooks (GET) → control-plane:3002                   │   │
│  │  ├─ /api/projects/* → control-plane:3002                        │   │
│  │  ├─ /api/library/* → control-plane:3002                         │   │
│  │  ├─ /ws → 根据 user_id 路由到 worker-{user_id}                   │   │
│  │  └─ /* (其他 API) → 根据 session 路由到对应 worker               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│            ┌───────────────────────┴───────────────────────┐           │
│            ▼                                               ▼           │
│  ┌──────────────────┐                         ┌──────────────────────┐ │
│  │  Control Plane   │                         │    Worker Pool       │ │
│  │  (1 container)   │                         │    (N containers)    │ │
│  │                  │                         │                      │ │
│  │  • Auth API      │    ┌──────────────┐     │  ┌────────────────┐  │ │
│  │  • Notebook list │    │   Redis      │     │  │ worker-alice   │  │ │
│  │  • Project CRUD  │◄──►│  (tickets,   │◄───►│  │ SessionManager │  │ │
│  │  • Library mgmt  │    │   routing)   │     │  │ AgentProcess   │  │ │
│  │  • User mgmt     │    └──────────────┘     │  │ WebSocket      │  │ │
│  │                  │                         │  └────────────────┘  │ │
│  │         │        │                         │  ┌────────────────┐  │ │
│  │         ▼        │                         │  │ worker-bob     │  │ │
│  │  ┌────────────┐  │                         │  │ SessionManager │  │ │
│  │  │ PostgreSQL │  │                         │  │ AgentProcess   │  │ │
│  │  │ (metadata) │◄─┼─────────────────────────┼─►│ WebSocket      │  │ │
│  │  └────────────┘  │                         │  └────────────────┘  │ │
│  └──────────────────┘                         └──────────────────────┘ │
│            │                                               │           │
│            └───────────────────┬───────────────────────────┘           │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Shared Storage (Docker Volume / NFS)                            │   │
│  │  /data/                                                          │   │
│  │  ├── library/            (全局只读)                               │   │
│  │  └── users/                                                      │   │
│  │      ├── alice/          (worker-alice 独占读写)                  │   │
│  │      │   ├── .library/   (用户知识库)                             │   │
│  │      │   ├── project-a/                                          │   │
│  │      │   └── project-b/                                          │   │
│  │      └── bob/            (worker-bob 独占读写)                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 组件职责划分

#### Control Plane（控制平面）

| 路由 | 操作 | 说明 |
|------|------|------|
| `POST /api/auth/*` | 认证 | JWT 签发、ticket 生成 |
| `GET /api/notebooks` | 读 | 笔记本列表（元数据） |
| `GET /api/projects` | 读 | 项目列表 |
| `POST /api/projects` | 写 | 创建项目 |
| `GET /api/library/global` | 读 | 全局知识库 |
| `POST /api/library/global` | 写 | 管理员更新全局库 |
| `GET /api/billing/*` | 读 | 用量、账单 |

#### Worker（用户容器）

| 路由/功能 | 操作 | 说明 |
|-----------|------|------|
| `WebSocket /ws` | 全部 | 会话管理、实时通信 |
| `SessionManager` | 内存 | 活跃会话状态 |
| `AgentProcess` | 子进程 | Claude CLI 执行 |
| `NotebookStore` | 文件 | 笔记本读写 |
| `GitManager` | 文件 | Git 操作 |

### 4.3 Docker Compose 配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  control-plane:
    image: notebook-ai/control-plane:latest
    ports:
      - "3002:3002"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://nb:${DB_PASSWORD}@postgres:5432/notebook
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - postgres
      - redis
    deploy:
      replicas: 1
      resources:
        limits:
          cpus: '1'
          memory: 512M

  # Worker 模板（按需创建）
  worker-template:
    image: notebook-ai/worker:latest
    environment:
      - NODE_ENV=production
      - WORKER_ID=${WORKER_ID}
      - USER_ID=${USER_ID}
      - DATABASE_URL=postgres://nb:${DB_PASSWORD}@postgres:5432/notebook
      - REDIS_URL=redis://redis:6379
      - NB_WORKSPACE_DIR=/workspace
      - NB_USER_LIBRARY=/user-library
      - NB_GLOBAL_LIBRARY=/global-library
    volumes:
      - user-data-${USER_ID}:/workspace:rw
      - user-library-${USER_ID}:/user-library:rw
      - global-library:/global-library:ro
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          memory: 512M
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    tmpfs:
      - /tmp:size=200M,mode=1777

  postgres:
    image: postgres:16-alpine
    volumes:
      - postgres-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=nb
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=notebook
    deploy:
      resources:
        limits:
          memory: 256M

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    deploy:
      resources:
        limits:
          memory: 128M

volumes:
  postgres-data:
  redis-data:
  global-library:
```

---

## 5. 三级知识库存储设计

### 5.1 目录层次结构

```
/data/
├── library/                          # L0: 全局共享库 (运营商提供)
│   ├── templates/                    #     笔记本模板
│   ├── datasets/                     #     公共数据集
│   ├── prompts/                      #     提示词库
│   └── .master-index.md              #     全局索引
│
└── users/
    ├── alice/                        # 用户 alice 的根目录
    │   ├── .library/                 # L1: 用户级知识库 (alice 专属)
    │   │   ├── .memory/              #     跨项目记忆
    │   │   ├── .changelog/           #     变更日志
    │   │   ├── .master-index.md      #     用户级索引
    │   │   └── snippets/             #     代码片段收藏
    │   │
    │   ├── project-a/                # L2: 项目级
    │   │   ├── .index.json           #     项目元数据
    │   │   ├── .deliverables/        #     项目交付物
    │   │   ├── .worktrees/           #     笔记本工作树
    │   │   │   ├── notebook-1/       # L3: 笔记本级
    │   │   │   │   ├── notebook-1.notebook.json
    │   │   │   │   ├── MEMORY.md
    │   │   │   │   ├── .deliverables/
    │   │   │   │   └── .working/
    │   │   │   └── notebook-2/
    │   │   └── shared-files/
    │   │
    │   └── project-b/
    │
    └── bob/
        ├── .library/
        └── ...
```

### 5.2 访问控制矩阵

| 路径 | 所有者 | 读权限 | 写权限 | 挂载方式 |
|------|--------|--------|--------|----------|
| `/data/library/` | 运营商 | 所有用户 | 运营商管理员 | `:ro` 只读 |
| `/data/users/{user}/.library/` | 用户 | 仅该用户 | 仅该用户 | `:rw` 读写 |
| `/data/users/{user}/{project}/` | 用户 | 仅该用户 | 仅该用户 | `:rw` 读写 |

### 5.3 Worker 容器挂载

```yaml
volumes:
  # 用户工作空间 (读写)
  - type: bind
    source: /data/users/${USER_ID}
    target: /workspace
    read_only: false

  # 用户知识库 (读写)
  - type: bind
    source: /data/users/${USER_ID}/.library
    target: /user-library
    read_only: false

  # 全局知识库 (只读)
  - type: bind
    source: /data/library
    target: /global-library
    read_only: true
```

### 5.4 Claude 进程目录权限

```typescript
function buildAllowedDirs(userId: string, notebookPath: string): string[] {
  return [
    // 当前笔记本工作目录 (读写)
    notebookPath,

    // 项目根目录 (读写，用于跨笔记本访问)
    path.dirname(path.dirname(notebookPath)),

    // 用户知识库 (读写)
    process.env.NB_USER_LIBRARY,

    // 全局知识库 (只读 - mount 已限制)
    process.env.NB_GLOBAL_LIBRARY,
  ].filter(Boolean);
}
```

---

## 6. 资源计费系统

### 6.1 套餐定价

| 套餐 | 月费 | 免费 CU | CU 单价 | 并发会话 | 内存 | 存储 | 支持 |
|------|------|---------|---------|----------|------|------|------|
| Free | $0 | $5 worth | $0.30 | 2 | 4 GB | 1 GB | Community |
| Starter | $9 | $20 worth | $0.25 | 5 | 8 GB | 5 GB | Email |
| Pro | $29 | $100 worth | $0.20 | 15 | 16 GB | 20 GB | Priority |
| Enterprise | $99 | $500 worth | $0.15 | 50 | 32 GB | 100 GB | Dedicated |

### 6.2 CU (计算单元) 换算规则

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

function calculateCU(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0
): number {
  const rate = CU_RATES[model] ?? CU_RATES['claude-sonnet-4'];

  return (
    (inputTokens / 1_000_000) * rate.inputTokens +
    (outputTokens / 1_000_000) * rate.outputTokens +
    (cacheReadTokens / 1_000_000) * rate.cacheRead +
    (cacheWriteTokens / 1_000_000) * rate.cacheWrite
  );
}
```

### 6.3 数据库 Schema

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
  event_type TEXT NOT NULL,
  quantity DECIMAL(20,6),
  unit TEXT,
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

### 6.4 配额检查

```typescript
class QuotaGuard {
  async checkBeforeExecution(userId: string): Promise<QuotaCheckResult> {
    const [subscription, balance, activeSessions] = await Promise.all([
      this.db.getSubscription(userId),
      this.db.getUserBalance(userId),
      this.redis.scard(`user:${userId}:sessions`),
    ]);

    const plan = await this.db.getPlan(subscription.planId);

    // 1. CU 余额检查
    if (balance.cuRemaining <= 0) {
      return {
        allowed: false,
        reason: 'CU quota exhausted. Upgrade plan or wait for billing cycle reset.',
      };
    }

    // 2. 并发会话检查
    if (activeSessions >= plan.maxConcurrentSessions) {
      return {
        allowed: false,
        reason: `Max concurrent sessions (${plan.maxConcurrentSessions}) reached.`,
      };
    }

    // 3. 存储配额检查
    const storageUsed = await this.getStorageUsage(userId);
    if (storageUsed >= plan.maxStorageMb) {
      return {
        allowed: false,
        reason: `Storage quota (${plan.maxStorageMb} MB) exceeded.`,
      };
    }

    return { allowed: true };
  }
}
```

---

## 7. 容量规划

### 7.1 基础设施开销

| 组件 | 内存 | CPU | 存储 | 说明 |
|------|------|-----|------|------|
| Linux 内核 + 系统服务 | 1 GB | 0.5 核 | 10 GB | 固定 |
| Docker daemon | 200 MB | 0.2 核 | 5 GB | 镜像缓存 |
| Control Plane | 512 MB | 0.5 核 | 1 GB | API + 路由 |
| PostgreSQL | 256 MB | 0.25 核 | 10 GB | 元数据 |
| Redis | 128 MB | 0.1 核 | 1 GB | 缓存 |
| nginx | 64 MB | 0.1 核 | 100 MB | 反向代理 |
| Prometheus + Grafana | 512 MB | 0.2 核 | 5 GB | 监控 |
| **基础设施合计** | **~2.7 GB** | **~2 核** | **~32 GB** | |

### 7.2 单用户资源需求

```
用户 Worker 容器资源消耗模型：

Node.js 进程 (WS handler + SessionManager)
├─ 基础: 80-150 MB
├─ 每活跃会话: +50-100 MB
└─ 峰值: 500 MB

Claude 子进程 (per notebook)
├─ 进程开销: 50-100 MB
├─ 上下文缓存: 100-500 MB
└─ 峰值: 1-2 GB

资源配置建议：
┌────────────────┬─────────────┬─────────────┬─────────────┐
│ 用户活跃度     │ 内存配额    │ CPU 配额    │ 存储配额    │
├────────────────┼─────────────┼─────────────┼─────────────┤
│ 轻度 (1 笔记本) │ 1 GB        │ 0.5 核      │ 5 GB        │
│ 中度 (2-3 笔记本)│ 2 GB        │ 1 核        │ 20 GB       │
│ 重度 (5+ 笔记本) │ 4 GB        │ 2 核        │ 50 GB       │
│ 空闲 (无活跃会话)│ 256 MB      │ 0.1 核      │ -           │
└────────────────┴─────────────┴─────────────┴─────────────┘
```

### 7.3 32GB 16核 500GB 物理机容量

**剩余可分配资源**：
- 内存：32 - 2.7 ≈ **29 GB**
- CPU：16 - 2 ≈ **14 核**
- 存储：500 - 32 ≈ **468 GB**

**容量估算**：

| 场景 | 同时活跃用户 | 同时在线用户 | 注册用户总数 |
|------|-------------|-------------|-------------|
| 全活跃（最坏） | 12-15 | 12-15 | 12-15 |
| 混合活跃（典型） | 12-15 | 25-30 | 40-60 |
| 超额订阅（生产） | 12-15 | 25-30 | 80-100 |

**超额订阅假设**：
- 注册用户 100 人
- 同时在线率 30%
- 活跃执行率 50%
- → 同时活跃 ~15 人

---

## 8. 用户扩容迁移方案

### 8.1 方案对比

| 方案 | 停机时间 | 实现复杂度 | 基础设施成本 |
|------|----------|-----------|-------------|
| 同机扩容 | 0 | 低 | 低（单机） |
| rsync 迁移 | 10-60s | 中 | 中（多机） |
| 共享存储 | 0 | 高 | 高（Ceph/NFS） |
| Kubernetes | 0 | 最高 | 最高 |

### 8.2 同机扩容（在线调整）

```bash
# Docker 支持在线调整 cgroups 限制

# 更新内存限制
docker update --memory=4g --memory-swap=4g worker-alice

# 更新 CPU 限制
docker update --cpus=2 worker-alice

# 扩展存储（LVM）
lvextend -L +45G /dev/vg0/user-alice-data
resize2fs /dev/vg0/user-alice-data
```

### 8.3 跨机迁移（rsync）

```typescript
async function migrateUser(plan: MigrationPlan): Promise<void> {
  const { userId, sourceHost, targetHost } = plan;

  // Phase 1: 初始同步 (无停机)
  await exec(`rsync -avz --progress \
    ${sourceHost}:/data/users/${userId}/ \
    ${targetHost}:/data/users/${userId}/`);

  // Phase 2: 停止源服务 (短暂停机)
  await notifyUser(userId, 'migration_starting');
  await closeUserSessions(userId, sourceHost);
  await exec(`ssh ${sourceHost} docker stop worker-${userId}`);

  // Phase 3: 最终同步 (增量)
  await exec(`rsync -avz --delete \
    ${sourceHost}:/data/users/${userId}/ \
    ${targetHost}:/data/users/${userId}/`);

  // Phase 4: 启动目标服务
  await exec(`ssh ${targetHost} docker run -d \
    --name worker-${userId} \
    --memory=4g --cpus=2 \
    -v /data/users/${userId}:/workspace \
    notebook-ai/worker:latest`);

  // Phase 5: 更新路由
  await redis.hset('worker:routes', userId, `${targetHost}:3002`);

  // Phase 6: 通知完成
  await notifyUser(userId, 'migration_complete');
}
```

**迁移时间线**：

```
T0                T1              T2        T3        T4
│                 │               │         │         │
▼                 ▼               ▼         ▼         ▼
初始同步          停止源         最终同步   启动目标   路由切换
(后台运行)        Worker         (秒级)    Worker    (毫秒级)
10min-1h          │               │         │         │
                  └───────────────┴─────────┘
                        停机时间: 10-60秒
```

### 8.4 零停机迁移（共享存储）

```
┌─────────────────────────────────────────────────────────────┐
│                    分布式存储 (Ceph RBD)                     │
│                                                              │
│  /data/users/alice/  ◄─── 多节点可同时访问                   │
│                                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │  Node A    │  │  Node B    │  │  Node C    │
    │  (小)      │  │  (中)      │  │  (大)      │
    └────────────┘  └────────────┘  └────────────┘
```

```typescript
async function liveRelocate(userId: string, targetNode: string): Promise<void> {
  // 1. 在目标节点启动新 Worker（挂载相同存储）
  await startWorkerOnNode(userId, targetNode);
  await waitForHealthy(targetNode, userId);

  // 2. 原子切换路由
  await redis.hset('worker:routes', userId, `${targetNode}:3002`);

  // 3. 等待现有连接 drain
  await sleep(5000);

  // 4. 停止源节点 Worker
  await stopWorkerOnNode(userId, sourceNode);
}
```

### 8.5 迁移决策流程

```
用户升级套餐
     │
     ▼
┌─────────────────────────┐
│ 当前节点资源是否足够？   │
└───────────┬─────────────┘
            │
     ┌──────┴──────┐
     │ 是          │ 否
     ▼             ▼
┌─────────┐  ┌─────────────────────┐
│ 在线扩容 │  │ 选择目标节点         │
│ (秒级)  │  │ (资源池匹配)         │
└─────────┘  └──────────┬──────────┘
                        │
                ┌───────┴───────┐
                │ 共享存储？     │
                └───────┬───────┘
                        │
             ┌──────────┴──────────┐
             │ 是                  │ 否
             ▼                     ▼
     ┌──────────────┐      ┌──────────────┐
     │ 零停机迁移    │      │ 数据同步迁移  │
     │ (路由切换)    │      │ (10-60s 停机) │
     └──────────────┘      └──────────────┘
```

---

## 9. 实施路线图

### Phase 1: 基础认证（2周）

- [ ] 实现 users 表 + 注册/登录 API
- [ ] 替换共享 token 为 JWT
- [ ] 前端登录流程改造
- [ ] 单元测试：认证流程

### Phase 2: 数据隔离（3周）

- [ ] 工作空间路径重构：/users/{id}/{slug}
- [ ] 数据迁移脚本
- [ ] notebooks/sessions 添加 user_id 约束
- [ ] 集成测试：跨用户隔离

### Phase 3: 访问控制（2周）

- [ ] WS handler 40+ 消息类型添加权限检查
- [ ] Claude 进程目录限制
- [ ] 配额系统
- [ ] 渗透测试：路径遍历/权限绕过

### Phase 4: 容器化（2周）

- [ ] 拆分 Control Plane / Worker
- [ ] Docker Compose 配置
- [ ] Worker 生命周期管理
- [ ] 负载均衡配置

### Phase 5: 计费系统（2周）

- [ ] 套餐/订阅表
- [ ] 用量追踪
- [ ] 配额检查集成
- [ ] 前端用量仪表盘

### Phase 6: 运维完善（持续）

- [ ] 监控告警
- [ ] 自动扩缩容
- [ ] 备份恢复
- [ ] 文档

---

## 10. 安全检查清单

- [ ] 所有路径操作经过 `validateUserPath()`
- [ ] WS handler 每个 case 验证 `session.userId === req.userId`
- [ ] Claude 进程 `allowedDirs` 不含其他用户目录
- [ ] JWT 签名密钥独立于 `NB_AUTH_TOKEN`
- [ ] 数据库查询 WHERE 条件包含 `user_id`
- [ ] 错误消息不泄露其他用户信息
- [ ] 容器 seccomp profile 限制危险系统调用
- [ ] 容器 capabilities 最小化

---

## 11. Docker 方案详细开发计划

### 11.1 改造点清单（按依赖顺序）

#### 第一阶段：认证系统升级（3-4 天）

**auth.ts — JWT 化改造**
- [ ] 添加 `jsonwebtoken` 依赖或使用 Node.js 内置 crypto
- [ ] `createUserToken(userId: string, expirySeconds = 86400): string`
- [ ] `verifyUserToken(token: string): { userId: string } | null`
- [ ] 修改 `handleLogin()` 接收 username + password，返回 JWT
- [ ] 修改 `handleVerify()` 验证 JWT 而非 plain token
- [ ] 新增 `handleRegister()` 注册新用户

**db.ts — Users 表 + 外键约束**
- [ ] 添加 `users` 表迁移
- [ ] `UserRow` 接口定义
- [ ] 新增 CRUD: `createUser()`, `getUserByUsername()`, `updateUser()`, `deleteUser()`
- [ ] 为 notebooks/projects 表添加 FOREIGN KEY `user_id REFERENCES users(id)`
- [ ] 为 notebooks/projects 表添加索引：`(user_id, status)` 和 `(user_id, updated_at DESC)`

```sql
-- Users 表 Schema
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 外键约束
ALTER TABLE notebooks ADD CONSTRAINT fk_nb_user
  FOREIGN KEY (user_id) REFERENCES users(id);
```

#### 第二阶段：路径与工作空间隔离（3-4 天）

**workspace.ts 和 routes/notebooks.ts — 路径隔离加固**
- [ ] 修改 `getWorkspaceDir(slug, userId)` 确保返回 `/nb-workspaces/users/{userId}/{slug}`
- [ ] 修改 `validateWorkspacePath()` 强制检查 realpath 在 `/users/{userId}/` 下
- [ ] 修改 `ensureWorkspaceDir()` 创建用户目录时设置 umask 0077
- [ ] 修改 `/api/notebooks/list` 获取当前用户的 userId，过滤列表
- [ ] 修改 `/api/notebooks/create` 使用 req.user.id 而非 body.userId
- [ ] 修改 `/api/notebooks/:id/restore`, `/patch`, `/delete` 添加所有权检查

#### 第三阶段：项目与会话隔离（2-3 天）

**routes/projects.ts 和 db.ts — Projects 表改造**
- [ ] 为 projects 表添加 `user_id` 列
- [ ] 修改所有 projects CRUD，按 user_id 过滤
- [ ] `/api/projects/` 只返回当前用户的项目
- [ ] 新增 `db.listProjectsByUser(userId)`

**ws-handler.ts — WebSocket 用户上下文**
- [ ] 修改 `setupWebSocket()` 从 ticket 中提取 userId
- [ ] 在 WS connection handler 中挂载 `clientUserId`
- [ ] 修改所有 case 语句，检查 `session.notebook.metadata.user_id === clientUserId`
- [ ] 修改 subscribe 之前验证：`if (notebook.user_id !== clientUserId) return error`

```typescript
// ws-handler.ts 改造示例
wss.on('connection', (ws: WebSocket, req) => {
  const ticket = url.searchParams.get('ticket');
  const { userId, expiredAt } = decodeWsTicket(ticket);  // 从 ticket 提取

  if (Date.now() >= expiredAt) {
    ws.close(4001, 'Ticket expired');
    return;
  }

  const clientUserId = userId;

  // 在消息处理中
  case 'execute_request': {
    const session = sessionManager.getSession(msg.session_id);
    if (session?.notebook.metadata.user_id !== clientUserId) {  // D2-U: User isolation
      sendToClient(ws, { error: 'Not authorized' });
      return;
    }
  }
});
```

#### 第四阶段：会话管理与迁移（2-3 天）

**session.ts — 创建会话时绑定 userId**
- [ ] 修改 `createSession()` 签名添加 `userId: string`
- [ ] 验证 notebook 的 user_id 与传入的 userId 一致
- [ ] 修改 `reconnectSession()` 同样添加 userId 参数并验证

**migration.ts — 数据迁移脚本**
- [ ] 新增 `migrateNullUserIds()` 处理现有 `user_id=null` 的 notebooks
- [ ] 策略：分配给默认用户（迁移前创建）
- [ ] 确保幂等性：已迁移记录不重复处理

#### 第五阶段：中间件与请求上下文（1-2 天）

**index.ts — 认证中间件增强**
- [ ] 修改 `authMiddleware()` 验证 JWT，提取 user_id，挂载到 `req.user`
- [ ] 添加新中间件 `requireUser()` 检查 `req.user` 存在
- [ ] 所有受保护的路由应用该中间件

```typescript
// 中间件示例
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const token = authHeader.slice(7);
  const payload = verifyUserToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.user = { id: payload.userId };
  next();
}
```

### 11.2 依赖关系图

```
第一阶段（认证）
  ├─ auth.ts (JWT化)
  ├─ db.ts (users表)
  └─ index.ts (JWT中间件)
         ↓
第二阶段（路径隔离）
  ├─ workspace.ts
  ├─ routes/notebooks.ts
  └─ workspace-files.ts
         ↓
第三阶段（项目与会话）
  ├─ routes/projects.ts
  └─ ws-handler.ts (user_id验证)
         ↓
第四阶段（迁移）
  ├─ migration.ts
  └─ 数据库迁移脚本
         ↓
第五阶段（中间件）
  └─ index.ts (增强中间件)
```

### 11.3 环境变量配置

```bash
# JWT 签名密钥（生产环境必须修改）
NB_JWT_SECRET="your-secret-key-min-32-chars"

# 默认迁移用户（legacy notebooks 的所有者）
NB_MIGRATION_DEFAULT_USER="admin"

# 密码策略
NB_PASSWORD_MIN_LENGTH=8

# Token 过期时间（秒）
NB_JWT_EXPIRY_SECONDS=86400

# 文件权限掩码
NB_WORKSPACE_UMASK="0077"
```

### 11.4 数据库迁移路线图

```
v0.5.0 (当前)
  - user_id TEXT (nullable)
  - 共享 token 认证
  ↓
v0.6.0 (第一阶段)
  - ADD users 表
  - ADD user_id NOT NULL DEFAULT ''
  - ADD FOREIGN KEY user_id → users(id)
  - 迁移脚本：migrateNullUserIds()
  - JWT 认证
  ↓
v0.7.0 (第二阶段)
  - ADD projects.user_id
  - 路径隔离加固
  - WebSocket user_id 验证
  ↓
v1.0.0 (最终)
  - 清理 user_id=null 记录（如有）
  - 所有约束转为 NOT NULL
```

---

## 12. 红绿测试与回归测试策略

### 12.1 TDD 红绿测试原则

遵循 Red/Green TDD 硬约束：
1. **Red** — 先写一个会失败的测试，明确要修复的 bug 或要实现的行为
2. **Green** — 写最少量的代码让测试通过
3. **Refactor** — 测试通过后再清理代码，保持测试绿色

### 12.2 新增测试用例清单（~50 个）

#### 认证与授权测试 (12 tests)

| 测试文件 | 描述 | TDD 阶段 |
|----------|------|----------|
| `auth-jwt-create.test.ts` | JWT 生成与过期 | Phase 1 |
| `auth-jwt-verify.test.ts` | JWT 验证与伪造检测 | Phase 1 |
| `auth-register.test.ts` | 用户注册、重复检测、密码验证 | Phase 1 |
| `auth-login-jwt.test.ts` | 登录返回 JWT | Phase 1 |
| `middleware-jwt-extract.test.ts` | 中间件提取 user_id | Phase 5 |
| `middleware-jwt-expired.test.ts` | 过期 JWT 拒绝 | Phase 5 |
| `auth-register-weak-password.test.ts` | 密码策略验证 | Phase 1 |
| `auth-rate-limit-per-user.test.ts` | 按用户限速 | Phase 1 |
| `db-users-crud.test.ts` | 用户表基础操作 | Phase 1 |
| `db-users-unique-username.test.ts` | username 唯一约束 | Phase 1 |
| `db-password-hash.test.ts` | 密码哈希存储 | Phase 1 |
| `ws-ticket-encode-user.test.ts` | ticket 编码 user_id | Phase 3 |

#### 路径隔离与数据隔离测试 (18 tests)

| 测试文件 | 描述 | TDD 阶段 |
|----------|------|----------|
| `path-isolation-cross-user.test.ts` | 跨用户路径访问拦截 | Phase 2 |
| `path-validation-realpath.test.ts` | symlink 突破防护 | Phase 2 |
| `notebooks-list-filter.test.ts` | list 端点用户过滤 | Phase 2 |
| `notebooks-create-user-bind.test.ts` | create 时绑定 user_id | Phase 2 |
| `notebooks-ownership-restore.test.ts` | restore 前检查所有权 | Phase 2 |
| `notebooks-ownership-delete.test.ts` | delete 前检查所有权 | Phase 2 |
| `notebooks-ownership-patch.test.ts` | patch 前检查所有权 | Phase 2 |
| `notebooks-workspace-isolation.test.ts` | workspace_dir 在用户目录下 | Phase 2 |
| `projects-list-filter.test.ts` | projects list 用户过滤 | Phase 3 |
| `projects-create-bind-user.test.ts` | project create 绑定 user_id | Phase 3 |
| `projects-ownership-delete.test.ts` | delete project 前检查所有权 | Phase 3 |
| `db-user-isolation-leak.test.ts` | 查询不泄露其他用户数据 | Phase 2 |
| `db-foreign-key-cascade.test.ts` | 删除用户级联删除 notebooks/projects | Phase 1 |
| `db-notebook-count-per-user.test.ts` | notebook_count 按用户统计 | Phase 2 |
| `session-user-mismatch.test.ts` | 会话创建前验证用户匹配 | Phase 4 |
| `ws-user-isolation.test.ts` | WS 跨用户订阅拦截 | Phase 3 |
| `ws-subscribe-ownership.test.ts` | subscribe 前检查所有权 | Phase 3 |
| `api-cross-user-access.test.ts` | REST API 跨用户访问拦截 | Phase 2 |

#### 迁移与数据一致性测试 (10 tests)

| 测试文件 | 描述 | TDD 阶段 |
|----------|------|----------|
| `migration-null-users.test.ts` | null user_id 转换 | Phase 4 |
| `migration-idempotent.test.ts` | 重复运行迁移 | Phase 4 |
| `migration-preserve-data.test.ts` | 迁移保留所有数据 | Phase 4 |
| `migration-orphaned-notebooks.test.ts` | 孤立 notebook 处理 | Phase 4 |
| `migration-projects-user-field.test.ts` | 为项目添加 user_id | Phase 4 |
| `migration-rollback-safety.test.ts` | 迁移失败不损坏数据 | Phase 4 |
| `db-foreign-key-integrity.test.ts` | 外键约束一致性 | Phase 1 |
| `db-user-deletion-cleanup.test.ts` | 删除用户清理关联数据 | Phase 1 |
| `migration-large-dataset.test.ts` | 大数据集迁移性能 | Phase 4 |
| `migration-concurrent-operations.test.ts` | 迁移期间并发操作安全 | Phase 4 |

#### WebSocket 与实时协议改造测试 (8 tests)

| 测试文件 | 描述 | TDD 阶段 |
|----------|------|----------|
| `ws-auth-before-subscribe.test.ts` | 订阅前认证 | Phase 3 |
| `ws-session-owner-change.test.ts` | 会话所有权转换 | Phase 3 |
| `ws-execute-user-check.test.ts` | execute 前检查用户 | Phase 3 |
| `ws-tool-result-user-check.test.ts` | tool_result 前检查用户 | Phase 3 |
| `ws-file-save-user-check.test.ts` | file-save 前检查用户 | Phase 3 |
| `ws-concurrent-users.test.ts` | 多用户并发 WebSocket | Phase 3 |
| `ws-ticket-expiry-per-user.test.ts` | ticket 过期与用户关联 | Phase 3 |
| `ws-reconnect-user-mismatch.test.ts` | 重连检查用户匹配 | Phase 4 |

#### 端到端集成测试 (5 tests)

| 测试文件 | 描述 | TDD 阶段 |
|----------|------|----------|
| `e2e-multi-user-isolation.test.ts` | 两个用户创建/执行 notebook，互不影响 | Phase 5 |
| `e2e-login-create-execute.test.ts` | 登录 → 创建 → 执行完整流程 | Phase 5 |
| `e2e-project-collaboration-isolation.test.ts` | 多用户项目隔离 | Phase 5 |
| `e2e-session-recovery-multiuser.test.ts` | 多用户会话恢复 | Phase 5 |
| `e2e-export-isolation.test.ts` | 导出不泄露其他用户数据 | Phase 5 |

### 12.3 测试用例示例

#### 示例 1：JWT 创建与验证（Red → Green）

```typescript
// packages/server/src/__tests__/auth-jwt-create.test.ts
import { describe, it, expect } from 'vitest';
import { createUserToken, verifyUserToken } from '../auth';

describe('JWT Token Management', () => {
  // Red: 先写失败的测试
  it('should create a valid JWT token for user', () => {
    const userId = 'user-123';
    const token = createUserToken(userId);

    expect(token).toBeDefined();
    expect(token.split('.')).toHaveLength(3); // header.payload.signature
  });

  it('should verify a valid token and return userId', () => {
    const userId = 'user-456';
    const token = createUserToken(userId);

    const result = verifyUserToken(token);

    expect(result).not.toBeNull();
    expect(result?.userId).toBe(userId);
  });

  it('should reject expired token', async () => {
    const userId = 'user-789';
    const token = createUserToken(userId, 1); // 1秒过期

    await new Promise(r => setTimeout(r, 1500)); // 等待过期

    const result = verifyUserToken(token);
    expect(result).toBeNull();
  });

  it('should reject tampered token', () => {
    const token = createUserToken('user-abc');
    const tamperedToken = token.slice(0, -5) + 'xxxxx'; // 篡改签名

    const result = verifyUserToken(tamperedToken);
    expect(result).toBeNull();
  });
});
```

#### 示例 2：跨用户路径隔离（Red → Green）

```typescript
// packages/server/src/__tests__/path-isolation-cross-user.test.ts
import { describe, it, expect } from 'vitest';
import { validateUserPath } from '../workspace';

describe('Cross-User Path Isolation', () => {
  const aliceId = 'alice-123';
  const bobId = 'bob-456';

  it('should allow access to own directory', () => {
    const path = `/data/users/${aliceId}/project-a/file.txt`;
    const result = validateUserPath(path, aliceId);

    expect(result.valid).toBe(true);
    expect(result.accessLevel).toBe('write');
  });

  it('should deny access to other user directory', () => {
    const path = `/data/users/${bobId}/project-a/file.txt`;
    const result = validateUserPath(path, aliceId);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Access denied');
  });

  it('should deny path traversal attack', () => {
    const path = `/data/users/${aliceId}/../${bobId}/secret.txt`;
    const result = validateUserPath(path, aliceId);

    expect(result.valid).toBe(false);
  });

  it('should allow read access to global library', () => {
    const path = '/data/library/templates/default.md';
    const result = validateUserPath(path, aliceId);

    expect(result.valid).toBe(true);
    expect(result.accessLevel).toBe('read');
  });

  it('should deny write access to global library', () => {
    const path = '/data/library/templates/default.md';
    const result = validateUserPath(path, aliceId, 'write');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('read-only');
  });
});
```

#### 示例 3：WebSocket 用户隔离（Red → Green）

```typescript
// packages/server/src/__tests__/ws-user-isolation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestWsClient, createTestUser } from './helpers';

describe('WebSocket User Isolation', () => {
  let aliceWs: WebSocket;
  let bobWs: WebSocket;
  let aliceNotebookId: string;

  beforeEach(async () => {
    // 创建两个测试用户
    const alice = await createTestUser('alice');
    const bob = await createTestUser('bob');

    // Alice 创建一个 notebook
    aliceNotebookId = await createNotebook(alice.token, 'alice-nb');

    // 建立 WebSocket 连接
    aliceWs = await setupTestWsClient(alice.token);
    bobWs = await setupTestWsClient(bob.token);
  });

  it('should allow user to subscribe to own notebook', async () => {
    const response = await aliceWs.send({
      type: 'subscribe',
      session_id: aliceNotebookId,
    });

    expect(response.type).toBe('subscribed');
  });

  it('should deny user subscribing to other user notebook', async () => {
    const response = await bobWs.send({
      type: 'subscribe',
      session_id: aliceNotebookId, // Bob 尝试订阅 Alice 的 notebook
    });

    expect(response.type).toBe('error');
    expect(response.error).toContain('Not authorized');
  });

  it('should deny cross-user execute request', async () => {
    // Bob 尝试在 Alice 的 session 中执行代码
    const response = await bobWs.send({
      type: 'execute_request',
      session_id: aliceNotebookId,
      source: 'print("hacked")',
    });

    expect(response.type).toBe('error');
    expect(response.error).toContain('Not authorized');
  });
});
```

### 12.4 回归测试策略

#### 现有测试保护

| 测试类别 | 现有数量 | 改造后检查 |
|----------|----------|-----------|
| auth 相关 | 3 | 确保不破坏现有认证逻辑 |
| db 相关 | 7 | 添加 user_id 后表操作正常 |
| session 相关 | 5 | 会话创建/恢复正常 |
| ws-handler 相关 | 10+ | 所有消息类型处理正常 |
| path validation | 5+ | 路径验证逻辑正常 |

#### 回归测试检查点

```
每个 Phase 完成后执行：

1. 运行全量测试套件
   npx vitest run

2. 检查测试通过率
   预期: 176 + 新增测试数 全部通过，零回归

3. 关键路径验证
   - 用户登录 → 创建 notebook → 执行 cell → 保存
   - 项目创建 → 添加 notebook → 跨 notebook 访问
   - WebSocket 连接 → 订阅 → 收到事件

4. 性能基准
   - 单次请求延迟 < 100ms
   - WebSocket 消息延迟 < 50ms
   - 数据库查询 < 10ms
```

### 12.5 工期估算

| 阶段 | 任务 | 测试数 | 工期 |
|------|------|--------|------|
| Phase 1 | 认证系统升级 | 12 | 3-4 天 |
| Phase 2 | 路径与工作空间隔离 | 18 | 3-4 天 |
| Phase 3 | 项目与会话隔离 | 8 | 2-3 天 |
| Phase 4 | 会话管理与迁移 | 10 | 2-3 天 |
| Phase 5 | 中间件与集成测试 | 7 | 1-2 天 |
| QA | 集成测试与回归 | - | 3-4 天 |
| **总计** | | **~55** | **14-20 天** |

---

## 13. 风险评估与缓解

| 风险 | 缓解方案 | 优先级 |
|------|---------|--------|
| JWT 密钥泄露 | 使用 .env，不入版本控制；定期轮换 | P0 |
| 迁移失败导致数据损坏 | 备份原数据库；测试幂等性；小批量迁移 | P1 |
| 路径遍历突破 | 强制 realpath 检查 + unit 测试覆盖 | P1 |
| 并发会话冲突 | 使用 session ownership 锁；测试多用户并发 | P1 |
| 跨用户数据泄露 | 每个查询加 WHERE user_id = ?；code review | P0 |
| 性能下降 | 添加索引；分页；监控 WebSocket 并发数 | P2 |

---

## 参考资料

- Apify 定价模型
- Docker cgroups v2 文档
- Linux namespaces(7) man page
- Kubernetes 多租户最佳实践
- OWASP 多租户安全指南
- JWT RFC 7519
