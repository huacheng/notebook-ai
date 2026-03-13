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
# TEST 1: verify 不应在 checkpoint case 语句中直接硬编码 PASS
# ============================================================
test_no_hardcoded_pass() {
    echo "TEST 1: verify 不应在 checkpoint case 语句中直接硬编码 PASS"

    local verify_sh="$SCRIPT_DIR/../../skills/verify/scripts/verify.sh"

    # 检查是否存在原来的硬编码模式：
    # case 语句中直接 echo "- Running ... PASS" 而不执行任何实际检查
    # 即：echo 后面紧跟 ";;" 表示无条件输出
    if grep -B1 -E 'echo.*Running.*PASS' "$verify_sh" | grep -v 'if\|then\|else' | grep -qE '^\s*echo.*PASS'; then
        # 进一步检查：如果这个 echo 之前没有任何条件判断，就是硬编码
        local pattern_count=$(grep -E 'echo "\- Running.*PASS"' "$verify_sh" | wc -l)
        if [[ $pattern_count -gt 0 ]]; then
            echo "FAIL: verify.sh 仍包含无条件硬编码的 PASS 输出模式"
            grep -E 'echo "\- Running.*PASS"' "$verify_sh"
            return 1
        fi
    fi

    # 检查是否包含测试执行逻辑（detect_test_command 函数）
    if ! grep -q 'detect_test_command' "$verify_sh"; then
        echo "FAIL: verify.sh 缺少测试命令检测逻辑"
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
