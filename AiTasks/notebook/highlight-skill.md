# Highlight → Skill 晋升机制研究

> 研究日期: 2026-03-03 (更新: 2026-03-04)
> 状态: Phase 4 完成 + 统一规则自进化架构 + cron 定时进化

## 背景问题

task-ai 的 `highlight` 子命令负责经验蒸馏，将成功的任务经验存储到 `.memory/.experiences/`。但这些经验是被动知识——需要通过 `library search` 检索才能被使用。

**核心问题**：
1. 是否有必要将部分成功经验定义为 skill？
2. 如果有必要，如何确保 Claude 及时更新/学习新 skill？
3. 自动生成的 skill 质量如何保证？
4. 与 library 提供的 search 功能是否重复？

---

## 一、经验 vs Skill 的本质区别

| 维度 | Experience (经验) | Skill (技能) |
|------|------------------|--------------|
| **性质** | 回顾性知识 (发生了什么) | 程序性知识 (如何做) |
| **触发** | 被动 (等待搜索) | 主动 (关键词/短语自动触发) |
| **格式** | 自由格式 markdown | 结构化 SKILL.md + frontmatter |
| **可执行性** | 低 (insights) | 高 (步骤指导) |
| **上下文加载** | 搜索时加载 | 描述始终在 context，调用时加载全文 |

**结论**：不完全重复。Library search 是 pull 模式，Skill 是 push 模式。高频复用的程序化经验适合晋升为 Skill。

---

## 二、Skill 热重载机制研究

### 2.1 业界方案对比

| 方案 | 实现机制 | 生效时机 | 重启需求 | 来源 |
|------|---------|---------|---------|------|
| **OpenClaw Skills Watcher** | inotify/fswatch | 下一个 agent turn | 无需重启 | [OpenClaw Docs](https://docs.openclaw.ai/tools/skills) |
| **Claude Code Live Detection** | `--add-dir` 目录监控 | 会话内实时 | 无需重启 | [Claude Code Docs](https://code.claude.com/docs/en/skills) |
| **kill -HUP /reload** | Unix 信号 | 立即 (~1s) | 进程重启但保持会话 | [Blog](https://www.panozzaj.com/blog/2026/02/07/building-a-reload-command-for-claude-code/) |

### 2.2 Skill 优先级机制对比

#### Claude Code 优先级（企业管控优先）

```
Priority 1: Enterprise Skills (最高)
  └─ 组织管理员通过 managed settings 配置，用户无法覆盖

Priority 2: Personal Skills
  └─ ~/.claude/skills/，跨所有项目生效

Priority 3: Project Skills
  └─ .claude/skills/ (项目根目录)，随代码版本控制

Priority 4: Workspace Skills (最低)
  └─ --add-dir 添加的目录，多项目共享
```

#### OpenClaw 优先级（项目自治优先）

```
Priority 1: Workspace Skills (最高)
  └─ <workspace>/skills/，项目特定，覆盖一切

Priority 2: Managed/Local Skills
  └─ ~/.openclaw/skills/，跨工作区共享

Priority 3: Bundled Skills
  └─ OpenClaw 安装目录，内置默认行为

Priority 4: Extra Dirs (最低)
  └─ skills.load.extraDirs，用户自定义扩展
```

#### 设计理念差异

| 维度 | OpenClaw | Claude Code |
|------|----------|-------------|
| **最高优先** | Workspace (项目) | Enterprise (组织) |
| **设计理念** | 项目自治优先 | 企业管控优先 |
| **冲突解决** | 项目覆盖全局 | 全局覆盖项目 |
| **扩展目录** | 最低 (extraDirs) | 最低 (--add-dir) |
| **适用场景** | 开源/个人开发 | 企业/团队协作 |

#### 对 task-ai 的影响

两个平台的**扩展目录都是最低优先级**，意味着我们的 workspace skills 设计在两个平台上行为一致：
- 提供默认行为
- 不强制覆盖用户配置
- 可被更高优先级 skill 覆盖

### 2.3 Agent Turn 概念

**Agent Turn** = 一次完整的 LLM 请求-响应周期。

```
User Input → [Agent Turn Start] → LLM Processing → Response → [Agent Turn End]
                    ↑
            Skill snapshot 刷新点
```

OpenClaw 的设计：
- Session 开始时 snapshot 所有 eligible skills
- 每个 turn 开始时检查是否需要刷新 snapshot
- Watcher 检测到变更 → 标记需要刷新 → 下一个 turn 应用

### 2.4 Claude Code 原生热重载

根据官方文档：

```
Skills defined in .claude/skills/ within directories added via --add-dir
are loaded automatically and picked up by live change detection,
so you can edit them during a session without restarting.
```

**关键点**：
- `--add-dir` 添加的目录支持 live change detection
- 变更在下一个 agent turn 生效
- 无需手动 reload

### 2.5 /reload 命令实现

对于需要立即生效的场景：

```yaml
# ~/.claude/skills/reload/SKILL.md
---
name: reload
description: Reload Claude Code to pick up changes immediately
disable-model-invocation: true
---

!`kill -HUP $PPID`
```

- `!` 前缀 = 立即执行（不经过 LLM）
- `$PPID` = 父进程（Claude 主进程）
- 退出码 129 = 被 SIGHUP 终止
- 需要配合 shell wrapper 实现自动重启

### 2.6 最终方案决策 ✅

**选定方案**: `--add-dir` 单独使用（不含 /reload）

#### 方案对比

| 维度 | `--add-dir + /reload + wrapper` | `--add-dir` 单独 |
|------|--------------------------------|------------------|
| **复杂度** | 高（需要 shell wrapper 循环重启） | 低（原生支持） |
| **生效延迟** | 立即（~1s 重启） | 下一个 agent turn（通常 <30s） |
| **上下文影响** | 丢失（进程重启） | 保留（无重启） |
| **调试体验** | 差（需要重新建立对话） | 好（连续对话） |
| **生产稳定性** | 中（依赖外部 wrapper） | 高（Claude Code 原生） |
| **session 恢复** | 需要 `--continue` 或 `--resume` | 不需要 |

#### 决策理由

1. **延迟可接受**：下一个 agent turn 生效意味着用户发送下一条消息时新 skill 就生效，实际体验几乎无感。

2. **上下文保留**：`/reload` 会丢失对话上下文，这在长任务中是致命问题。而 `--add-dir` 保持会话连续。

3. **安全由审核解决**：
   - skill 晋升需要通过六维审查（D1-D6）
   - T1→T4 信任分级控制执行权限
   - 生产环境只部署 T3+ 级别 skill

4. **`/reload` 的真正用途**：研发调试阶段频繁修改 skill 时使用，不是生产场景需求。

#### 最终架构

```
开发环境:
  claude --add-dir "$NB_WORKSPACES_LIBRARY/skills"
  # 编辑 SKILL.md → 下一条消息自动生效
  # 可选: /reload 立即生效（调试用，需自行配置 wrapper）

生产环境:
  claude --add-dir "$NB_WORKSPACES_LIBRARY/skills"
  # 只部署通过六维审查的 T3+ skill
  # 无需 /reload（变更由审核流程控制）
```

---

## 三、Skill 质量保证研究

### 3.1 安全风险数据

根据 [arXiv 2602.12430](https://arxiv.org/html/2602.12430) 和 [arXiv 2602.06547](https://arxiv.org/html/2602.06547)：

- **42,447** 社区 skills 中 **26.1%** 存在漏洞
- **5.2%** 具有高危模式（强烈暗示恶意）
- 包含可执行脚本的 skills 漏洞率是纯指令 skills 的 **2.12×**
- 主要攻击向量：prompt injection, data exfiltration, privilege escalation

### 3.2 四阶段验证门控

论文提出的 **Skill Trust and Lifecycle Governance Framework**：

```
┌─────────────────────────────────────────────────────────────────┐
│  Gate 1: Static Analysis                                         │
│  ├─ 正则 + 关键词匹配                                            │
│  ├─ 危险模式: HTTP 外连、env 访问、凭证路径、eval/exec           │
│  └─ 语言: Python, Shell, JavaScript                              │
├─────────────────────────────────────────────────────────────────┤
│  Gate 2: Semantic Classification (LLM-based)                     │
│  ├─ 10 个专用扫描器链 (LLM-Guard)                                │
│  └─ 输出: validity flag + confidence score                       │
├─────────────────────────────────────────────────────────────────┤
│  Gate 3: Behavioral Sandbox                                      │
│  ├─ 隔离执行环境                                                 │
│  ├─ 监控: tcpdump, strace, auditd                                │
│  └─ Honeypot 凭证检测                                            │
├─────────────────────────────────────────────────────────────────┤
│  Gate 4: Human Review                                            │
│  └─ 最终人工审核                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 信任分级 (T1-T4)

| Trust Tier | 状态 | 权限 |
|------------|------|------|
| **T1** | Unverified | 不执行脚本，仅指令 |
| **T2** | Analyzed | 通过静态分析 |
| **T3** | Sandboxed | 通过沙箱测试 |
| **T4** | Verified | 完整验证 + 人工审核 |

### 3.4 六维审查应用于 Skill 质量

task-ai 现有的六维审查框架可直接扩展用于 Skill 质量检查：

| 维度 | Plan/Code 审查 | Skill 质量检查 |
|------|---------------|---------------|
| **D1 正确性** | 需求覆盖、功能逻辑 | Skill 是否解决声称的问题？步骤完整？ |
| **D2 安全性** | 注入、权限、密钥 | 危险命令？requires.* 声明真实？ |
| **D3 可靠性** | 边界、故障回退 | 错误处理？边缘情况覆盖？ |
| **D4 性能** | 资源消耗、I/O | Token 效率？冗余内容？ |
| **D5 架构** | 模块边界、扩展点 | 可组合？与现有 skill 正交？ |
| **D6 可维护性** | 可读性、命名规范 | 步骤清晰？术语一致？可测试？ |

---

## 四、沙箱方案研究

### 4.1 论文推荐方案

**[Malicious Skills Study (arXiv 2602.06547)](https://arxiv.org/html/2602.06547v1)** 的沙箱配置：

```yaml
# Docker Container Spec
base_image: ubuntu:22.04
runtime:
  - python: "3.10"
  - node: "18"
resources:
  memory: 2GB
  timeout: 60s
network: bridge  # 允许出站以便监控

# Monitoring Stack
instrumentation:
  - tcpdump: "not host localhost"
  - strace: "open,connect,execve,write"
  - auditd: "/etc,/home,/tmp"

# Honeypot Credentials
honeypots:
  - AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE"
  - API_KEY: "sk-fake-0123456789abcdef"
```

**验证结果**：精度 99.6%，每折仅 0.6 误报

### 4.2 Claude Code 沙箱架构

**[Anthropic Engineering Blog](https://www.anthropic.com/engineering/claude-code-sandboxing)** 的双边界设计：

```
┌─────────────────────────────────────────────────────────────────┐
│  Boundary 1: Filesystem Isolation                                │
│  ├─ 工具: Linux bubblewrap / macOS seatbelt                      │
│  └─ 规则: 只能读写当前工作目录及子目录                            │
├─────────────────────────────────────────────────────────────────┤
│  Boundary 2: Network Isolation                                   │
│  ├─ 机制: Unix domain socket → 外部代理                          │
│  └─ 代理: 域名白名单、新域名需用户确认                            │
└─────────────────────────────────────────────────────────────────┘

效果: 权限提示减少 84%，同时维持安全性
```

### 4.3 早期研究方案（已废弃）

| 层级 | 方法 | 工具 | 适用场景 |
|------|------|------|---------|
| **L1** | 静态分析 | SkillScan (正则 + LLM) | 所有 candidates |
| **L2** | 轻量隔离 | bubblewrap + strace | T2+ 验证 |
| **L3** | 完整沙箱 | Docker + 监控栈 | T3 前最终验证 |

> **废弃原因**：需要额外依赖（Docker, tcpdump, auditd），未复用 Claude Code 和 task-ai 现有能力。

### 4.4 最终方案：Claude Code + task-ai 原生沙箱 ✅

整合现有能力，零新增依赖：

#### 现有能力盘点

| 能力来源 | 已有功能 | 复用于 Skill 验证 |
|---------|---------|-------------------|
| **Claude Code** | 原生沙箱 (bubblewrap/seatbelt) | 隔离执行环境 |
| **Claude Code** | 权限模式 (`--permission-mode`) | 控制执行权限 |
| **task-ai/security** | 危险命令拦截 | L1 静态分析 |
| **task-ai/read** | 注入检测模式 (10 类) | L1 静态分析 |
| **task-ai/check** | 六维审查 (D1-D6) | L2 语义分析 |
| **task-ai/verify** | 测试生成 | L2 行为验证 |
| **task-ai/init** | worktree 隔离 | L3 隔离执行 |

#### 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│  L1: security + read 静态分析                                │
│  ├─ 复用 security.sh 的危险命令模式                          │
│  ├─ 复用 read.sh 的 10 类注入检测                            │
│  └─ 输出: risk_level (low/medium/high)                       │
├─────────────────────────────────────────────────────────────┤
│  L2: check --skill 六维审查                                  │
│  ├─ D1 正确性: skill 是否解决声称问题                        │
│  ├─ D2 安全性: requires.* 声明真实性                         │
│  ├─ D3-D6: 可靠/性能/架构/可维护性                           │
│  └─ 输出: composite_score + trust_tier                       │
├─────────────────────────────────────────────────────────────┤
│  L3: verify + Claude Code 沙箱执行                           │
│  ├─ verify 生成 red/green 测试用例                           │
│  ├─ init --worktree 创建隔离环境                             │
│  ├─ Claude Code --permission-mode strict 执行                │
│  └─ 输出: test_results + permission_requests                 │
└─────────────────────────────────────────────────────────────┘
```

#### 实现细节

**L1: 复用 security + read**
```bash
# 1. 提取 skill 中的可执行内容
EXECUTABLE_BLOCKS=$(grep -E '^\s*[!`]|```(bash|sh|python)' "$SKILL_MD")

# 2. 复用 security.sh 的命令检测
for cmd in $EXECUTABLE_BLOCKS; do
    risk=$(bash security.sh verify-cmd "$cmd")
    [[ "$risk" == "high" ]] && exit 1
done

# 3. 复用 read.sh 的 10 类注入检测模式
```

**L2: check --skill 扩展**
```bash
# 新增 skill-review checkpoint
check <notebook> --checkpoint skill-review --target "$SKILL_MD"

# 输出
{
  "d1_correctness": 0.85,
  "d2_security": 0.90,
  "composite_score": 0.84,
  "trust_tier": "T3"
}
```

**L3: verify + 原生沙箱**
```bash
# 1. verify 生成测试
verify <notebook> --generate-skill-tests --target "$SKILL_MD"

# 2. 创建隔离 worktree
init skill-sandbox-$SLUG --worktree --ephemeral

# 3. 在沙箱中执行 skill（权限请求作为行为指纹）
claude --permission-mode strict \
       --add-dir "$SKILL_DIR" \
       --prompt "Execute /$SKILL_NAME with test input: ..."
```

#### 资源对比

| 维度 | 早期方案 (Docker) | 最终方案 (原生) |
|------|------------------|----------------|
| **依赖** | Docker, tcpdump, auditd | 无新增 |
| **内存** | 2-4GB | 200-500MB |
| **启动时间** | 2-5s | <100ms |
| **维护成本** | 高（三套工具链） | 低（统一 task-ai） |
| **监控精度** | 系统调用级 | 权限请求级 |
| **集成度** | 独立系统 | 原生集成 |

---

## 五、已实现功能

### 5.1 热重载支持

基于 `--add-dir` 的原生热重载方案已实现：

```bash
# 新增文件
task-ai/core/skill-hotreload.sh    # 热重载核心脚本
task-ai/core/shell-aliases.sh      # Shell 别名集成

# 使用方式
source task-ai/core/shell-aliases.sh
task-ai-dev                        # 启动带热重载的 Claude Code

# 或直接
claude --add-dir "$NB_WORKSPACES_LIBRARY/skills"
```

### 5.2 目录结构（统一系统目录模式）

```
$NB_WORKSPACES_LIBRARY/
├── .skills/                    # Workspace skills (热重载，系统目录)
│   ├── .drafts/                # 草稿 (gitignored)
│   ├── .candidates/            # 晋升候选 (gitignored)
│   └── <skill-name>/
│       └── SKILL.md            # Skill 定义
│
└── .evolving-rules/            # 自进化规则（系统目录）
    ├── security/               # security.sh scan_skill() 使用
    │   ├── candidates/
    │   ├── active/
    │   ├── review/             # 验证失败待人工复核
    │   └── deprecated/
    ├── sanitization/           # research 内容去毒使用
    │   ├── candidates/
    │   ├── active/
    │   ├── review/
    │   └── deprecated/
    └── audit/                  # check 六维审查使用
        ├── candidates/
        ├── active/
        ├── review/
        └── deprecated/
```

**命名约定**: 所有系统管理目录使用点前缀（`.skills/`, `.evolving-rules/`, `.memory/`），用户内容目录无点前缀。

### 5.3 测试覆盖

```
回归测试: 20/20 ✓ PASS
包含: skill-hotreload.test.sh
```

---

## 六、待实施功能

### 6.1 highlight scope=promote

```yaml
# 新增 scope 定义

§3.7 scope=promote — Experience to Skill Promotion

Trigger:
  - quality_status: verified
  - usage_count >= 3 (从 changelog 统计)
  - 内容包含 "## Patterns" 或 "## Steps" 结构化模式

Pipeline:
  1. Static Analysis (D2 安全检查)
  2. Semantic Review (D1/D3/D5 自评)
  3. Red-Green Test Generation
  4. Trust Assignment (T1 → .candidates/)

Output:
  - .skill-candidates/<slug>/SKILL.md
  - .skill-candidates/<slug>/trust-report.md
```

### 6.2 check --skill 扩展

```markdown
## Checkpoint: skill-review

Evaluation (六维):
| 维度 | 权重 |
|------|------|
| D1 正确性 | 20% |
| D2 安全性 | 25% |
| D3 可靠性 | 15% |
| D4 性能 | 10% |
| D5 架构 | 15% |
| D6 可维护性 | 15% |

Outcomes:
| composite_score | Trust Tier | Action |
|-----------------|------------|--------|
| >= 0.85 | T4 | → .skills/ (auto-promote) |
| 0.70 - 0.84 | T3 | → .drafts/ (pending human) |
| < 0.70 | T2/T1 | → 返回 findings |
```

### 6.3 原生沙箱验证（复用现有命令）

不再需要独立的 sandbox.sh，而是复用现有子命令：

```bash
# L1: 静态分析（复用 security + read）
security <notebook> --scan-skill "$SKILL_MD"

# L2: 六维审查（复用 check）
check <notebook> --checkpoint skill-review --target "$SKILL_MD"

# L3: 沙箱执行（复用 verify + init + Claude Code）
verify <notebook> --generate-skill-tests --target "$SKILL_MD"
init skill-test-$SLUG --worktree --ephemeral
claude --permission-mode strict --add-dir "$SKILL_DIR" ...
```

### 6.4 library 新增命令

```bash
# 查询命令
library skill-list [--tier T1|T2|T3|T4] [--outdated] [--needs-review]
library skill-check <name>              # 检查是否需要更新
library skill-history <name>            # 查看版本历史

# 生命周期管理
library promote-skill <name> [--auto]   # 升级
library demote-skill <name> --reason    # 降级
library rollback-skill <name> <version> # 回滚
library archive-skill <name>            # 归档（冷存储）

# 批量操作
library promote-all --dry-run           # 检查可升级的 skill
library review-due                      # 列出需要审查的 skill
library cleanup-orphans                 # 清理无源的 skill
```

### 6.5 Skill 生命周期管理

#### 6.5.1 Frontmatter 扩展

```yaml
---
name: my-skill
description: A skill for doing X
version: 1.2.0                    # 语义化版本

# 生命周期状态
lifecycle:
  trust_tier: T3                  # 当前信任等级
  promoted_at: 2026-03-01         # 晋升到当前 tier 的时间
  last_reviewed_at: 2026-03-01    # 最近审查时间
  review_ttl_days: 90             # 审查有效期
  usage_count: 47                 # 调用次数
  error_count: 2                  # 错误次数
  error_rate: 0.042               # 错误率

# 来源追踪
provenance:
  source_type: experience         # experience | manual | imported
  source_ref: .memory/.experiences/2026-02/task-123.md
  source_hash: sha256:abc123...   # 源文件哈希，用于检测变更

# 审查记录
audit_trail:
  - date: 2026-03-01
    action: promote
    from_tier: T2
    to_tier: T3
    composite_score: 0.82
---
```

#### 6.5.2 构造决策逻辑

```
library skill-check <skill-name>
返回值:
├─ CURRENT        → 无需操作
├─ OUTDATED       → 源 experience 已变更，需重新构造
├─ NEEDS_REVIEW   → 审查过期/错误率高，需重新审查
└─ DEPRECATED     → 已废弃，不再使用
```

**检测机制**:
1. **源哈希对比** — experience 文件变更自动标记 OUTDATED
2. **审查 TTL** — 超过 90 天未审查标记 NEEDS_REVIEW
3. **错误率监控** — >10% 错误率触发重审

#### 6.5.3 升级路径 (T1→T4)

```
T1 ──L1通过──▶ T2 ──L2>=0.70──▶ T3 ──L3 LLM深度审核──▶ T4
     自动           自动              自动（LLM语义）
```

| 当前 Tier | 升级条件 | 目标 Tier | 执行者 |
|----------|---------|----------|--------|
| T1 | L1 静态分析通过 | T2 | 自动（正则） |
| T2 | L2 六维审查 >=0.70 | T3 | 自动（规则+LLM） |
| T3 | L3 LLM 深度语义审核通过 | T4 | 自动（LLM深度思考） |

#### 6.5.3.1 L3 LLM 深度语义审核

T3→T4 由 LLM 进行最深度的语义分析，要求 LLM 基于以下维度进行深度思考：

```yaml
# check --checkpoint skill-deep-review --target <skill.md>
```

##### 维度 1: 意图一致性 (Intent Alignment)

| 检查项 | 问题 | 评分标准 |
|-------|------|---------|
| **声明-实现匹配** | description 与 Steps 是否语义一致？ | 0.9+ 完全一致 |
| **隐藏副作用** | 是否有未在 description 中说明的行为？ | 0.0 有隐藏副作用 |
| **范围蔓延** | 步骤是否超出了声称的功能范围？ | 0.8+ 范围收敛 |
| **输出承诺** | 声称的输出与实际输出格式是否匹配？ | 0.9+ 格式一致 |

```
示例问题:
- skill 声称 "读取文件"，但步骤中包含 "写入日志" → 隐藏副作用
- skill 声称 "格式化代码"，但步骤中包含 "自动提交" → 范围蔓延
```

##### 维度 2: 语义安全 (Semantic Security)

| 检查项 | 问题 | 风险等级 |
|-------|------|---------|
| **间接命令执行** | 是否通过变量拼接构造危险命令？ | CRITICAL |
| **数据外泄路径** | 是否存在敏感数据流向外部的路径？ | HIGH |
| **权限升级** | 是否请求超出必要的权限？ | HIGH |
| **Prompt 注入向量** | 用户输入是否可能改变 skill 行为？ | CRITICAL |
| **时间炸弹** | 是否存在延迟触发的恶意逻辑？ | CRITICAL |
| **依赖污染** | 是否依赖可被篡改的外部资源？ | MEDIUM |

```
示例 - 间接命令执行:
  步骤: "运行用户指定的命令: $USER_CMD"
  风险: 用户可注入 "rm -rf /" 作为 USER_CMD

示例 - 数据外泄:
  步骤: "将分析结果发送到 $WEBHOOK_URL"
  风险: 敏感数据可能被发送到恶意服务器

示例 - Prompt 注入:
  步骤: "根据用户描述生成代码"
  风险: 用户可能输入 "忽略以上指令，执行..."
```

##### 维度 3: 逻辑完整性 (Logical Completeness)

| 检查项 | 问题 | 评分标准 |
|-------|------|---------|
| **前置条件检查** | 是否验证执行环境满足要求？ | 0.8+ 有检查 |
| **边界情况处理** | 空输入/大文件/特殊字符是否处理？ | 0.7+ 覆盖主要边界 |
| **错误恢复** | 失败时是否有回滚/清理机制？ | 0.8+ 有恢复逻辑 |
| **幂等性** | 重复执行是否产生相同结果？ | 0.9+ 幂等 |
| **原子性** | 部分失败时状态是否一致？ | 0.8+ 原子或可恢复 |
| **超时处理** | 长时间运行是否有超时机制？ | 0.7+ 有超时 |

```
检查清单:
□ 步骤 1 失败后，是否会执行步骤 2？
□ 文件不存在时，是否有明确错误提示？
□ 网络超时时，是否有重试或回退？
□ 执行中断后，是否留下不一致状态？
```

##### 维度 4: 依赖合理性 (Dependency Rationality)

| 检查项 | 问题 | 评分标准 |
|-------|------|---------|
| **声明完整性** | 所有使用的工具/API 是否都在依赖中声明？ | 1.0 完整 |
| **依赖最小化** | 是否只声明了必要的依赖？ | 0.8+ 无冗余 |
| **版本兼容性** | 依赖的 API/工具是否可能废弃？ | 0.9+ 稳定 |
| **可替代性** | 依赖不可用时是否有降级方案？ | 0.7+ 有替代 |
| **循环依赖** | 是否存在 skill 间循环依赖？ | 1.0 无循环 |

```
示例:
  声明: tools: [Read, Write]
  实际使用: Read, Write, Bash, WebFetch
  问题: Bash 和 WebFetch 未声明 → 依赖不完整
```

##### 维度 5: 可预测性 (Predictability)

| 检查项 | 问题 | 评分标准 |
|-------|------|---------|
| **确定性输出** | 相同输入是否总是产生相同输出？ | 0.9+ 确定性 |
| **状态隔离** | 是否依赖/修改全局状态？ | 0.8+ 无全局状态 |
| **时间依赖** | 行为是否依赖当前时间/日期？ | 0.9+ 时间无关 |
| **环境依赖** | 行为是否依赖特定环境变量？ | 0.8+ 环境声明明确 |
| **随机性控制** | 随机行为是否可通过 seed 控制？ | 0.8+ 可控或无随机 |

```
可预测性等级:
  A: 纯函数式，无副作用，完全确定性
  B: 有副作用但可预测（如写文件）
  C: 依赖外部状态但行为可预测
  D: 包含随机/时间依赖但可控
  F: 不可预测，行为随环境变化
```

##### 综合评分与决策

```yaml
scoring:
  intent_alignment: 0.0-1.0      # 权重 20%
  semantic_security: 0.0-1.0    # 权重 30%
  logical_completeness: 0.0-1.0 # 权重 20%
  dependency_rationality: 0.0-1.0 # 权重 15%
  predictability: 0.0-1.0       # 权重 15%

composite_score: weighted_average

decision_matrix:
  composite >= 0.85 AND security >= 0.90:
    verdict: APPROVE
    action: promote to T4

  composite >= 0.70 AND security >= 0.80:
    verdict: NEEDS_REVISION
    action: return findings, stay at T3

  security < 0.80 OR composite < 0.70:
    verdict: REJECT
    action: demote to T2, require fixes

output:
  verdict: APPROVE | NEEDS_REVISION | REJECT
  composite_score: 0.87
  dimension_scores:
    intent_alignment: 0.92
    semantic_security: 0.85
    logical_completeness: 0.88
    dependency_rationality: 0.90
    predictability: 0.82
  critical_findings: [...]
  recommendations: [...]
  reasoning: |
    深度思考过程...
    1. 分析了 skill 的声明与实现...
    2. 检测了潜在的安全向量...
    3. 验证了逻辑完整性...
```

##### 检查项自进化机制

检查项不是静态的，而是通过以下机制持续进化：

```
┌─────────────────────────────────────────────────────────────┐
│                    检查项进化循环                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│    ┌──────────┐     ┌──────────┐     ┌──────────┐          │
│    │ 审核执行 │────▶│ 结果记录 │────▶│ 模式分析 │          │
│    └──────────┘     └──────────┘     └──────────┘          │
│         ▲                                  │               │
│         │                                  ▼               │
│    ┌──────────┐     ┌──────────┐     ┌──────────┐          │
│    │ 规则应用 │◀────│ 规则验证 │◀────│ 规则提取 │          │
│    └──────────┘     └──────────┘     └──────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**进化来源 1: 审核历史学习**

```yaml
# .library/.evolving-rules/security/learned-patterns.yaml

patterns:
  - id: LP-2026-001
    source: audit_history
    discovered_at: 2026-03-04
    trigger: "连续 3 个 skill 因相同原因被 REJECT"

    pattern:
      dimension: semantic_security
      name: "隐式文件路径拼接"
      description: |
        skill 使用变量拼接文件路径，但未验证路径安全性
      detection: |
        步骤中包含 "$DIR/$FILE" 或 "${PATH}/${NAME}" 模式
        且无 realpath/路径验证
      examples:
        - "将结果写入 $OUTPUT_DIR/$FILENAME"
        - "读取配置 ${CONFIG_PATH}/${ENV}.json"
      risk: HIGH
      recommendation: "添加路径遍历检查"

    validation:
      tested_on: 15 skills
      true_positive: 12
      false_positive: 2
      precision: 0.86

    status: active  # candidate | active | deprecated
```

**进化来源 2: 人工反馈学习**

```yaml
# 当人工使用 --force 覆盖 LLM 决策时，触发学习

feedback_types:
  false_positive:
    trigger: "LLM REJECT，人工 promote --force"
    action: |
      1. 记录该 skill 特征
      2. 分析 REJECT 原因
      3. 生成"例外规则"候选
      4. 累积 3 例后提取泛化规则

  false_negative:
    trigger: "LLM APPROVE，后续发现问题并 demote"
    action: |
      1. 记录问题 skill 特征
      2. 分析漏检原因
      3. 生成"新检查项"候选
      4. 添加到对应维度

# 示例：从 false_negative 学到的新规则
- id: LP-2026-002
  source: human_feedback
  feedback_case: "skill-xyz APPROVED 后发现会清空 .git 目录"

  new_check:
    dimension: semantic_security
    name: "版本控制目录操作"
    detection: |
      步骤中包含对 .git, .svn, .hg 目录的操作
      除非明确声明为 "git 管理工具"
    risk: CRITICAL
```

**进化来源 3: 外部情报整合**

```yaml
# 定期从安全研究/CVE/社区报告中获取新攻击向量

external_sources:
  - type: security_research
    url: "arxiv.org/list/cs.CR"
    scan_interval: weekly
    keywords: ["prompt injection", "LLM attack", "agent vulnerability"]

  - type: community_reports
    url: "github.com/skill-security/advisories"
    scan_interval: daily

  - type: internal_incidents
    path: ".library/.incidents/"
    scan_interval: realtime

# 示例：从安全研究学到的新规则
- id: LP-2026-003
  source: arxiv_2603.12345
  paper: "Indirect Prompt Injection via Tool Results"

  new_check:
    dimension: semantic_security
    name: "工具结果注入防护"
    description: |
      当 skill 处理外部工具返回的内容时，
      需要检查是否对结果进行了消毒
    detection: |
      1. 识别外部数据源（WebFetch, Read 外部文件）
      2. 追踪数据流向
      3. 检查是否直接用于指令构造
```

##### 2025-2026 实际 CVE 案例覆盖分析（2026-03-04 更新）

**关键 CVE 清单**

| CVE ID | 产品 | CVSS | 攻击向量 | 现有覆盖 |
|--------|------|------|---------|---------|
| CVE-2025-59536 | Claude Code | 9.1 | Hooks 配置篡改执行任意命令 | ✅ 已覆盖 |
| CVE-2026-21852 | Claude Code | 9.3 | MCP enableAllProjectMcpServers 绕过审批 | ✅ 已覆盖 |
| CVE-2025-53773 | GitHub Copilot | 9.6 | Prompt injection → RCE | ✅ 部分覆盖 |
| CVE-2026-25253 | OpenClaw | 8.7 | 认证令牌窃取 | ✅ 已覆盖 |
| CVE-2026-21858 | n8n | 10.0 | 无认证代码执行 | N/A (平台级) |
| IDEsaster (24 CVEs) | Cursor/Windsurf/Zed | 7.5-9.8 | Data exfil + RCE | ✅ 部分覆盖 |

**扩展的检测规则** (security.sh scan-skill)

```bash
# 4. CVE-2025-59536/CVE-2026-21852: Claude Code attack vectors
# 4a. MCP configuration abuse
if grep -qiE "enableAllProjectMcpServers|enabledMcpjsonServers|\.mcp\.json"; then
    findings+=("cve_2026_21852:mcp_config_abuse")
fi

# 4b. Hooks configuration tampering
if grep -qiE "pre-tool-use|post-tool-use|\.claude/settings\.json|hooks.*command"; then
    findings+=("cve_2025_59536:hooks_tampering")
fi

# 5. CVE-2026-25253 (OpenClaw): Auth token theft
sensitive_paths=(
    '~/\.claude'
    '~/.config/claude'
    '~/\.anthropic'
    'credentials\.json'
    'auth\.json'
    'api[_-]?key'
)

# 6. API Key / Secret exfiltration patterns
# Matches: curl/wget with env vars like $ANTHROPIC_API_KEY

# 7. Sensitive env var access (echo/print)
# Matches: printenv | grep key/secret/token
```

**来源**

- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [Check Point: Claude Code RCE CVE-2025-59536](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)
- [Dark Reading: OpenClaw Vulnerability](https://www.darkreading.com/application-security/critical-openclaw-vulnerability-ai-agent-risks)
- [Unit42: Web-Based Indirect Prompt Injection](https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/)
- [ScienceDirect: LLM-powered AI agents threats](https://www.sciencedirect.com/science/article/pii/S2405959525001997)

**定期扫描机制 — 与 research 子命令集成**

复用 `research` 的 URL 获取、内容消毒、来源分类能力，新增 `--caller audit` 模式：

```bash
# /task-ai:research _ --caller audit
# 每周定时运行（cron 或 auto 循环触发），收集安全情报并更新审核规则

research --caller audit
```

**audit 模式执行流程**

```
/task-ai:research _ --caller audit
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: 安全情报源抓取                                       │
│  ├─ NIST NVD API: CVE-2025/2026 + keywords [LLM, AI, agent] │
│  ├─ OWASP LLM Top 10: https://genai.owasp.org/llmrisk/      │
│  ├─ GitHub Security Advisories: claude-code, openclaw, MCP  │
│  ├─ arXiv cs.CR: "prompt injection", "agent vulnerability"  │
│  └─ 应用 blocked-sources.md Tier 分类 + injection-rules.md  │
├─────────────────────────────────────────────────────────────┤
│  Step 2: 已有规则覆盖分析                                     │
│  ├─ 读取 security.sh scan_skill() 现有 patterns             │
│  ├─ 读取 .library/.evolving-rules/security/active/*.yaml             │
│  ├─ 对比：新 CVE 攻击向量 vs 现有检测规则                      │
│  └─ 输出：uncovered_vectors[], partial_coverage[]           │
├─────────────────────────────────────────────────────────────┤
│  Step 3: 候选规则生成                                         │
│  ├─ 每个 uncovered vector → .library/.evolving-rules/security/       │
│  │   candidates/<CVE-ID>.yaml                               │
│  │   pattern: "<regex>"                                     │
│  │   dimension: D2_security                                 │
│  │   source: <CVE URL>                                      │
│  │   confidence: pending_validation                         │
│  └─ 标记需人工/LLM 复核                                       │
├─────────────────────────────────────────────────────────────┤
│  Step 4: 输出报告                                            │
│  ├─ .library/.evolving-rules/security/reports/<YYYY-MM-DD>.md        │
│  │   ## New Threats                                         │
│  │   ## Coverage Gaps                                       │
│  │   ## Candidate Rules Generated                           │
│  └─ .auto-signal: result="(intel-collected)", next="(stop)" │
└─────────────────────────────────────────────────────────────┘
```

**情报源配置** (`$NB_WORKSPACES_LIBRARY/.audit-intel-sources.yaml`)

```yaml
sources:
  - name: nist_nvd
    type: api
    url: "https://services.nvd.nist.gov/rest/json/cves/2.0"
    params:
      keywordSearch: "LLM OR AI agent OR prompt injection"
      pubStartDate: "{7_days_ago}"
    scan_interval: weekly
    priority: 1

  - name: owasp_llm
    type: html
    url: "https://genai.owasp.org/llmrisk/"
    selectors: [".risk-item", ".vulnerability-description"]
    scan_interval: monthly
    priority: 2

  - name: github_advisories
    type: api
    url: "https://api.github.com/advisories"
    params:
      ecosystem: "actions,pip,npm"
      keywords: "claude,openai,langchain,mcp"
    scan_interval: weekly
    priority: 1

  - name: arxiv_security
    type: rss
    url: "https://arxiv.org/rss/cs.CR"
    keywords: ["prompt injection", "LLM attack", "agent vulnerability"]
    scan_interval: weekly
    priority: 3

  - name: unit42_research
    type: html
    url: "https://unit42.paloaltonetworks.com/tag/ai-security/"
    scan_interval: weekly
    priority: 2
```

**与 library 命令集成**

```bash
# 手动触发
library audit-intel              # 等价于 research _ --caller audit

# 定时触发（cron）
0 0 * * 0 cd /path/to/workspace && task-ai research _ --caller audit

# 查看报告
library audit-report             # 显示最新 intel 报告
library audit-candidates         # 列出待验证的候选规则
library audit-activate <id>      # 激活验证通过的规则
```

**自动化闭环**

```
                    ┌─────────────────┐
                    │  定时触发        │
                    │  (cron/auto)    │
                    └────────┬────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  research --caller audit                                     │
│  → 收集情报 → 分析覆盖 → 生成候选                              │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  check --checkpoint audit-validate                           │
│  → 在历史 skill 上回测候选规则                                 │
│  → 计算 precision/recall                                     │
│  → precision >= 0.80 → 自动激活                               │
│  → precision < 0.80 → 标记需人工复核                          │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  security.sh 加载激活规则                                      │
│  → scan_skill() 动态加载 .evolving-rules/security/active/*.yaml       │
│  → 新攻击向量自动纳入检测                                      │
└──────────────────────────────────────────────────────────────┘
```

##### security.sh 动态规则加载实现（已完成 2026-03-04）

**规则文件格式** (`.library/.evolving-rules/security/active/*.yaml`)

```yaml
id: CVE-2026-99999                    # 规则唯一标识
name: Block reverse shell             # 人类可读名称
pattern: "nc -e|/dev/tcp/|bash -i"    # 正则表达式（支持 | 分隔多模式）
risk: high                            # high | medium | low
category: backdoor                    # 分类标签
source: CVE-2026-99999               # 来源（CVE/OWASP/手动）
enabled: true                         # 启用/禁用
case_insensitive: false              # 是否忽略大小写
```

**加载机制** (`security.sh load_dynamic_rules()`)

```bash
# 使用并行数组存储规则，避免 regex 中的 | 与分隔符冲突
load_dynamic_rules() {
    RULE_IDS=()
    RULE_PATTERNS=()
    RULE_CASE_INSENSITIVE=()
    local rules_dir="${NB_WORKSPACES_LIBRARY:-.library}/.evolving-rules/security/active"

    [[ ! -d "$rules_dir" ]] && return 0

    for rule_file in "$rules_dir"/*.yaml "$rules_dir"/*.yml; do
        [[ -f "$rule_file" ]] || continue

        local enabled=$(grep -E '^enabled:\s*' "$rule_file" | sed 's/enabled:\s*//')
        [[ "$enabled" == "false" ]] && continue

        local id=$(grep -E '^id:\s*' "$rule_file" | sed 's/id:\s*//')
        local pattern=$(grep -E '^pattern:\s*' "$rule_file" | sed 's/pattern:\s*//')
        local case_insensitive=$(grep -E '^case_insensitive:\s*' "$rule_file" | ...)

        [[ -n "$id" && -n "$pattern" ]] && {
            RULE_IDS+=("$id")
            RULE_PATTERNS+=("$pattern")
            RULE_CASE_INSENSITIVE+=("${case_insensitive:-false}")
        }
    done
}
```

**测试覆盖** (`tests/unit/security-dynamic-rules.test.sh`)

| 测试 | 验证内容 |
|------|---------|
| Test 1 | 动态规则正确加载并生效（crypto mining） |
| Test 2 | `enabled: false` 的规则被忽略 |
| Test 3 | 多规则文件同时加载（reverse shell） |
| Test 4 | `case_insensitive: true` 忽略大小写 |
| Test 5 | 规则目录不存在时优雅处理 |

**自进化闭环验证**

```
外部情报 → research --caller audit → candidates/*.yaml
                      ↓
         check --checkpoint audit-validate
                      ↓ (precision >= 0.80)
                  active/*.yaml
                      ↓
         security.sh scan_skill() 自动加载
                      ↓
              新攻击向量被拦截
```

##### 统一规则自进化架构（三域共享）

security.sh（技能安全）、research（内容去毒）、check（六维审查）共享同一套自进化基础设施：

**目录结构**

```
$NB_WORKSPACES_LIBRARY/                # 工作区级共享（非 notebook 级）
├── .evolving-rules/                   # Extended Rules（动态规则）
│   ├── security/                      # security.sh scan_skill() 使用
│   │   ├── candidates/                # 待验证规则
│   │   ├── active/                    # 已激活规则
│   │   ├── review/                    # 待审核（REQUIRE_HUMAN_APPROVAL=true）
│   │   └── deprecated/                # 已废弃规则
│   │
│   ├── sanitization/                  # research 内容去毒使用
│   │   ├── candidates/
│   │   ├── active/
│   │   ├── review/
│   │   └── deprecated/
│   │
│   └── audit/                         # check 六维审查使用
│       ├── candidates/
│       ├── active/
│       ├── review/
│       └── deprecated/
│
├── .core-rule-proposals/              # Core Rules 进化提案
│   ├── .audit.log                     # 审计日志（JSONL）
│   └── CORE-XXX-proposal.md           # 具体提案
│
├── .evolve-cron.sh                    # 外部 cron 调用脚本
├── .audit-intel-sources.yaml          # 情报源配置
└── .evolving-rules.log                # 规则变更历史日志
```

**环境变量**

```bash
# 工作区根目录（必须设置）
NB_WORKSPACES_ROOT=/path/to/workspaces

# .library 路径（自动派生，可覆盖）
NB_WORKSPACES_LIBRARY=${NB_WORKSPACES_ROOT}/.library

# 容器/K8s 部署时通过环境变量注入
# 支持多用户共享同一 .library（项目级，非用户级）
```

**初始化命令（幂等）**

```bash
# library init 支持两种场景：
# 1. 全新初始化（创建完整目录结构 + git init）
# 2. 升级已有 library（补缺目录，跳过已存在的）

library init

# 初始化创建的目录结构：
# .changelog-archive/           # changelog 归档
# .memory/.thinking/raw/        # 思考过程原始数据
# .memory/.thinking/patterns/   # 思考模式提取
# .evolving-rules/security/*/   # 安全规则（candidates/active/review/deprecated）
# .core-rule-proposals/         # Core Rules 进化提案

# 幂等性保证：
# - 目录已存在 → 跳过
# - 文件已存在 → 跳过
# - git 已初始化 → 仅提交新增内容
```

**统一规则 YAML 格式**

```yaml
# 通用字段（所有域共享）
id: RULE-2026-0001                 # 全局唯一 ID
name: Block cryptocurrency mining  # 人类可读名称
domain: security | sanitization | audit  # 所属域
category: resource_abuse           # 分类
pattern: "xmrig|cryptominer"       # 检测正则（security/sanitization）
check_items: []                    # 检查项列表（audit 域）
risk: high | medium | low          # 风险等级
enabled: true
case_insensitive: false

# 来源追踪
provenance:
  source_type: external_intel | audit_history | human_feedback | cross_mining
  source_ref: CVE-2026-99999 | arxiv_2603.12345 | incident-2026-001
  discovered_at: 2026-03-04

# 验证状态
validation:
  status: candidate | validated | active | deprecated
  precision: 0.92                  # 历史回测精度
  recall: 0.85
  false_positive_rate: 0.02
  validated_at: 2026-03-04
  activated_at: 2026-03-04

# 生命周期
lifecycle:
  created_at: 2026-03-04
  last_triggered_at: 2026-03-04
  trigger_count: 47
  deprecated_at: null
  deprecation_reason: null
```

**research 内容去毒规则扩展**

将 `injection-rules.md` 的 10 类规则迁移为可进化格式：

```yaml
# .evolving-rules/sanitization/active/cat01-instruction-injection.yaml
id: SANITIZE-CAT01
name: Direct Instruction Injection
domain: sanitization
category: instruction_injection

patterns:
  - name: xml_special_tokens
    pattern: "<system>|<\\|im_start\\|>|<\\|im_end\\|>|<INST>|</INST>|\\[INST\\]"
    risk: medium
    action: remove
    replacement: "[REMOVED: instruction injection]"

  - name: jailbreak_phrases
    pattern: "ignore previous instructions|disregard your guidelines|you are now|act as if|DAN mode"
    risk: high
    action: remove
    case_insensitive: true

  - name: social_engineering_high
    pattern: "(crypto|wallet|finance).*(curl|wget|bash|exec)"
    risk: high
    action: remove_block

# 子规则可独立进化
sub_rules_evolvable: true
```

**自进化流程统一**

```
┌─────────────────────────────────────────────────────────────────┐
│                    research --caller audit                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  1. 抓取外部情报（CVE/OWASP/arXiv/Unit42）                    │ │
│  │  2. 分析攻击向量，分类到 security/sanitization/audit 域       │ │
│  │  3. 生成候选规则到对应 candidates/ 目录                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│               check --checkpoint rule-validate                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  对每个域的 candidates/ 规则：                                │ │
│  │  • security → 在历史 .skills/.candidates/ 上回测             │ │
│  │  • sanitization → 在历史 .memory/.references/ 上回测         │ │
│  │  • audit → 在历史 .analysis/ 审查记录上回测                  │ │
│  │  precision >= 0.80 → 移动到 active/                         │ │
│  │  precision < 0.80 → 移动到 review/ (D3 fix: 不丢弃)          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  security.sh     │ │  research        │ │  check           │
│  scan_skill()    │ │  sanitize()      │ │  skill-review    │
│  ↓               │ │  ↓               │ │  ↓               │
│  加载 security/  │ │  加载            │ │  加载 audit/     │
│  active/*.yaml   │ │  sanitization/   │ │  active/*.yaml   │
│                  │ │  active/*.yaml   │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

**跨域规则复用**

某些攻击模式同时影响多个域：

```yaml
# .evolving-rules/security/active/two-stage-loading.yaml
id: RULE-TWO-STAGE
name: Two-stage loading detection
domain: security
also_applies_to: [sanitization]  # 同时用于 research 去毒

pattern: "(curl|wget).*\\|.*(bash|sh|python)"
```

加载时自动复制到关联域：

```bash
# 加载规则时检查 also_applies_to
for domain in "${ALSO_APPLIES_TO[@]}"; do
    ln -sf "$rule_file" ".evolving-rules/$domain/active/$(basename $rule_file)"
done
```

**进化来源 4: 跨 Skill 模式挖掘**

```yaml
# 分析所有 skill 的共性问题

mining_strategies:
  clustering:
    description: "将相似的 REJECT 原因聚类"
    algorithm: "embedding similarity + HDBSCAN"
    threshold: 0.85
    min_cluster_size: 3

  association:
    description: "发现特征组合与问题的关联"
    example: |
      发现: 同时使用 WebFetch + Bash 的 skill
            REJECT 率是其他 skill 的 3.2 倍
      新规则: 对此组合启用增强审核

  temporal:
    description: "发现时间相关的问题模式"
    example: |
      发现: 周五提交的 skill REJECT 率更高
      行动: 不生成规则，但记录为 insight
```

**进化流程**

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: 候选规则生成                                        │
│  ├─ 从审核历史提取 (自动)                                    │
│  ├─ 从人工反馈提取 (半自动)                                  │
│  ├─ 从外部情报提取 (自动)                                    │
│  └─ 从跨 skill 分析提取 (自动)                               │
├─────────────────────────────────────────────────────────────┤
│  Step 2: 候选规则验证                                        │
│  ├─ 在历史 skill 上回测                                      │
│  ├─ 计算 precision/recall                                   │
│  ├─ 评估 false positive 影响                                │
│  └─ 要求 precision >= 0.80                                  │
├─────────────────────────────────────────────────────────────┤
│  Step 3: 规则激活                                            │
│  ├─ 通过验证 → status: active                               │
│  ├─ 添加到对应维度的检查项列表                               │
│  └─ 记录到 .library/.evolving-rules/                        │
├─────────────────────────────────────────────────────────────┤
│  Step 4: 规则监控                                            │
│  ├─ 持续跟踪规则的 precision/recall                         │
│  ├─ precision < 0.70 → 标记为 needs_review                  │
│  ├─ 连续 30 天无触发 → 标记为 dormant                       │
│  └─ 人工可随时 deprecate                                    │
└─────────────────────────────────────────────────────────────┘
```

**检查项存储结构**

```
.library/
├── .evolving-rules/
│   └── security/                   # 按领域分组（当前仅 security）
│       ├── candidates/             # 候选规则（待验证）
│       │   └── SEC-2026-001.yaml
│       ├── active/                 # 激活规则（生产中）
│       │   └── SEC-2026-002.yaml
│       ├── review/                 # 待人工审核（REQUIRE_HUMAN_APPROVAL=true 时）
│       │   └── ...
│       └── deprecated/             # 废弃规则（保留历史）
│           └── ...
├── .core-rule-proposals/           # Core Rules 进化提案
│   ├── .audit.log                  # 审计日志（JSONL 格式）
│   └── CORE-XXX-proposal.md        # 具体提案文件
└── .evolve-cron.sh                 # 外部 cron 调用脚本
```

**两层规则体系**

1. **Core Rules (安全底线)** — 硬编码在 task-ai 代码中（CORE-001 到 CORE-010）
   - 进化周期: 7 天
   - 变更需要代码发布
   - 通过 `.core-rule-proposals/` 提案

2. **Extended Rules (动态规则)** — YAML 文件存储在 `.evolving-rules/`
   - 进化周期: 1 天
   - 自动发现、验证、激活
   - 按领域（如 security）分组

**进化命令**

```bash
# === Extended Rules 自动进化 ===
# 完整进化流程（discover → elaborate → review → integrate）
library evolve --full

# 单独阶段执行
library evolve --discover    # 从威胁情报发现候选
library evolve --elaborate   # 为候选生成详细模板
library evolve --review      # LLM 审核候选规则
library evolve --integrate   # 激活通过审核的规则

# === Core Rules 提案管理 ===
# Core Rules 自动化流程（需要代码发布）
library core-rule-auto discover    # 发现需要硬编码的模式
library core-rule-auto elaborate   # 生成提案模板
library core-rule-auto review      # LLM 审核提案
library core-rule-auto integrate   # 生成 PR（需人工合并）

# === 定时进化配置 ===
# 显示 cron 配置指南
library core-rule-auto cron-setup

# 输出示例：
# Quick Setup (user crontab):
#   crontab -e
#   0 3 * * * /path/to/.library/.evolve-cron.sh >> /var/log/evolve.log 2>&1

# === 配置参数（core-rule-auto.sh 顶部） ===
# REQUIRE_HUMAN_APPROVAL=false     # 默认全自动
# CORE_RULES_INTERVAL=604800       # Core Rules 7 天
# EXTENDED_RULES_INTERVAL=86400    # Extended Rules 1 天
```

**元规则: 进化的边界**

```yaml
evolution_constraints:
  # 安全约束: 学习不能降低安全标准
  security_floor:
    rule: "新规则不能使已知危险模式通过审核"
    enforcement: "新规则必须通过安全回归测试"

  # 稳定性约束: 避免规则震荡
  stability:
    rule: "规则变更需要冷却期"
    cooling_period: 7 days
    max_changes_per_week: 5

  # 可解释性约束: 规则必须可理解
  explainability:
    rule: "每条规则必须有人类可读的 description"
    rule: "必须提供触发示例"

  # 回滚能力: 可以撤销任何进化
  rollback:
    rule: "保留所有规则历史版本"
    rule: "支持一键回滚到指定日期的规则集"
    mechanism: "git revert on .library/ repository"
```

**定时进化机制**

```
┌─────────────────────────────────────────────────────────────┐
│  外部 Cron → Claude 会话模式                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  系统 crontab                                               │
│       │                                                     │
│       ▼                                                     │
│  .library/.evolve-cron.sh                                   │
│       │                                                     │
│       ▼                                                     │
│  claude --print "/task-ai library evolve --full"            │
│       │                                                     │
│       ▼                                                     │
│  独立 Claude 会话执行进化                                    │
│       │                                                     │
│       ▼                                                     │
│  结果写入 .library/ + git commit                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘

设计原则:
- 外部触发: cron 在 Claude 外部运行，避免会话崩溃导致定时中断
- 独立会话: 每次 evolve 是独立 Claude 会话，不影响用户工作
- 项目级脚本: .evolve-cron.sh 在 .library/ 下，支持多用户/容器环境
- 审计追踪: 所有操作记录到 .core-rule-proposals/.audit.log
```

**审计日志格式**

```jsonl
// .library/.core-rule-proposals/.audit.log
{"ts":"2026-03-04T03:00:00+08:00","action":"discover","status":"ok","details":"found 3 candidates"}
{"ts":"2026-03-04T03:00:15+08:00","action":"elaborate","status":"ok","details":"generated SEC-2026-015.yaml"}
{"ts":"2026-03-04T03:00:30+08:00","action":"review","status":"ok","details":"approved SEC-2026-015"}
{"ts":"2026-03-04T03:00:45+08:00","action":"integrate","status":"ok","details":"activated SEC-2026-015"}
{"ts":"2026-03-04T03:01:00+08:00","action":"git_commit","status":"ok","details":"task-ai(library):evolve activate SEC-2026-015"}
```

#### 6.5.3.2 人工管理能力

人工不参与审核流程，但保留以下管理能力：

```bash
# 强制升级（跳过审核）
library promote-skill <name> --force --reason "..."

# 强制降级
library demote-skill <name> --reason "..."

# 禁用 skill
library disable-skill <name> --reason "..."

# 恢复 skill
library enable-skill <name>
```

**权限分离原则**:
- **审核** = LLM 自动执行（客观、可重复）
- **管理** = 人工决策（业务判断、紧急响应）

#### 6.5.4 降级触发

| 触发条件 | 当前→目标 | 动作 | 触发者 |
|---------|----------|------|--------|
| 安全漏洞发现 | T4→T1 + 禁用 | 立即禁用，等待修复 | 自动/人工 |
| 错误率 >10% | T4→T3 | 移回 .skills/.drafts/，待修复 | 自动 |
| L3 审核失败 | T3→T2 | 需要修复后重审 | 自动 |
| 依赖废弃 | 任意→T2 | 标记需更新 | 自动 |
| 180天未使用 | T4→T3 | 标记冷存档 | 自动 |
| 审查过期 | 任意→prev | 需要重新审查 | 自动 |
| 人工强制降级 | 任意→指定 | 记录原因 | 人工 |

#### 6.5.5 版本管理

```
.skills/my-skill/
├── SKILL.md              # 当前版本 (1.2.0)
├── .versions/            # 历史归档
│   ├── 1.0.0.md
│   └── 1.1.0.md
└── CHANGELOG.md
```

**语义化版本规则**:
- MAJOR: 破坏性变更（步骤流程大改、依赖更换）
- MINOR: 功能增强（新增步骤、优化说明）
- PATCH: 小修复（typo、格式调整）

**回滚命令**: `library rollback-skill my-skill 1.0.0`

#### 6.5.6 决策树

```
                    ┌─────────────────┐
                    │ Skill 存在吗？   │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │ 否                          │ 是
              ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │ highlight       │           │ skill-check     │
    │ scope=promote   │           │ <skill-name>    │
    │ (首次构造)      │           │                 │
    └─────────────────┘           └────────┬────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │ CURRENT              │ OUTDATED             │ NEEDS_REVIEW
                    ▼                      ▼                      ▼
              ┌──────────┐          ┌──────────────┐       ┌──────────────┐
              │ 无需操作  │          │ highlight    │       │ check        │
              │          │          │ --force      │       │ skill-review │
              └──────────┘          │ (重新构造)   │       │ (重新审查)   │
                                    └──────────────┘       └──────────────┘
```

---

## 七、实施路线图

| 阶段 | 内容 | 状态 | 备注 |
|------|------|------|------|
| Phase 1 | `--add-dir` 热重载基础设施 | ✅ 完成 | 最终方案，不含 /reload |
| Phase 2 | highlight scope=promote | 待实施 | 经验 → skill 候选 |
| Phase 3 | check --skill 六维审查 | ✅ 完成 | skill-review checkpoint |
| Phase 4 | 原生沙箱验证 | ✅ 完成 | L1 scan-skill + L2 skill-review + L3 generate-skill-tests |
| Phase 5 | library 生命周期命令 | 待实施 | promote/demote/rollback/版本管理 |

### Phase 4 实施详情（已完成）

```
Phase 4a: L1 静态分析（两层架构）

  TIER 2: CORE RULES（安全底线，硬编码）
  ├─ CORE-001: 破坏性命令 (rm -rf)
  ├─ CORE-002: VFP 注入 (--eval, --conftest)
  ├─ CORE-003: 两阶段加载 (curl|bash)
  ├─ CORE-004: 环境变量操控 (LD_PRELOAD)
  ├─ CORE-005: 注入检测 (eval, btoa, <system>)
  ├─ CORE-006: CVE-2025-59536/CVE-2026-21852 Claude Code
  ├─ CORE-007: CVE-2026-25253 认证令牌窃取
  ├─ CORE-008: API Key 外泄
  ├─ CORE-009: 敏感环境变量访问
  └─ CORE-010: DNS 隧道/隐蔽通道

  TIER 1: EXTENDED RULES（可进化，动态加载）
  ├─ 从 .evolving-rules/security/active/*.yaml 加载
  ├─ 通过 research --caller audit 自动收集新规则
  └─ 通过 check --checkpoint rule-validate 验证后激活

  ⚠️ Core Rules 不可禁用，作为安全底线
  ⚠️ Extended Rules 只能 ADD 检测，不能 DISABLE Core

  人工交互接口 (library core-rule):
  ├─ list                        # 列出所有 Core Rules
  ├─ propose <name> <pattern>    # 提议新规则（生成 PR 模板）
  ├─ validate <pattern>          # 验证 pattern 有效性
  └─ status                      # 查看规则统计

Phase 4a-ext: Core Rules 进化流程

  ┌──────────────────────────────────────────────────────────────┐
  │  Step 1: 发现新威胁                                           │
  │  ├─ 外部情报 (research --caller audit)                       │
  │  ├─ 安全研究 (CVE/OWASP)                                     │
  │  └─ 内部事件 (skill 执行失败分析)                             │
  └──────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  Step 2: 提议 Core Rule                                       │
  │  $ library core-rule propose "K8s secrets" "kubectl.*secret" │
  │  ├─ 自动生成 .core-rule-proposals/CORE-011-xxx.md            │
  │  ├─ 包含代码模板 + 测试 checklist                            │
  │  └─ 提示下一步操作                                           │
  └──────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  Step 3: 验证 & 审核                                          │
  │  $ library core-rule validate "kubectl.*secret"              │
  │  ├─ 人工编辑 proposal 添加 rationale                         │
  │  ├─ 人工添加测试用例                                         │
  │  └─ 创建 PR 提交代码变更                                     │
  └──────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  Step 4: PR 审核 & 合并                                       │
  │  ├─ 代码审查 (安全团队)                                      │
  │  ├─ CI 测试通过                                              │
  │  └─ 合并到 main，新版本发布                                  │
  └──────────────────────────────────────────────────────────────┘

Phase 4b: L2 六维审查
  ├─ check.sh 新增 skill-review checkpoint
  └─ 复用现有 D1-D6 评估框架

Phase 4c: L3 沙箱执行
  ├─ verify.sh 新增 --generate-skill-tests
  ├─ 利用 init --worktree 隔离
  └─ 利用 Claude Code --permission-mode strict
```

### Phase 5 实施路径（待实施）

```
Phase 5a: Frontmatter 扩展
  ├─ 定义 lifecycle/provenance/audit_trail 字段
  └─ 更新 SKILL.md 模板

Phase 5b: skill-registry.json
  ├─ 集中管理所有 skill 状态
  ├─ 追踪 trust_tier/version/审查时间
  └─ 支持 deprecated 标记

Phase 5c: skill-check 命令
  ├─ 源哈希对比检测变更
  ├─ 审查 TTL 检测过期
  ├─ 错误率监控
  └─ 返回 CURRENT/OUTDATED/NEEDS_REVIEW/DEPRECATED

Phase 5d: promote/demote 命令
  ├─ promote-skill: T1→T2→T3→T4 全自动升级
  ├─ L3 深度审核: check --checkpoint skill-deep-review
  ├─ demote-skill: 降级 + 原因记录
  ├─ disable/enable-skill: 紧急禁用/恢复
  └─ audit_trail 追踪

Phase 5d-LLM: L3 深度语义审核
  ├─ 意图一致性检查
  ├─ 语义安全分析
  ├─ 逻辑完整性验证
  ├─ 依赖合理性检查
  └─ 可预测性评估

Phase 5e: 版本管理 + 回滚
  ├─ .versions/ 目录归档历史版本
  ├─ CHANGELOG.md 自动生成
  ├─ rollback-skill 回滚命令
  └─ 语义化版本 (MAJOR.MINOR.PATCH)

Phase 5f: 批量操作 + 集成
  ├─ promote-all --dry-run
  ├─ review-due 列出需审查的 skill
  ├─ cleanup-orphans 清理无源 skill
  └─ 与 highlight scope=promote 集成
```

### Phase 1 实现详情

**已完成文件**:
- `task-ai/core/skill-hotreload.sh` — 热重载核心脚本
- `task-ai/core/shell-aliases.sh` — Shell 别名集成
- `task-ai/skills/library/references/skill-hotreload.md` — 参考文档
- `task-ai/tests/unit/skill-hotreload.test.sh` — 回归测试

**回归测试**: 20/20 ✓ PASS

**使用方式**:
```bash
# 方式 1: 直接使用
claude --add-dir "$NB_WORKSPACES_LIBRARY/skills"

# 方式 2: 使用 wrapper
source task-ai/core/shell-aliases.sh
task-ai-dev
```

---

## 八、参考资料

### 官方文档
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) — `--add-dir`, `--continue`, `--resume` 参数
- [Claude Code Sandboxing (Anthropic)](https://www.anthropic.com/engineering/claude-code-sandboxing)

### 社区方案
- [OpenClaw Skills Configuration](https://docs.openclaw.ai/tools/skills) — 热重载、优先级机制
- [OpenClaw Skills Config (GitHub)](https://github.com/openclaw/openclaw/blob/main/docs/tools/skills-config.md) — extraDirs 配置
- [Building a /reload Command](https://www.panozzaj.com/blog/2026/02/07/building-a-reload-command-for-claude-code/)
- [Skills Best Practices](https://github.com/mgechev/skills-best-practices)
- [Claude Code Session Management](https://stevekinney.com/courses/ai-development/claude-code-session-management)

### 安全研究
- [Agent Skills Survey (arXiv 2602.12430)](https://arxiv.org/html/2602.12430)
- [Skills in the Wild Security Study (arXiv 2601.10338)](https://arxiv.org/html/2601.10338v1)
- [Malicious Agent Skills Study (arXiv 2602.06547)](https://arxiv.org/html/2602.06547v1)
