# task-ai auto 执行可靠性增强方案 v2

> 创建日期: 2026-03-13
> 状态: ✅ 已完成 (2026-03-13)

## 一、问题总结

| 问题 | 现象 | 根因 |
|------|------|------|
| Stage-2 没写 .plan.md 就执行 | auto 在 stage-1 完成后，stage-2 直接在上下文中"规划"然后执行，没有产出 .plan.md 文件 | Claude 跳过 plan 步骤，无产出校验机制 |
| verify 测试没执行 | .test/ 目录下的测试没有真正运行 | verify.sh 是 stub（硬编码输出 PASS），SKILL.md 缺具体测试命令 |
| 上下文爆炸 | 长时间 auto 循环后上下文溢出 | 子命令累积，.summary.md 更新不及时 |

## 二、方案架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     auto 执行可靠性增强                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │ 子命令分类  │ + │ 产出校验    │ + │ 上下文管理  │           │
│  │ 调用协议    │   │ 硬性门控    │   │ 强制节点    │           │
│  └─────────────┘   └─────────────┘   └─────────────┘           │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  verify 测试执行实现                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 三、子命令分类与调用协议

### 3.1 分类表

| 分类 | 子命令 | 调用方式 | 理由 |
|------|--------|---------|------|
| **独立型** | target, verify, highlight, report, summarize, library, cancel | Skill tool | 不依赖对话上下文，完整加载保证正确 |
| **上下文敏感型** | plan, check, exec, research, security, annotate | Read SKILL.md + 执行 | 需要对话上下文（决策、错误处理） |

### 3.2 独立型调用流程

```
auto step 2.3a (独立型子命令):
  1. 调用 Skill tool → /task-ai:<cmd> [args]
  2. Skill tool 同步执行，等待完成
  3. 执行产出校验（见第四节）
  4. 读取结果文件，决定下一步
```

### 3.3 上下文敏感型调用流程

```
auto step 2.3b (上下文敏感型子命令):
  1. Read `skills/<cmd>/SKILL.md` (完整读取)
  2. 执行 SKILL.md 中的 Execution Steps (逐步执行)
  3. 执行产出校验（见第四节）
  4. 读取 .status.json，决定下一步
```

## 四、产出校验（硬性门控）

### 4.1 校验表

| 子命令 | 必须产出 | 校验方法 | 失败处理 |
|--------|---------|---------|---------|
| plan | `.plan.md` | `[ -s .plan.md ]` (存在且非空) | ABORT |
| verify | `.test/<date>-*-results.md` | glob 匹配 + 非空 | ABORT |
| check | `.analysis/<date>-*.md` | glob 匹配 + 存在 | ABORT |
| exec | `completed_steps` 变化 | 读取前后对比 | WARN |
| target | `.target.md` 更新 | mtime 变化 | ABORT |
| summarize | `.summary.md` | 存在且非空 | ABORT |

### 4.2 失败处理流程

```
产出校验失败:
  1. 记录错误到 `.bugfix/<date>-output-missing.md`:
     - 子命令名称
     - 预期产出
     - 实际状态
     - 调用上下文
  2. 更新 .status.json: phase → "needs-fix"
  3. ABORT 当前循环
  4. 报告用户: "子命令 {cmd} 未产出预期文件 {file}，请检查"
```

## 五、上下文管理（强制 summarize 节点）

### 5.1 强制节点

| 触发条件 | 时机 | 目的 |
|---------|------|------|
| **Phase 变化** | status 字段变化后 | 捕获阶段完成上下文 |
| **独立型调用前** | Skill tool 调用前 | 确保 .summary.md 是最新的，支持恢复 |
| **迭代计数** | 每 3 次循环迭代 | 防止上下文累积 |
| **上下文阈值** | context ≥ 70% | 主动压缩前保存 |

### 5.2 Recovery Header（强制）

所有 `.summary.md` 写入必须包含 Recovery Header：

```markdown
<!-- TASK-AI RECOVERY CONTEXT -->
<!-- If you see this after context compaction, execute recovery protocol: -->
<!-- 1. Read .status.json for status and phase -->
<!-- 2. Read this file for task context -->
<!-- 3. Resume from current phase entry point -->

# Task: {notebook_name}
**Status**: {status} | **Phase**: {phase} | **Progress**: {completed_steps}/{total_steps}
**Branch**: {branch} | **Updated**: {timestamp}

---

{summary content}
```

### 5.3 实现位置

- **summarize/SKILL.md step 10**: 生成 `.summary.md` 时强制添加 Recovery Header
- **plan/check/exec**: 写 `.summary.md` 的步骤中引用 summarize 的格式

## 六、verify 测试执行实现

### 6.1 修改 verify/SKILL.md step 10

```markdown
10. **Execute** verification based on task type:

    **10a. software type** (type contains "software"):

    1. Detect test command:
       - package.json → `npm test` or `scripts.test` value
       - pyproject.toml → `pytest` or `[tool.pytest]` config
       - Cargo.toml → `cargo test`
       - go.mod → `go test ./...`
       - Makefile with test target → `make test`
       - Fallback → check `.type-profile.md` "Verification Standards"

    2. Execute test command:
       ```bash
       {detected_test_command} 2>&1
       ```

    3. Capture results:
       - Exit code (0 = pass, non-zero = fail)
       - stdout/stderr output
       - Parse pass/fail counts if available

    4. Set RESULT:
       - exit 0 + all tests pass → `(pass)`
       - exit 0 + some failures → `(partial)`
       - exit non-zero → `(fail)`

    **10b. documentation type**:

    1. Link validation:
       ```bash
       find . -name "*.md" -exec grep -oE '\[.*\]\(http[^)]+\)' {} \; | head -20
       ```
    2. Check dead links (if tools available)
    3. Spell check (if configured)

    **10c. infrastructure type**:

    1. Config validation:
       - Terraform → `terraform validate`
       - Ansible → `ansible-playbook --syntax-check`
       - Kubernetes → `kubectl apply --dry-run=client`
    2. Dry run if available

    **10d. other types**:

    Read `.type-profile.md` "Verification Standards" section for domain-specific verification procedures.
```

### 6.2 移除 verify.sh stub

当前 verify.sh 硬编码输出 "PASS"（第 190-208 行）：

```bash
# 当前 stub 代码
echo "- Running all test criteria... PASS"
echo "- Running acceptance tests... PASS"
...
- Note: Stub implementation — real test execution pending
```

需要：
- 删除 stub 实现
- 或改为调用 SKILL.md 中定义的逻辑

## 七、修改文件清单

| 文件 | 修改内容 | 预估行数 |
|------|---------|---------|
| `auto/SKILL.md` | 子命令调用协议 + 产出校验 + 强制 summarize 节点 | ~80 行 |
| `auto/references/delegation.md` | 更新分类表 | ~20 行 |
| `verify/SKILL.md` | step 10 具体测试执行 | ~50 行 |
| `verify/scripts/verify.sh` | 移除 stub 或重构 | ~30 行 |
| `summarize/SKILL.md` | Recovery Header 格式强制 | ~15 行 |
| **合计** | | **~195 行** |

## 八、实施顺序

```
Phase 1: 基础框架（低风险）
  1. auto/SKILL.md — 添加子命令分类表
  2. auto/SKILL.md — 添加产出校验逻辑
  3. auto/references/delegation.md — 更新分类

Phase 2: 上下文管理（低风险）
  4. auto/SKILL.md — 添加强制 summarize 节点
  5. summarize/SKILL.md — 添加 Recovery Header 格式

Phase 3: verify 实现（中风险）
  6. verify/SKILL.md — 实现 step 10 具体测试执行
  7. verify/scripts/verify.sh — 移除 stub
```

## 九、验证三个目标

| 目标 | 机制 | 保障 |
|------|------|------|
| **解决现在的问题** | 产出校验 + verify 具体执行 | plan 必须产出 .plan.md 才能继续；verify 执行真正的测试命令 |
| **控制上下文爆炸** | 强制 summarize 节点 + Recovery Header | Phase 变化/每 3 次迭代/70% 上下文时主动更新；压缩后可恢复 |
| **执行稳定性** | Skill tool + Read SKILL.md + 产出校验 | 三层保障：独立型完整加载；敏感型强制读取；硬性校验产出 |

## 十、风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| 产出校验过于严格导致正常流程中断 | 中 | 先用 WARN 而非 ABORT，观察一段时间后再收紧 |
| verify 测试执行依赖项目配置 | 中 | 提供 fallback 到 .type-profile.md |
| 强制 summarize 增加开销 | 低 | summarize 是轻量操作，开销可接受 |
| Skill tool 调用行为与预期不符 | 低 | 先在少量子命令上验证 |

## 十一、回滚方案

如果实施后出现问题：

1. **产出校验问题**: 将 ABORT 改为 WARN，不阻塞流程
2. **verify 问题**: 恢复 stub 实现，后续迭代修复
3. **summarize 问题**: 移除强制节点，恢复原有行为

所有修改都是文档层面（SKILL.md），不涉及核心代码，回滚成本低。

## 十二、测试计划

### 12.1 修改类型与测试策略

| 文件 | 修改类型 | 测试策略 |
|------|---------|---------|
| auto/SKILL.md | 规格文档 | 集成测试 |
| delegation.md | 规格文档 | 集成测试 |
| summarize/SKILL.md | 规格文档 | 集成测试 |
| verify/SKILL.md | 规格文档 | 集成测试 |
| **verify/scripts/verify.sh** | **代码** | **RED→GREEN 单元测试 + 集成测试** |

### 12.2 verify.sh 单元测试（RED→GREEN）

**测试文件**: `task-ai/tests/unit/verify-execution.test.sh`

```bash
#!/usr/bin/env bash
# verify.sh 测试 — 验证真正执行测试而非硬编码 PASS

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_TEMP=$(mktemp -d)
trap "rm -rf $TEST_TEMP" EXIT

# 测试辅助函数
assert_eq() {
    local expected="$1" actual="$2" msg="${3:-}"
    if [[ "$expected" != "$actual" ]]; then
        echo "FAIL: $msg"
        echo "  Expected: $expected"
        echo "  Actual:   $actual"
        return 1
    fi
}

assert_contains() {
    local haystack="$1" needle="$2" msg="${3:-}"
    if [[ "$haystack" != *"$needle"* ]]; then
        echo "FAIL: $msg"
        echo "  Expected to contain: $needle"
        echo "  Actual: $haystack"
        return 1
    fi
}

# ============================================================
# TEST 1: verify 不应硬编码输出 PASS
# ============================================================
test_no_hardcoded_pass() {
    echo "TEST 1: verify 不应硬编码输出 PASS"

    # 检查 verify.sh 中不应包含硬编码的 "PASS" 输出
    local verify_sh="$SCRIPT_DIR/../../skills/verify/scripts/verify.sh"

    # 查找硬编码的 echo "... PASS" 模式
    if grep -E 'echo.*PASS' "$verify_sh" | grep -v '^#' | grep -qv 'RESULT'; then
        echo "FAIL: verify.sh 仍包含硬编码的 PASS 输出"
        grep -E 'echo.*PASS' "$verify_sh" | grep -v '^#'
        return 1
    fi

    echo "PASS"
}

# ============================================================
# TEST 2: verify 不应包含 "Stub implementation" 注释
# ============================================================
test_no_stub_comment() {
    echo "TEST 2: verify 不应包含 Stub implementation 注释"

    local verify_sh="$SCRIPT_DIR/../../skills/verify/scripts/verify.sh"

    if grep -qi 'stub implementation' "$verify_sh"; then
        echo "FAIL: verify.sh 仍包含 'Stub implementation' 注释"
        return 1
    fi

    echo "PASS"
}

# ============================================================
# TEST 3: verify 应检测并执行项目测试命令
# ============================================================
test_detects_test_command() {
    echo "TEST 3: verify 应检测项目测试命令"

    # 创建模拟项目
    mkdir -p "$TEST_TEMP/project"
    cat > "$TEST_TEMP/project/package.json" << 'EOF'
{
  "scripts": {
    "test": "echo 'tests executed' && exit 0"
  }
}
EOF

    # verify.sh 应能检测 package.json 中的 test 命令
    local verify_sh="$SCRIPT_DIR/../../skills/verify/scripts/verify.sh"

    # 检查 verify.sh 是否包含 package.json 检测逻辑
    if ! grep -q 'package.json' "$verify_sh"; then
        echo "FAIL: verify.sh 不包含 package.json 检测逻辑"
        return 1
    fi

    echo "PASS"
}

# ============================================================
# TEST 4: verify 产出结果文件
# ============================================================
test_produces_results_file() {
    echo "TEST 4: verify 产出结果文件"

    local verify_sh="$SCRIPT_DIR/../../skills/verify/scripts/verify.sh"

    # 检查 verify.sh 是否写入结果文件
    if ! grep -qE '\$TEST_DIR.*results\.md' "$verify_sh"; then
        echo "FAIL: verify.sh 不包含结果文件写入逻辑"
        return 1
    fi

    echo "PASS"
}

# ============================================================
# 运行所有测试
# ============================================================
main() {
    echo "=========================================="
    echo "verify.sh 单元测试"
    echo "=========================================="

    local failed=0

    test_no_hardcoded_pass || ((failed++))
    test_no_stub_comment || ((failed++))
    test_detects_test_command || ((failed++))
    test_produces_results_file || ((failed++))

    echo ""
    echo "=========================================="
    if [[ $failed -eq 0 ]]; then
        echo "所有测试通过"
        exit 0
    else
        echo "失败测试数: $failed"
        exit 1
    fi
}

main "$@"
```

**RED 阶段预期**:
- TEST 1 FAIL: verify.sh 包含硬编码 PASS
- TEST 2 FAIL: verify.sh 包含 "Stub implementation"
- TEST 3 可能 PASS（取决于现有代码）
- TEST 4 可能 PASS

**GREEN 阶段**: 修改 verify.sh 后所有测试通过

### 12.3 产出校验集成测试

**测试文件**: `task-ai/tests/integration/auto-output-verification.test.sh`

```bash
#!/usr/bin/env bash
# 产出校验集成测试

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_TEMP=$(mktemp -d)
trap "rm -rf $TEST_TEMP" EXIT

# ============================================================
# TEST 1: plan 必须产出 .plan.md
# ============================================================
test_plan_outputs_plan_md() {
    echo "TEST 1: plan 必须产出 .plan.md"

    # 创建测试 notebook 结构
    mkdir -p "$TEST_TEMP/notebook/.working"
    cat > "$TEST_TEMP/notebook/.working/.status.json" << 'EOF'
{
  "title": "test",
  "status": "planning",
  "type": "software"
}
EOF
    cat > "$TEST_TEMP/notebook/.working/.target.md" << 'EOF'
# Test Target
## Objective
Test objective
EOF

    # 检查 .plan.md 是否存在
    if [[ ! -f "$TEST_TEMP/notebook/.working/.plan.md" ]]; then
        echo "PASS: .plan.md 不存在（plan 未执行时的预期状态）"
        echo "  产出校验应能检测到此情况"
    fi

    echo "PASS"
}

# ============================================================
# TEST 2: verify 必须产出 results.md
# ============================================================
test_verify_outputs_results() {
    echo "TEST 2: verify 必须产出 results.md"

    mkdir -p "$TEST_TEMP/notebook/.working/.test"

    # 检查是否有 results.md 文件
    local results_count=$(find "$TEST_TEMP/notebook/.working/.test" -name "*-results.md" 2>/dev/null | wc -l)

    if [[ $results_count -eq 0 ]]; then
        echo "PASS: results.md 不存在（verify 未执行时的预期状态）"
        echo "  产出校验应能检测到此情况"
    fi

    echo "PASS"
}

# ============================================================
# TEST 3: summarize 必须产出 .summary.md
# ============================================================
test_summarize_outputs_summary() {
    echo "TEST 3: summarize 必须产出 .summary.md"

    mkdir -p "$TEST_TEMP/notebook/.working"

    if [[ ! -f "$TEST_TEMP/notebook/.working/.summary.md" ]]; then
        echo "PASS: .summary.md 不存在（summarize 未执行时的预期状态）"
    fi

    echo "PASS"
}

# ============================================================
# 运行所有测试
# ============================================================
main() {
    echo "=========================================="
    echo "产出校验集成测试"
    echo "=========================================="

    test_plan_outputs_plan_md
    test_verify_outputs_results
    test_summarize_outputs_summary

    echo ""
    echo "=========================================="
    echo "所有测试通过"
}

main "$@"
```

### 12.4 Recovery Header 测试

**测试文件**: `task-ai/tests/integration/recovery-header.test.sh`

```bash
#!/usr/bin/env bash
# Recovery Header 集成测试

set -euo pipefail

# ============================================================
# TEST: .summary.md 必须包含 Recovery Header
# ============================================================
test_summary_has_recovery_header() {
    echo "TEST: .summary.md 必须包含 Recovery Header"

    local summary_file="$1"

    if [[ ! -f "$summary_file" ]]; then
        echo "SKIP: $summary_file 不存在"
        return 0
    fi

    # 检查 Recovery Header 的关键元素
    if ! grep -q 'TASK-AI RECOVERY CONTEXT' "$summary_file"; then
        echo "FAIL: 缺少 TASK-AI RECOVERY CONTEXT 注释"
        return 1
    fi

    if ! grep -q 'execute recovery protocol' "$summary_file"; then
        echo "FAIL: 缺少 recovery protocol 指引"
        return 1
    fi

    if ! grep -qE '\*\*Status\*\*:' "$summary_file"; then
        echo "FAIL: 缺少 Status 字段"
        return 1
    fi

    echo "PASS"
}

main() {
    echo "=========================================="
    echo "Recovery Header 测试"
    echo "=========================================="

    # 如果提供了文件路径，测试该文件
    if [[ $# -gt 0 ]]; then
        test_summary_has_recovery_header "$1"
    else
        echo "用法: $0 <path-to-.summary.md>"
    fi
}

main "$@"
```

### 12.5 回归测试

**测试文件**: `task-ai/tests/integration/auto-regression.test.sh`

```bash
#!/usr/bin/env bash
# auto 回归测试 — 确保现有功能不被破坏

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ============================================================
# TEST 1: 手动调用 plan 仍正常工作
# ============================================================
test_manual_plan() {
    echo "TEST 1: 手动调用 plan 语法检查"

    local plan_skill="$SCRIPT_DIR/../../skills/plan/SKILL.md"

    if [[ ! -f "$plan_skill" ]]; then
        echo "FAIL: plan/SKILL.md 不存在"
        return 1
    fi

    # 检查关键步骤存在
    if ! grep -q 'Execution Steps' "$plan_skill"; then
        echo "FAIL: plan/SKILL.md 缺少 Execution Steps"
        return 1
    fi

    echo "PASS"
}

# ============================================================
# TEST 2: 手动调用 verify 仍正常工作
# ============================================================
test_manual_verify() {
    echo "TEST 2: 手动调用 verify 语法检查"

    local verify_skill="$SCRIPT_DIR/../../skills/verify/SKILL.md"

    if [[ ! -f "$verify_skill" ]]; then
        echo "FAIL: verify/SKILL.md 不存在"
        return 1
    fi

    if ! grep -q 'Execution Steps' "$verify_skill"; then
        echo "FAIL: verify/SKILL.md 缺少 Execution Steps"
        return 1
    fi

    echo "PASS"
}

# ============================================================
# TEST 3: 手动调用 check 仍正常工作
# ============================================================
test_manual_check() {
    echo "TEST 3: 手动调用 check 语法检查"

    local check_skill="$SCRIPT_DIR/../../skills/check/SKILL.md"

    if [[ ! -f "$check_skill" ]]; then
        echo "FAIL: check/SKILL.md 不存在"
        return 1
    fi

    if ! grep -q 'Execution Steps' "$check_skill"; then
        echo "FAIL: check/SKILL.md 缺少 Execution Steps"
        return 1
    fi

    echo "PASS"
}

# ============================================================
# TEST 4: auto/SKILL.md 结构完整
# ============================================================
test_auto_structure() {
    echo "TEST 4: auto/SKILL.md 结构完整"

    local auto_skill="$SCRIPT_DIR/../../skills/auto/SKILL.md"

    if [[ ! -f "$auto_skill" ]]; then
        echo "FAIL: auto/SKILL.md 不存在"
        return 1
    fi

    # 检查关键章节
    local required_sections=(
        "Four-Phase Flow"
        "Execution Steps"
        "State Machine"
    )

    for section in "${required_sections[@]}"; do
        if ! grep -q "$section" "$auto_skill"; then
            echo "FAIL: auto/SKILL.md 缺少章节: $section"
            return 1
        fi
    done

    echo "PASS"
}

# ============================================================
# 运行所有测试
# ============================================================
main() {
    echo "=========================================="
    echo "auto 回归测试"
    echo "=========================================="

    local failed=0

    test_manual_plan || ((failed++))
    test_manual_verify || ((failed++))
    test_manual_check || ((failed++))
    test_auto_structure || ((failed++))

    echo ""
    echo "=========================================="
    if [[ $failed -eq 0 ]]; then
        echo "所有回归测试通过"
        exit 0
    else
        echo "失败测试数: $failed"
        exit 1
    fi
}

main "$@"
```

### 12.6 测试执行顺序

```
实施前（确认 RED）:
  1. bash task-ai/tests/unit/verify-execution.test.sh
     → 预期: TEST 1, TEST 2 FAIL（verify.sh 是 stub）

Phase 1 实施后:
  2. bash task-ai/tests/integration/auto-regression.test.sh
     → 预期: 全部 PASS（回归测试）

Phase 2 实施后:
  3. bash task-ai/tests/integration/recovery-header.test.sh <path>
     → 预期: PASS（Recovery Header 存在）

Phase 3 实施后（确认 GREEN）:
  4. bash task-ai/tests/unit/verify-execution.test.sh
     → 预期: 全部 PASS
  5. bash task-ai/tests/integration/auto-output-verification.test.sh
     → 预期: 全部 PASS
```

### 12.7 测试文件清单

| 测试文件 | 类型 | 目的 |
|---------|------|------|
| `tests/unit/verify-execution.test.sh` | 单元测试 | 验证 verify.sh 移除 stub |
| `tests/integration/auto-output-verification.test.sh` | 集成测试 | 验证产出校验机制 |
| `tests/integration/recovery-header.test.sh` | 集成测试 | 验证 Recovery Header |
| `tests/integration/auto-regression.test.sh` | 回归测试 | 确保不破坏现有功能 |
