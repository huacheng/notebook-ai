# task-ai 统一六维审查框架 & plan 自审设计方案

> 统一审查标准：一套六维框架，三个应用深度（L1 自审 / L2 评审 / L3 深度审计）
> plan skill 内置质量关卡：生成计划后、交付 check 前，自审消灭明显漏洞
> 日期：2026-02-28

---

## 1. 统一六维审查框架

### 1.1 背景：三套标准合并

此前系统中存在三套独立命名的评估标准：

| 来源 | 维度命名 |
|------|---------|
| plan 自审（本文档） | 正确性 / 安全性 / 可靠性 / 性能 / 架构 / 可维护性 |
| check post-plan 标准 | Completeness / Feasibility / Verifiability / Clarity / Risk / Dependencies |
| check 六视角审计 | Security / Architecture / Performance / Extensibility / Consistency / Correctness |

三套标准覆盖范围高度重叠但命名分歧，导致概念碎片化。本节将其统一为**一套框架、三个应用深度**。

### 1.2 统一框架定义

| # | 维度 | 核心问题 | 英文标识 |
|---|------|---------|---------|
| D1 | **正确性** | 是否做了该做的事？ | Correctness |
| D2 | **安全性** | 是否抵御了不该发生的事？ | Security |
| D3 | **可靠性** | 异常时是否优雅降级？ | Reliability |
| D4 | **性能** | 是否足够快、足够省？ | Performance |
| D5 | **架构** | 结构是否支撑变化与增长？ | Architecture |
| D6 | **可维护性** | 下一个人能否读懂和改动？ | Maintainability |

### 1.3 三个应用层次

所有消费者使用同一套六维标准，以不同深度应用：

| 层次 | 消费者 | 深度 | 产出 | 时机 |
|------|-------|------|------|------|
| **L1 自审** | plan skill (step 24.5) | 表面扫描（检查清单） | 就地修正 `.plan.md` | 计划生成后、commit 前 |
| **L2 评审** | check post-plan | 加权评估 | `.analysis/` + PASS/NEEDS_REVISION/BLOCKED | plan 提交后 |
| **L3 深度审计** | check (all checkpoints) | 逐项验证 + 领域适配 | 问题列表 + 严重级别 (HIGH/MED/LOW) + file:line | mid-exec / post-exec |

### 1.4 旧框架映射

| 统一维度 | ← plan 自审 | ← check post-plan | ← check 六视角 | 合并说明 |
|---------|------------|-------------------|---------------|---------|
| **正确性** | 正确性 | Completeness + Feasibility(功能可行性) | Correctness/Completeness(功能逻辑) | 聚焦"做对了吗" |
| **安全性** | 安全性 | Risk(安全子集) | Security | 直接对应 |
| **可靠性** | 可靠性 | Dependencies + Risk(故障风险) + Feasibility(依赖可行性) | Correctness(边界/幂等/死锁/回退) | 聚焦"出错了怎么办" |
| **性能** | 性能 | — | Performance | 直接对应 |
| **架构** | 架构 | — | Architecture + **Extensibility** | Extensibility 合入（架构定义已含"支撑变化与增长"） |
| **可维护性** | 可维护性 | Clarity + Verifiability | **Consistency** | Consistency 合入（术语/规范一致性 = 可维护性子项） |

### 1.5 check post-plan 标准重映射

check post-plan 原有的 6 个独立标准不再使用独立命名，改为六维框架下的检查重点：

| 原标准 | 映射到维度 | 在维度中的角色 |
|--------|----------|-------------|
| Completeness | **正确性** | 需求覆盖率 — `.target.md` 每条需求在 plan 中有对应 |
| Feasibility | **正确性** + **可靠性** | 功能可行性→正确性；依赖/资源可行性→可靠性 |
| Verifiability | **可维护性** | 可验证性 — 每步是否有明确的验证方法 |
| Clarity | **可维护性** | 描述清晰度 — 步骤是否无歧义可执行 |
| Risk | **安全性** + **可靠性** | 安全风险→安全性；故障/依赖风险→可靠性 |
| Dependencies | **可靠性** | 依赖状态验证 — `depends_on` 是否满足 |

### 1.6 six-perspective-audit 基础检查项重分配

原六视角审计的基础检查项按统一维度重新归属：

**正确性 D1** (from Correctness/Completeness — 功能逻辑部分)：
- Ordering correctness — 操作顺序是否正确
- Superseded data isolation — 旧数据是否对读者不可见
- Source identification — 多来源时是否选择了正确来源

**安全性 D2** (from Security — 原样保留)：
- Path traversal / Input validation / Symlink protection / Injection prevention / Content sanitization / Atomic operations / Concurrency protection / Secret handling / Privilege boundaries

**可靠性 D3** (from Correctness/Completeness — 健壮性部分)：
- Deadlock freedom — 无死锁（每个非终态有出口）
- Loop termination — 循环有上界
- Edge cases — 空输入、缺文件、首次运行
- Fallback behavior — 未定义值有兜底
- Idempotency — 重复执行产生相同结果

**性能 D4** (from Performance — 原样保留)：
- Context window management / Lazy loading / Growth control / Non-blocking operations / I/O efficiency / Calculation accuracy

**架构 D5** (from Architecture + Extensibility 合并)：
- *原 Architecture*: Modularity / Coupling / Abstraction layers / Data flow direction / Interface boundaries / Domain structure alignment / Dependency direction
- *原 Extensibility 合入*: Open type system / Custom thresholds / Hook/extension points / Dependency format / Progressive disclosure / Template system

**可维护性 D6** (from Consistency 合并 + 补充)：
- *原 Consistency 合入*: Cross-file terminology / State machine alignment / Signal routing match / Step numbering / Shared protocol references / Field usage symmetry / Naming conventions
- *补充*: Step executability（步骤可执行性）/ Test traceability（测试可追溯）

### 1.7 领域适配种子表（重映射后）

原 6 视角领域适配表按统一维度重组。`+item` 表示在基础检查项之上的领域特化补充。

#### 广域类型

| 维度 | software | science:* | documentation | data-pipeline | infrastructure | ml | ai-skill |
|------|----------|-----------|---------------|---------------|----------------|-----|----------|
| **正确性** | +contract tests | +statistical significance, +error propagation | +factual accuracy, +link validity | +row count reconciliation, +exactly-once semantics | +drift detection, +rollback verification | +convergence criteria, +overfitting detection | +edge case coverage, +hallucination detection |
| **安全性** | +injection, +auth, +OWASP | +data integrity, +IRB compliance | +link safety, +license compliance | +data provenance, +PII handling | +IAM, +network isolation, +secrets rotation | +training data poisoning, +model extraction | +prompt injection, +context leakage |
| **可靠性** | +regression tests, +graceful degradation | +reproducibility, +experiment isolation | +build reliability, +broken link detection | +backfill recovery, +schema evolution tolerance | +failover, +disaster recovery | +checkpoint/resume, +data pipeline fault tolerance | +fallback responses, +context overflow handling |
| **性能** | +time/space complexity, +caching | +computation cost, +dataset scale | +build time, +search indexing | +batch vs stream, +parallelism, +backfill cost | +provisioning time, +cold start, +scaling limits | +training throughput, +inference latency, +GPU utilization | +context window efficiency, +token cost |
| **架构** | +API design, +SOLID, +design patterns, +plugin API, +configuration surface | +reproducibility structure, +experiment isolation, +new datasets, +parameter sweeps | +information architecture, +navigation hierarchy, +localization, +multi-format output | +stage decomposition, +idempotent stages, +backpressure, +schema evolution, +new source/sink types | +IaC layering, +blast radius isolation, +multi-region, +multi-cloud | +training/inference separation, +feature pipeline, +model swappability, +hyperparameter surface | +progressive disclosure, +skill composability, +new tools, +prompt templates |
| **可维护性** | +API contract stability, +error format | +unit conventions, +citation format | +style guide compliance, +terminology glossary | +schema versioning, +naming across stages | +tagging standards, +naming conventions | +metric naming, +experiment tracking format | +skill interface conventions |

#### 专业类型

| 维度 | image-processing | video-production | dsp | literary | screenwriting | mechatronics | chip-design |
|------|-----------------|-----------------|-----|----------|---------------|--------------|-------------|
| **正确性** | +SSIM/PSNR thresholds, +visual regression | +frame accuracy, +A/V sync tolerance | +SNR/THD thresholds, +frequency response tolerance | +plot coherence, +continuity check | +continuity, +dialogue attribution | +timing analysis, +safety margins | +functional simulation, +formal verification, +STA, +DRC/LVS |
| **安全性** | +EXIF stripping, +steganography awareness | +codec vulnerability, +DRM compliance | +input range validation (sample rate, bit depth) | +plagiarism check, +copyright | +rights clearance, +format protection | +safety interlocks, +fail-safe defaults | +IP protection, +side-channel awareness |
| **可靠性** | +format fallback, +corrupt file handling | +timeline recovery, +render resume | +buffer overflow protection, +real-time guarantee | +backup/versioning | +format compatibility | +watchdog, +emergency stop | +design rule fallback, +timing margin |
| **性能** | +pixel throughput, +memory (resolution×depth) | +render time, +codec efficiency, +I/O bandwidth | +latency budget, +throughput (samples/sec), +memory alignment | +reading pace, +word economy | +page count, +scene timing | +interrupt latency, +control loop frequency | +timing closure (Fmax), +area/power, +routing congestion |
| **架构** | +pipeline topology, +colorspace management, +new formats, +filter plugins | +timeline structure, +render graph, +new codecs, +effect plugins | +signal chain topology, +buffer management, +real-time constraints, +filter chain composability | +narrative arc, +chapter structure, +style variations, +audience adaptation | +act structure, +scene graph, +format adaptation (film/TV/web) | +hardware/software boundary, +real-time partitioning, +sensor/actuator swappability | +hierarchy (system/block/module), +clock domain crossing, +IP reuse, +parameterized modules |
| **可维护性** | +color profile, +resolution conventions | +frame rate, +aspect ratio, +audio sync | +sample format conventions | +voice consistency, +tense agreement | +format conventions (Fountain/FDX) | +signal naming, +unit standards | +naming conventions (RTL/netlist), +design rule consistency |

---

## 2. plan 自审定位

### 2.1 解决的问题

当前 plan → check post-plan 流程中，check 发现计划缺陷 → NEEDS_REVISION → 回到 planning → plan 重新生成 → 再 check，这个循环成本高（每次 check 需重新读取全部上下文）。许多被 check 驳回的问题属于"作者本应自己发现"的明显漏洞。

### 2.2 类比

| 角色 | 对应 | 职责 |
|------|------|------|
| 开发者自审 | **plan 自审**（新增） | 提交前检查自己的代码 |
| Code Reviewer | check post-plan（已有） | 独立评审，发现深层问题 |

### 2.3 设计约束

| 约束 | 说明 |
|------|------|
| **不改状态机** | 自审是 plan skill 内部行为，不增加新状态、不改转换规则 |
| **不产出分析文件** | 不写 `.analysis/` 文件（那是 check 的职责）|
| **就地修正** | 发现问题直接修改 `.plan.md`，对外行为透明 |
| **轻量级** | 快速扫描，不做完整的 check 级深度分析 |
| **单次** | 自审最多执行一轮修正，不循环（避免无限自审） |
| **非致命** | 自审失败（异常/超时）不阻塞 plan 流程，降级为跳过 |

---

## 3. 在 plan skill 中的位置

当前 plan skill 的执行步骤（末段）：

```
Step 22: 写 .summary.md
Step 23: 更新 .index.json
Step 24: highlight 思考捕获
Step 25: Git commit          ← 自审插入点：25 之前
Step 26: 写 .auto-signal
Step 27: 报告计划摘要
```

修改后：

```
Step 22:   写 .summary.md
Step 23:   更新 .index.json
Step 24:   highlight 思考捕获
Step 24.5: ★ L1 六维自审 — 扫描 .plan.md，发现问题就地修正
Step 25:   Git commit（提交的是自审后的版本）
Step 26:   写 .auto-signal
Step 27:   报告计划摘要（含自审修正摘要）
```

自审在 highlight 之后（思考已捕获）、commit 之前（修正可以包含在同一次提交中）。

---

## 4. L1 自审检查项

L1 自审使用统一六维框架（§1.2），每个维度定义 2-4 个表面检查项。逐维度扫描 `.plan.md`，对照 `.target.md` 需求。

### 4.1 D1 正确性 — 计划是否覆盖了该做的事

| 检查项 | 方法 | 修正方式 |
|--------|------|---------|
| **需求覆盖率** | `.target.md` 每条需求 → 至少有一个计划步骤对应 | 补充遗漏步骤 |
| **验收标准映射** | `.target.md` 验收标准 → 计划中有明确的验证点 | 在对应步骤后追加验证说明 |
| **输入输出一致性** | 每步的输出是否被后续步骤正确消费 | 修正数据流断裂 |

### 4.2 D2 安全性 — 计划是否识别了不该发生的事

| 检查项 | 方法 | 修正方式 |
|--------|------|---------|
| **安全敏感步骤标识** | 涉及用户输入、外部 API、文件 I/O、权限的步骤是否标注了安全考量 | 追加安全注释 |
| **输入验证覆盖** | 接受外部数据的步骤是否有验证/净化说明 | 补充验证要求 |

### 4.3 D3 可靠性 — 计划是否考虑了异常路径

| 检查项 | 方法 | 修正方式 |
|--------|------|---------|
| **依赖显式化** | 每步的外部依赖（库、服务、文件）是否明确列出 | 补充依赖清单 |
| **失败回退** | 关键步骤是否有失败时的处理说明 | 追加回退方案 |
| **步骤间耦合** | 某步失败是否会级联阻塞后续所有步骤 | 识别并标注阻塞点 |

### 4.4 D4 性能 — 计划是否足够精简

| 检查项 | 方法 | 修正方式 |
|--------|------|---------|
| **冗余步骤** | 是否有可合并或可删除的步骤 | 合并/删除 |
| **步骤粒度** | 单步是否过大（应拆分）或过碎（应合并）| 调整粒度 |

### 4.5 D5 架构 — 计划结构是否支撑变化

| 检查项 | 方法 | 修正方式 |
|--------|------|---------|
| **模块边界** | 步骤分组是否反映合理的模块/阶段划分 | 重组步骤分组 |
| **增量交付** | 是否支持阶段性交付（stage）而非 all-or-nothing | 标注 stage 边界 |
| **关注点分离** | 每步是否只做一件事 | 拆分混合步骤 |

### 4.6 D6 可维护性 — 下一个 agent 能否直接执行

| 检查项 | 方法 | 修正方式 |
|--------|------|---------|
| **步骤可执行性** | 每步描述是否具体到可以直接开工（不含"适当处理"等模糊措辞）| 明确化描述 |
| **术语一致性** | 计划中的术语是否与 `.target.md` / `.type-profile.md` 一致 | 统一术语 |
| **测试可追溯** | 每步是否明确了如何验证该步完成 | 补充验证方法 |

---

## 5. 执行流程

```
Step 24.5: L1 六维自审

  5.1  读取 .plan.md（刚生成的计划）
  5.2  读取 .target.md（需求基准）
  5.3  读取 .type-profile.md（领域上下文，如果存在）
  5.4  逐维度扫描（§4 检查项）：
       - D1 正确性：对照 .target.md 逐条核对覆盖率
       - D2 安全性：扫描步骤中的安全敏感操作
       - D3 可靠性：检查依赖和失败路径
       - D4 性能：识别冗余和粒度问题
       - D5 架构：评估步骤分组和交付边界
       - D6 可维护性：检查描述清晰度和术语一致性
  5.5  汇总发现：
       - 无问题 → 跳过修正，继续 step 25
       - 有问题 → 就地修改 .plan.md（直接编辑，不写分析文件）
       - 异常/超时 → 降级跳过，不阻塞 plan 流程
  5.6  在 step 27 报告中附加自审摘要（一句话概述修正了什么）
```

### 5.1 领域适配

自审检查项的权重和侧重点应根据 `.type-profile.md` 调整（参考 §1.7 领域适配种子表）：

| 任务类型 | 权重调整 |
|----------|---------|
| `software` | 安全性↑ 可靠性↑ |
| `data-pipeline` | 性能↑ 可靠性↑ |
| `documentation` | 可维护性↑ 正确性↑ |
| `infrastructure` | 安全性↑↑ 可靠性↑↑ |
| `ml` | 性能↑ 架构↑ |

自审不做硬性评分——只做"有问题/无问题"的二元判断 + 就地修正。

---

## 6. L1/L2/L3 分工对照

| 维度 | L1 plan 自审 | L2 check post-plan | L3 check 深度审计 |
|------|------------|-------------------|-----------------|
| **深度** | 表面扫描（检查清单） | 加权评估（六维 + 判定） | 逐项验证（基础表 + 领域适配） |
| **视角** | 作者自检 | 独立评审 | 系统级审计 |
| **输出** | 就地修正 .plan.md | `.analysis/` + PASS/NEEDS_REVISION/BLOCKED | 问题列表 + 严重级别 + file:line |
| **状态影响** | 无 | 可能转换状态 | 可能转换状态 |
| **领域深度** | §4 检查项 + §5.1 权重调整 | §1.5 重映射 + .type-profile.md | §1.6 基础表 + §1.7 种子表 + .type-profile.md |
| **VFP 审计** | 不做 | 做（software 类型） | 做（software 类型） |
| **计算规则** | 不涉及数值 | 必须用 shell 脚本（无心算） | 必须用 shell 脚本（无心算） |

**L1 不替代 L2/L3**——L1 消灭的是"作者疏忽"，L2 发现的是"设计盲区"，L3 验证的是"系统级一致性"。三者正交。

**预期效果**：check post-plan (L2) 的 NEEDS_REVISION 率从（估计）40-60% 降至 10-20%。首次 PASS 率显著提升。

---

## 7. SKILL.md 修订清单

| 编号 | 修改项 | 说明 |
|------|--------|------|
| P1 | 在 plan SKILL.md step 24 和 25 之间插入 step 24.5 | L1 六维自审执行步骤 |
| P2 | plan SKILL.md step 27 报告格式增加自审摘要 | "Self-audit: N issues found and corrected" 或 "Self-audit: clean" |
| P3 | 新增 `plan/references/self-audit-checklist.md` | §4 的 L1 检查项表格独立为参考文件，便于维护和领域扩展 |
| P4 | **重写** `check/references/six-perspective-audit.md` | 六视角 → 六维度：Extensibility 合入 Architecture，Consistency 合入 Maintainability，Correctness 拆分为 Correctness + Reliability。基础检查项按 §1.6 重分配，领域种子表按 §1.7 重组 |
| P5 | **更新** check SKILL.md post-plan 标准 | 替换原 Completeness/Feasibility/Verifiability/Clarity/Risk/Dependencies 为统一六维框架（§1.5 映射关系），评估维度用 D1-D6 标识 |
| P6 | **重命名** `six-perspective-audit.md` → `six-dimension-audit.md` | 文件名反映统一框架（perspective → dimension） |

---

## 8. 开放问题

| 编号 | 问题 | 状态 |
|------|------|------|
| ~~Q1~~ | ~~自审修正量过大时是否应发出警告~~ | ✅ 已关闭：不需要额外警告机制。自审已修正问题，step 27 报告已包含修正计数（"Self-audit: N issues corrected"）足够透明。修正量极大时真正根因是 research 不充分或 target 不清晰——这由 check 的 NEEDS_REVISION/BLOCKED 诊断，自审不应越位 |
| ~~Q2~~ | ~~re-planning 场景下自审是否应跳过~~ | ✅ 已关闭：不跳过。`.plan.md` 在 re-planning 后仍是完整文档，六维审查对象不变；局部修改可能引入连带漏洞（依赖链断裂、安全步骤缺失），自审恰好捕获；自审成本极低（单次扫描，不循环），不区分 planning / re-planning |
| ~~Q3~~ | ~~三套评估标准如何统一~~ | ✅ 已关闭：§1 定义统一六维框架，三个消费者 (L1/L2/L3) 以不同深度应用同一套维度。旧框架映射见 §1.4，check post-plan 标准重映射见 §1.5，基础检查项重分配见 §1.6 |
