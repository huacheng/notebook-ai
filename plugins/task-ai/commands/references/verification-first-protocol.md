# Verification-First Protocol (VFP) v1.0

## Terminology
| Term | Alias | Definition |
|------|-------|------------|
| Verification Hypothesis (VH) | Red stub | 预期失败的验证条件，在实现前定义 |
| Hypothesis Satisfied (HS) | Green | 验证条件通过 |
| Cumulative Green Gate (CGG) | Regression check | 每步 HS 后验证所有已通过 VH 仍成立 |
| Consolidation | Refactor | 通过后的产物整理 |
| VH Baseline | Red baseline | 所有 VH 的初始失败状态记录 |
| Approval Snapshot | — | 人工通过 HIL-VH 时的产物参照状态 |
| CGG Proxy | — | 产物 diff 替代人工的 CGG 回归检测 |
| VFP Cycle | TDD cycle | VH → HS → CGG → Consolidation |
| Human VH (HIL-VH) | Manual test | 需人工判断的 VH |

## Applicability
- type-profile 含 `## Verification Cycle` 节 → 适用
- 缺少 → 退回标准验证流程
- software 始终适用

## VH Verification Modes
| 模式 | 判定 | 适用 |
|------|------|------|
| executable | exit code 0/1/>1 | software, data-pipeline, infrastructure |
| inspectable | the agent 按标准判定 | documentation, ml, dsp |
| human | 人工 approve/reject | literary, screenwriting, image/video |

mixed 模式 = 部分 auto + 部分 human（`human_vhs` 列表标注）

## Three-State Exit Code (executable)
| Exit | 含义 | 处理 |
|------|------|------|
| 0 | HS (Green) | → CGG → Consolidation |
| 1 | VH unsatisfied (Red) | 正常 or NEEDS_FIX |
| >1 | INFRA_ERROR | 重试一次，仍失败 → (mid-exec) |

## VH Generation Rules
1. 每 step 验证点 → ≥ 1 VH stub
2. 含描述 + 断言占位 + `// VH: not implemented`
3. 内容经 injection-rules.md 净化
4. 生成后确认全部失败 → baseline

## VH Generation Fallback
失败 → baseline 标记 `generation_failed: true` → plan 继续 → exec 跳过确认 → check N/A

## VH→HS Transition
1. 实现前 VH → 期望全部 Red
2. 意外 Green → 警告
3. 实现后 → 期望全部 Green
4. 仍 Red → NEEDS_FIX
5. 全 Green → CGG → Consolidation

## Cumulative Green Gate (CGG)
- 触发: 每步 HS 后
- 范围: step-1..N-1 所有已通过 VH
- executable: 运行累积测试; inspectable: the agent 重审; human: CGG Proxy (产物 diff)
- 回归 → 修复(≤1次) → 重跑; 仍失败 → (mid-exec)
- 产物: `.test/<date>-cumulative-green.jsonl` (追加)
- 跳过: step=1, generation_failed, 无 VC 节

## Human-in-the-Loop (HIL)
- human VH = exec 步骤 4 HS confirmation 的人工变体
- approve → Approval Snapshot; reject → NEEDS_FIX
- auto 模式: (hil-pending) → (stop), 复用 daemon 超时
- CGG Proxy: 产物 diff < 阈值 → auto-pass; 变化 → 待复审
- 降级: daemon 超时 → inspectable, 标记 hil_fallback

## Path Variables
| 变量 | 含义 |
|------|------|
| `TASKAI_WORK_DIR` | `<project>/.worktrees/task-<notebook>/.working/` — notebook 级系统工作目录 |
| `NB_PROJECT_DELIVERABLES` | `<project>/.deliverables/` — project 级交付物目录（merge 时从 `$NB_WORK_DIR/.deliverables/` 复制） |

以下路径均相对于 `$TASKAI_WORK_DIR`，交付物写入 `$NB_PROJECT_DELIVERABLES/`。

## Data Flow Contract
| 阶段 | 产出 | 消费方 |
|------|------|--------|
| plan | vh-stubs.*, vh-baseline.md, [VH:] 标注 | exec, verify, check |
| exec | cumulative-green.jsonl, hil-snapshots/, VFP Cycle Summary | exec, check, auto |
| verify | VFP Metrics in results | check |
| check | VFP Compliance in analysis | report |
| auto | vfp_cycles_completed in signal | daemon |
| report | `$NB_PROJECT_DELIVERABLES/.report-<notebook>.md` | 用户 |

## VFP Metrics
VH total / Satisfied / Unsatisfied / VFP cycle count / CGG pass / Regressions /
Coverage / Compliance / HIL total / approved / proxy pass / re-review / fallback

## Compliance Scoring
Full (≥threshold, baseline, no skip) / Partial / Low (<threshold/2) / N/A
threshold default 80%, seed-type 可覆盖

## Consolidation
检查重构机会 → 全量测试确认不回退 → 无机会则跳过

## Anomaly Detection (auto)
- VFP 周期缺失 3 步 → mid-exec check
- CGG total 递减 → mid-exec check
- 防循环: 最多触发 1 次

## Contributing
- 新类型 VC: seed-type 增加节 + validate.sh --level 2
- 新契约: .dev/contracts/ + 注册 + --self-check

## Version
v1.0 — hard upgrade
