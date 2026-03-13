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
