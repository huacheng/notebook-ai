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

    # 检查关键步骤存在
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
# TEST 4: summarize 包含 Recovery Header 指令
# ============================================================
test_summarize_recovery_header() {
    echo "TEST 4: summarize 包含 Recovery Header 指令"

    local summarize_skill="$SCRIPT_DIR/../../skills/summarize/SKILL.md"

    if [[ ! -f "$summarize_skill" ]]; then
        echo "FAIL: summarize/SKILL.md 不存在"
        return 1
    fi

    # 检查是否包含 Recovery Header 相关指令
    if ! grep -qi 'recovery' "$summarize_skill"; then
        echo "FAIL: summarize/SKILL.md 不包含 Recovery Header 指令"
        return 1
    fi

    echo "PASS"
}

# ============================================================
# TEST 5: auto/SKILL.md 包含子命令分类
# ============================================================
test_auto_subcommand_classification() {
    echo "TEST 5: auto/SKILL.md 包含子命令分类"

    local auto_skill="$SCRIPT_DIR/../../skills/auto/SKILL.md"

    if [[ ! -f "$auto_skill" ]]; then
        echo "FAIL: auto/SKILL.md 不存在"
        return 1
    fi

    # 检查是否包含子命令分类
    if ! grep -qi 'independent' "$auto_skill" || ! grep -qi 'context-sensitive' "$auto_skill"; then
        echo "FAIL: auto/SKILL.md 不包含子命令分类（Independent/Context-sensitive）"
        return 1
    fi

    echo "PASS"
}

# ============================================================
# TEST 6: auto/SKILL.md 包含产出校验
# ============================================================
test_auto_output_verification() {
    echo "TEST 6: auto/SKILL.md 包含产出校验"

    local auto_skill="$SCRIPT_DIR/../../skills/auto/SKILL.md"

    if [[ ! -f "$auto_skill" ]]; then
        echo "FAIL: auto/SKILL.md 不存在"
        return 1
    fi

    # 检查是否包含产出校验相关内容
    if ! grep -qi 'output.*verif' "$auto_skill" && ! grep -qi '产出.*校验' "$auto_skill"; then
        echo "FAIL: auto/SKILL.md 不包含产出校验机制"
        return 1
    fi

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
    test_summarize_recovery_header || ((failed++))
    test_auto_subcommand_classification || ((failed++))
    test_auto_output_verification || ((failed++))

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
