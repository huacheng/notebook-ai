# Auto 模式子阶段目标自动生成 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 v3 设计 — 废弃 manual/ai-auto 区分，子阶段目标由 LLM 基于 convergence 差距自动生成，经验文件改用语义化命名。

**Architecture:** 修改 task-ai 插件的 SKILL.md 规范文件（非代码），按依赖顺序：schema docs → research → target → highlight/scope-specs → library → auto → other skills。所有变更都是 Markdown 规范文件编辑。

**Tech Stack:** Markdown 规范文件、task-ai 插件框架

---

### Task 1: Schema 文档 — 移除 `stage.advancement` 残留，确认状态机

**Files:**
- Modify: `task-ai/commands/task-ai.md:84-102` (`.status.json` schema)
- Modify: `task-ai/commands/references/state-matrix.md` (full file)
- Modify: `task-ai/commands/references/progressive-target.md` (full file)

**Step 1: 检查 task-ai.md 中 stage.advancement 引用**

Run: `grep -n "advancement" task-ai/commands/task-ai.md`
Expected: 0 matches (探索确认不存在)。如有匹配则删除。

**Step 2: 更新 progressive-target.md — evolving 自动生成子阶段**

在 `progressive-target.md` 中：
- 找到 evolving 状态描述（约 line 59-66），将"用户定义下一阶段"改为"LLM 自动生成下一阶段目标"
- 添加子阶段自动生成引用（指向设计文档 §3）
- 移除 manual/ai-auto 区分描述（如有）
- 补充 `satisfied → evolving` 重入路径

具体修改：
```markdown
## Stage Lifecycle

evolving 状态入口：
- convergence < 0.95 → LLM 自动生成下一子阶段目标（见 auto/SKILL.md Phase 4）→ planning
- convergence ≥ 0.95 → 停下等用户：--satisfy 或 refine Overall Objective
- satisfied 重入 → evolving → 自动生成子阶段 → planning
```

**Step 3: 更新 state-matrix.md — 确认 evolving → planning 路径**

验证 state-matrix.md 中：
- `evolving → planning`（target defines next stage）已存在
- `satisfied → planning`（target re-enter）已存在
- 无 `stage-done` 残留引用
- 无 `complete` 作为终态（唯一终态 `cancelled`）

如有缺失或错误则修正。

**Step 4: 验证**

Run: `grep -rn "stage.advancement\|stage-done\|manual.*ai-auto\|ai.auto" task-ai/commands/`
Expected: 0 relevant matches

**Step 5: Commit**

```bash
git add task-ai/commands/task-ai.md task-ai/commands/references/state-matrix.md task-ai/commands/references/progressive-target.md
git commit -m "task-ai: update schema docs — evolving auto-generates substage, confirm state machine"
```

---

### Task 2: research/SKILL.md — 移除 O1→O2→O3 逐轮确认 + [PROPOSED] 门禁

**Files:**
- Modify: `task-ai/skills/research/SKILL.md:221-249`

**Step 1: 定位修改区域**

Read `task-ai/skills/research/SKILL.md` lines 215-260 — 三阶段逐轮确认流程 + detect_stage.py 调用 + [PROPOSED] 门禁。

**Step 2: 重写三阶段流程为 LLM 自主模式**

将 O1→O2→O3 逐轮人工确认改为 LLM 自主完成全流程：

```markdown
## Research 执行模式

LLM 自主完成全流程（O1 背景调研 → O2 可行性分析 → O3 目标精炼），
一次性输出结果。不逐轮等待用户确认。

触发方式：
- auto Phase 1：LLM 自判是否需要 research
- 手动调用：用户 `/task-ai:research`
- 其他 skill 内联调用：`research --scope gap --caller <skill>`

废弃：
- O1→O2→O3 逐轮人工确认（用户只在最终结果做一次确认）
- `[PROPOSED]` 标记门禁（不再标记中间产出为 PROPOSED）
- `detect_stage.py` 阶段检测（不再分阶段门控）
```

**Step 3: 移除 [PROPOSED] 门禁逻辑**

删除所有 `[PROPOSED]` 标记相关检查（约 lines 230-240）。

**Step 4: 验证**

Run: `grep -n "PROPOSED\|detect_stage\|逐轮确认\|wait.*confirm" task-ai/skills/research/SKILL.md`
Expected: 0 matches (或仅在废弃说明中出现)

**Step 5: Commit**

```bash
git add task-ai/skills/research/SKILL.md
git commit -m "task-ai(research): remove O1→O2→O3 per-round confirmation and [PROPOSED] gates"
```

---

### Task 3: target/SKILL.md — 接受 auto 内联调用，支持 evolving refine

**Files:**
- Modify: `task-ai/skills/target/SKILL.md:93-106,123-151,175-189`

**Step 1: 定位修改区域**

Read `task-ai/skills/target/SKILL.md` — 重点：
- Write mode routing 3a (stage advance, lines 93-100)
- State transitions (lines 175-189)
- Convergence baseline triggers (lines 123-151)

**Step 2: 更新 Stage Advance 模式 (3a) — 接受 auto 内联调用**

修改 3a 模式说明，明确 auto Phase 4 evolving 入口可直接调用 target 执行 stage advance：

```markdown
### 3a. Stage Advance (evolving → planning)

触发：auto Phase 4 evolving 入口自动调用，或用户手动 `/task-ai:target`

步骤：
1. 归档当前阶段文件：`.plan.md` → `.plan-stage-<N>.md`，`.analysis/` → 保留（已含 stage 前缀）
2. 清空 `.bugfix/`
3. `stage.current++`
4. 追加新 Stage section 到 `.target.md`（auto 提供 Objective/Requirements/Constraints）
5. 标记新 Stage 为 `[ACTIVE]`，旧 Stage 标记为 `[COMPLETE]`
6. 更新 `.status.json` status → `planning`，`completed_steps` → 0
7. Git commit
```

**Step 3: 补充 satisfied → evolving 重入路径**

在 state transitions 表中确认（或添加）：

```markdown
| satisfied | evolving | 用户 refine Overall Objective → 更新 baseline → convergence 下降 |
| evolving | planning | auto 自动生成子阶段目标 → stage advance |
```

**Step 4: 移除 stage.advancement 引用（如有）**

Run: `grep -n "advancement" task-ai/skills/target/SKILL.md`
Expected: 0 matches. 如有则删除。

**Step 5: 验证**

Read modified sections, confirm:
- 3a mode accepts auto inline calls
- State transitions include satisfied → evolving → planning path
- No stage.advancement references

**Step 6: Commit**

```bash
git add task-ai/skills/target/SKILL.md
git commit -m "task-ai(target): accept auto inline calls for substage advance, add satisfied re-entry"
```

---

### Task 4: highlight/SKILL.md — 语义化命名（核心改动）

**Files:**
- Modify: `task-ai/skills/highlight/SKILL.md:93,128,285-296,318-333`

**Step 1: 定位所有 `<notebook>` 命名模式**

Run: `grep -n "<notebook>" task-ai/skills/highlight/SKILL.md`
记录所有行号。

**Step 2: 修改 scope=impl 写入路径 (line 93)**

```
当前: .memory/.experiences/<type>/<notebook>-impl.md
改为: .memory/.experiences/<type>/<semantic>-impl.md
```

添加语义名称生成说明（引用设计文档 §13.3 三级匹配流程）：

```markdown
### 语义名称确定（三级匹配）

1. LLM 从经验内容提取核心知识领域关键词，组合为 kebab-case
2. 精确匹配：检查 `.experiences/<type>/` 下是否有同名文件 → 追加
3. 索引匹配：读取 `.experiences/<type>/.naming-index.md` 查找语义等价条目 → 使用规范名称追加
4. 无匹配 → 新建文件 + 追加条目到 `.naming-index.md`（含 2-3 个 alias）
```

**Step 3: 修改 scope=verify 写入路径 (line 128)**

```
当前: .memory/.experiences/<type>/<notebook>-verify.md
改为: .memory/.experiences/<type>/<semantic>-verify.md
```

**Step 4: 修改 scope=complete 文件命名逻辑 (lines 285-296, 318-333)**

替换整个 stage-aware 文件命名逻辑：

```markdown
### 文件命名

所有 scope 统一使用语义化命名：
- impl: `<semantic>-impl.md`
- verify: `<semantic>-verify.md`
- complete: `<semantic>-complete.md`（O_APPEND 聚合，stage 信息在 frontmatter sources 中）
- failed: `<semantic>-failed.md`

移除 `-stage-<N>-` 文件名前缀 — stage 信息记录在 frontmatter `sources[].stage` 中。
```

**Step 5: 添加 frontmatter 模板**

替换现有 frontmatter 模板，添加 `semantic_name` + `sources`：

```yaml
---
semantic_name: <kebab-case-knowledge-domain>
type: <task-type>
sources:
  - notebook: <notebook-name>
    project: <project-path>
    stage: <stage-number>
    date: <YYYY-MM-DD>
quality_status: provisional
---
```

**Step 6: 添加 `.naming-index.md` 维护说明**

```markdown
### .naming-index.md 维护

写入经验后，更新 `.experiences/<type>/.naming-index.md`：

| semantic_name | aliases | file |
|---------------|---------|------|
| <name> | <alias1>, <alias2> | <name>-impl.md |

- 新建文件时追加条目（含 LLM 预生成的 2-3 个 alias）
- 索引用于后续写入的确定性匹配
```

**Step 7: 验证**

Run: `grep -n "<notebook>-impl\|<notebook>-verify\|<notebook>-complete\|<notebook>-stage" task-ai/skills/highlight/SKILL.md`
Expected: 0 matches（所有 `<notebook>` 命名已替换为 `<semantic>`）

**Step 8: Commit**

```bash
git add task-ai/skills/highlight/SKILL.md
git commit -m "task-ai(highlight): switch to semantic naming with 3-level deterministic matching"
```

---

### Task 5: highlight scope specs — frontmatter 模板更新

**Files:**
- Modify: `task-ai/skills/highlight/references/scope-impl-spec.md`
- Modify: `task-ai/skills/highlight/references/scope-verify-spec.md`
- Modify: `task-ai/skills/highlight/references/scope-complete-spec.md` (如存在)

**Step 1: 更新 scope-impl-spec.md**

- 文件路径模板：`<notebook>-impl.md` → `<semantic>-impl.md`
- Frontmatter 模板：添加 `semantic_name` + `sources` 字段
- Changelog 格式：将路径中 `<notebook>` 替换为 `<semantic>`

**Step 2: 更新 scope-verify-spec.md**

同 Step 1 的修改模式。

**Step 3: 更新 scope-complete-spec.md（如存在）**

- 移除 `-stage-<N>-` 文件名前缀
- 添加 `semantic_name` + `sources` frontmatter
- 说明 stage 信息记录在 `sources[].stage` 中

**Step 4: 验证**

Run: `grep -rn "<notebook>" task-ai/skills/highlight/references/scope-*-spec.md`
Expected: 0 matches

**Step 5: Commit**

```bash
git add task-ai/skills/highlight/references/
git commit -m "task-ai(highlight): update scope specs with semantic naming + sources frontmatter"
```

---

### Task 6: library/SKILL.md — 索引和搜索适配语义化命名

**Files:**
- Modify: `task-ai/skills/library/SKILL.md:99-113,202`

**Step 1: 更新索引说明**

`.memory/.experiences/.index.md` 索引格式：
- 当前按 `<notebook>` 列出条目
- 改为按 `<semantic_name>` 列出条目
- 说明：索引行格式 `| <semantic_name> | <type> | <suffix> | <quality_status> |`

**Step 2: 更新搜索评分**

搜索时：
- 当前按 type + keyword 匹配
- 增加：按 frontmatter `sources.notebook` 过滤支持（用于获取特定 notebook 的经验）
- 搜索 flag：`--notebook <name>` 过滤 sources 中包含该 notebook 的经验文件

**Step 3: 更新过期检查**

Staleness check：
- 当前检查 `<notebook>-*.md`
- 改为检查 `<semantic>-*.md` + frontmatter quality_status

**Step 4: 验证**

Read modified sections, confirm semantic naming adapted throughout.

**Step 5: Commit**

```bash
git add task-ai/skills/library/SKILL.md
git commit -m "task-ai(library): adapt index and search for semantic naming, add notebook filter"
```

---

### Task 7: auto/SKILL.md — Phase 1 research 自主化

**Files:**
- Modify: `task-ai/skills/auto/SKILL.md:107-112`

**Step 1: 定位 Phase 1 section**

Read `task-ai/skills/auto/SKILL.md` lines 100-120 — Phase 1 O1→O2→O3 流程。

**Step 2: 重写 Phase 1 research 逻辑**

将逐轮确认改为 LLM 自主：

```markdown
## Phase 1: Overall Objective (status=draft)

1. 对话式 refine：引导用户定义 Overall Objective
2. Research（LLM 自决）：
   - 目标清晰 → 跳过 research
   - 目标模糊或领域陌生 → 自动完成 research 全流程，一次性呈现结果
   - 用户可主动要求 research
3. 确认后调用 target 写入 .target.md + 生成 .convergence-baseline.md
4. 自动生成 Stage 1 目标（§3 子阶段目标生成机制）→ planning

废弃：O1→O2→O3 逐轮人工确认、[PROPOSED] 标记门禁
```

**Step 3: 移除 [PROPOSED] 门禁引用**

删除 Phase 1 中 `[PROPOSED] markers present` 相关检查（约 line 111）。

**Step 4: 验证**

Run: `grep -n "PROPOSED\|O1.*O2.*O3\|逐轮" task-ai/skills/auto/SKILL.md`
Expected: 0 matches in Phase 1 section (或仅在废弃说明中)

**Step 5: Commit**

```bash
git add task-ai/skills/auto/SKILL.md
git commit -m "task-ai(auto): Phase 1 research autonomy — LLM self-decides, no per-round confirmation"
```

---

### Task 8: auto/SKILL.md — Phase 4 evolving 自动生成子阶段目标

**Files:**
- Modify: `task-ai/skills/auto/SKILL.md:131-154,533-546`

**Step 1: 定位 Phase 4 + ROLLBACK sections**

Read `task-ai/skills/auto/SKILL.md` lines 125-160 (Phase 4) 和 lines 525-550 (ROLLBACK routing)。

**Step 2: 重写 Phase 4 evolving 入口**

```markdown
## Phase 4: Acceptance + 自动推进

check post-exec ACCEPT → highlight → report → status → evolving

### evolving 入口决策

1. 读取最新 convergence score（从 `.analysis/*-convergence.md`）
2. **convergence ≥ 0.95**:
   - 报告用户："convergence {score}，目标基本达成。"
   - 等用户：`--satisfy` 结束 / refine Overall Objective / 沉默保持 evolving
3. **convergence < 0.95**:
   - 自动生成下一子阶段目标（子阶段目标生成机制）：
     a. 收集输入：未满足 R#、覆盖度趋势、已完成成果、失败排除清单、交付物状态
     b. LLM 推理：聚类 R#、选择子集、对照排除清单、粒度控制
     c. 调用 target 写入新 Stage 到 .target.md
     d. 自动进入 Phase 2 (Planning)
```

**Step 3: 更新 ROLLBACK routing — 从 `-failed.md` 提取排除清单**

修改 ROLLBACK 路由（约 lines 533-546）：

```markdown
### ROLLBACK 后重新生成

1. highlight 记录失败经验到 `.experiences/<type>/<semantic>-failed.md`
2. 从所有 `*-failed.md` 按 frontmatter `sources.notebook` 过滤当前任务排除清单
3. 重新生成子阶段目标（排除清单作为硬约束注入）
4. 如所有方向穷尽 → 停下报告用户
5. 否则 → 新子阶段目标 → Phase 2
```

**Step 4: 添加 satisfied 重入路径**

在 Phase 4 中添加：

```markdown
### satisfied 重入

用户在 satisfied 状态发起 refine：
1. status: satisfied → evolving
2. 更新 .target.md Overall Objective
3. 更新 .convergence-baseline.md（新增/修改 R#）
4. convergence 因新 R# 下降
5. 自动生成下一子阶段目标 → planning → Phase 2
```

**Step 5: 验证**

Read Phase 4 section, confirm:
- evolving 入口有 convergence ≥ 0.95 / < 0.95 两条路径
- ROLLBACK 使用 `-failed.md` + notebook 过滤
- satisfied 重入路径完整

**Step 6: Commit**

```bash
git add task-ai/skills/auto/SKILL.md
git commit -m "task-ai(auto): Phase 4 evolving auto-generates substage targets with exclusion list"
```

---

### Task 9: auto/SKILL.md — 路由表补全 + 清理

**Files:**
- Modify: `task-ai/skills/auto/SKILL.md:487-499`

**Step 1: 读取当前路由表**

Read `task-ai/skills/auto/SKILL.md` lines 480-510。

**Step 2: 更新路由表**

确保路由表覆盖所有状态（与设计文档 §7.1 一致）：

```markdown
| Status | Route |
|--------|-------|
| draft | Phase 1（对话式定义 Overall Objective）|
| planning | Phase 2（plan → check）|
| re-planning | Phase 2（plan → check，带 check 反馈）|
| review | Phase 3（post-plan 已通过，exec）|
| executing | Phase 3（exec → check）|
| evolving | Phase 4（convergence < 0.95 自动推进 / ≥ 0.95 等用户）|
| satisfied | 报告完成状态，用户可 refine → evolving → 自动生成子阶段 → planning |
| blocked | 报告阻塞原因，等用户干预 |
| cancelled | 报告任务已取消（终态）|
```

**Step 3: 移除 stage.advancement 相关逻辑（如有）**

Run: `grep -n "advancement" task-ai/skills/auto/SKILL.md`
Expected: 0 matches. 如有则删除。

**Step 4: 验证**

Read routing table, confirm all 9 states covered. No `complete` state, no `stage.advancement`.

**Step 5: Commit**

```bash
git add task-ai/skills/auto/SKILL.md
git commit -m "task-ai(auto): complete routing table for all states, remove stage.advancement refs"
```

---

### Task 10: Other SKILLs — 适配语义化命名 + minor fixes

**Files:**
- Modify: `task-ai/skills/check/SKILL.md` (experience file paths)
- Modify: `task-ai/skills/plan/SKILL.md` (experience file paths, if any)
- Modify: `task-ai/skills/exec/SKILL.md` (experience file paths, if any)
- Modify: `task-ai/skills/report/SKILL.md` (experience file paths, if any)
- Modify: `task-ai/skills/merge/SKILL.md` (confirm merge only after --satisfy)
- Modify: `task-ai/skills/init/SKILL.md` (remove stage.advancement init, if any)

**Step 1: 搜索所有 `<notebook>` 经验路径引用**

Run: `grep -rn "<notebook>-impl\|<notebook>-verify\|<notebook>-complete\|<notebook>-eval\|<notebook>-failed\|<notebook>-stage" task-ai/skills/check/ task-ai/skills/plan/ task-ai/skills/exec/ task-ai/skills/report/ task-ai/skills/merge/ task-ai/skills/init/`

**Step 2: 逐个替换为语义化命名**

对每个匹配：
- `<notebook>-impl.md` → `<semantic>-impl.md`
- `<notebook>-verify.md` → `<semantic>-verify.md`
- `<notebook>-eval.md` → `<semantic>-eval.md`
- `<notebook>-complete.md` → `<semantic>-complete.md`
- `<notebook>-failed.md` → `<semantic>-failed.md`
- `<notebook>-stage-<N>-*.md` → `<semantic>-*.md`

check/SKILL.md line 135: `.memory/.experiences/<type>/<notebook>-eval.md` → `.memory/.experiences/<type>/<semantic>-eval.md`

**Step 3: init/SKILL.md — 确认无 stage.advancement**

Run: `grep -n "advancement" task-ai/skills/init/SKILL.md`
Expected: 0 matches (探索已确认)。

**Step 4: merge/SKILL.md — 确认阶段间不 merge**

Read merge/SKILL.md，确认 merge 触发条件说明中：
- merge 仅在 post-exec ACCEPT 后（单阶段）或 `--satisfy` 后（最终）执行
- 如缺少"阶段间不 merge"说明，补充：

```markdown
**Note:** 阶段间不执行 merge — 交付物累积在 task 分支上。仅在 `--satisfy` 后 merge 到 main。
```

**Step 5: 验证**

Run: `grep -rn "<notebook>-impl\|<notebook>-eval\|advancement" task-ai/skills/check/ task-ai/skills/plan/ task-ai/skills/exec/ task-ai/skills/report/ task-ai/skills/merge/ task-ai/skills/init/`
Expected: 0 matches

**Step 6: Commit**

```bash
git add task-ai/skills/check/ task-ai/skills/plan/ task-ai/skills/exec/ task-ai/skills/report/ task-ai/skills/merge/ task-ai/skills/init/
git commit -m "task-ai: adapt remaining skills for semantic naming, confirm merge-only-on-satisfy"
```

---

### Task 11: 最终交叉验证

**Files:**
- All modified files

**Step 1: 全局搜索废弃项残留**

```bash
grep -rn "stage\.advancement\|PROPOSED\|O1.*O2.*O3\|detect_stage\.py\|stage-done" task-ai/
```

Expected: 0 matches（或仅在废弃说明/changelog 中出现）

**Step 2: 全局搜索 `<notebook>` 命名残留（经验文件路径）**

```bash
grep -rn "<notebook>-impl\|<notebook>-verify\|<notebook>-complete\|<notebook>-eval\|<notebook>-failed\|<notebook>-stage" task-ai/skills/
```

Expected: 0 matches（所有经验文件路径已改为 `<semantic>-*`）

**Step 3: 交叉引用检查**

验证以下引用链一致：
- auto Phase 4 → target 3a mode（stage advance 调用）
- auto Phase 4 ROLLBACK → highlight failed experience → `.experiences/<type>/<semantic>-failed.md`
- auto Phase 4 evolving → §3 子阶段目标生成机制 → target 写入
- highlight `.naming-index.md` → library search 适配
- state-matrix: evolving → planning / satisfied → evolving → planning

**Step 4: Commit（如有修正）**

```bash
git add -A task-ai/
git commit -m "task-ai: cross-validation fixes for v3 auto-substage-autogen"
```
