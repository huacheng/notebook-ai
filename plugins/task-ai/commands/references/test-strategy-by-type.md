# Test Strategy by Task Type

统一的类型→测试策略映射。plan（测试设计）、verify（测试执行）、
check（审查回归测试）、research（方法论收集）共同引用此文件。

## Table of Contents
- [Strategy Matrix](#strategy-matrix)
- [Test Classification Rules](#test-classification-rules)
- [Regression Test Protocol](#regression-test-protocol)
- [VFP Applicability](#vfp-applicability)
- [Phase Responsibilities](#phase-responsibilities)

## Strategy Matrix

测试策略按 (任务类型 × 修正类别) 二维选择：

| Task Type | Code/Script Fix | Spec/SKILL.md Fix | Data/Config Fix |
|-----------|----------------|-------------------|-----------------|
| **software** | Unit/integration test in project suite | Contract test validating spec content | Schema validation test |
| **ai-skill** | Contract test for script behavior | Contract test scanning SKILL.md content | Fixture update + graph/matrix validator |
| **documentation** | Link checker or build test | Content validation script (grep/regex) | N/A |
| **data-pipeline** | Data validation test (row counts, schema) | Contract test for pipeline spec | Fixture-based regression |
| **infrastructure** | Smoke test or plan-diff test | Contract test for IaC spec | Config schema validation |
| **science / ml** | Reproducibility test (seed + threshold) | Contract test for experiment spec | Parameter range validation |
| **image-processing** | Visual regression (SSIM/PSNR threshold) | Content validation script | Color profile validation |
| **dsp** | SNR/THD threshold test | Content validation script | Sample format validation |
| **Other / unknown** | Closest match from above; default to contract test | Content validation script | Schema or fixture test |

## Test Classification Rules

对每个修正，按类别选择测试手法：

| Fix Category | Test Approach | Example |
|-------------|---------------|---------|
| **Runtime code** (`.py`, `.sh`, `.ts`) | Functional test: assert correct output for the previously-failing input | `state.py` JSONDecodeError → test with corrupt JSON |
| **Spec text** (SKILL.md, references) | Contract test: assert keyword/section/field presence | Missing `realpath` → grep-based contract test |
| **Fixture data** (`.json`, `.jsonl`) | Property test: assert structural invariants (count, reachability) | Missing transitions → graph validator checks count ≥ N |
| **Cross-reference** (index, ToC, links) | Completeness test: assert every file in index and vice versa | `REFERENCE-INDEX.md` missing entry → bidirectional check |
| **Stale content** (deprecated terms) | Absence test: assert zero matches across scoped file set | `tmux capture-pane` → grep asserts zero hits |

## Regression Test Protocol

每个审查修正必须有回归测试：修正前 FAIL (RED)，修正后 PASS (GREEN)。

```
For each finding F:
  1. Classify F → (fix category, task type) → select test approach from tables above
  2. Write the test (RED):
     - Must fail against the current codebase
     - Must be minimal — verify exactly one property
     - Must be deterministic — no flaky assertions
  3. Run → confirm FAIL (RED)
  4. Apply the fix
  5. Run → confirm PASS (GREEN)
  6. Run full suite → confirm zero regressions
```

### Exemptions

| Exemption | Reason | Example |
|-----------|--------|---------|
| Pure typo fix (≤3 chars) | Zero behavioral impact | "single the agent" → "single agent" |
| Comment-only change | No runtime or spec impact | Adding `# TODO` |
| Historical doc annotation | Superseded, not referenced | Adding "⚠️ superseded" header |

### Integration

- **Contract tests** → `.dev/contracts/`, register in `validate.sh` (L1/L2/L3)
- **Unit tests** → project test suite (`vitest`, `pytest`)
- **Fixture updates** → existing validators auto-pick-up; add new assertions if needed

## VFP Applicability

VFP (Verification-First Protocol) 的适用性按类型判断。详细规范见
`verification-first-protocol.md`，此处仅列出适用性规则：

| Task Type | VFP 默认适用 | VH Mode | Compliance Threshold |
|-----------|:---:|---------|:---:|
| `software` | 是 | executable (exit code) | 80% |
| `data-pipeline` | 否* | executable or inspectable | 80% |
| `infrastructure` | 否* | inspectable or human | 70% |
| `science / ml` | 否* | executable + inspectable | 80% |
| `ai-skill` | 否* | inspectable (contract test) | 80% |
| Other | 否* | inspectable | 70% |

\* 当 `.type-profile.md` 包含 `## Verification Cycle` 时启用。

Threshold 可被 seed-type 或 `.type-profile.md` 覆盖。

## Phase Responsibilities

测试生命周期中各阶段的分工：

| Phase (Skill) | 职责 | 产出 |
|---------------|------|------|
| **research** `--caller test` | 收集领域测试方法论和工具 | `.test/<date>-research-methodology.md` |
| **plan** step 17-18 | 设计验证标准 + 生成 Verification baseline (software: VH stubs; non-software: contract baseline with RED/GREEN specs) | `.test/<date>-plan-criteria.md`, `vh-stubs.test.*` or `contract-baseline.md` |
| **verify** | 运行测试 + 产出结构化结果 | `.test/<date>-<checkpoint>-results.md` |
| **check** (post-plan) | 评判测试标准质量 | `.analysis/` |
| **exec** per-step | RED → Implement → GREEN → CGG → Refactor | `cumulative-green.jsonl` |
| **check** (post-exec) | VFP 纪律审计 + 合规评分 | `.analysis/` (VFP Compliance) |
| **check** (audit fix) | 审查修正回归测试 | `.dev/contracts/` or project test suite |
| **highlight** scope=verify | 蒸馏验证经验 | `.memory/.experiences/<type>/<nb>-verify.md` |
| **report** | 汇总测试结果到终报告 | `.report.md` Verification section |
