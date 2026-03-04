#!/bin/bash
# task-ai 六维审查修复回归测试套件
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "===== task-ai 六维审查修复回归测试 ====="
echo ""

PASSED=0
FAILED=0

run_test() {
    local name="$1"
    local script="$2"
    echo -n "[$name] "
    if bash "$TESTS_DIR/unit/$script" >/dev/null 2>&1; then
        echo "✓ PASS"
        ((PASSED++)) || true
    else
        echo "✗ FAIL"
        ((FAILED++)) || true
    fi
}

echo "--- Phase 1: Shell 基础设施 ---"
run_test "C-SHELL-1: set -e" "shell-set-e.test.sh"
run_test "C-PATH-1: 路径约定" "path-convention.test.sh"

echo ""
echo "--- Phase 2: 安全加固 ---"
run_test "C-SEC-1: rm -rf 拦截" "security-rm-rf.test.sh"
run_test "H-SEC-1: 环境变量" "security-env-vars.test.sh"
run_test "H-SEC-2: 两段式加载" "security-two-stage.test.sh"

echo ""
echo "--- Phase 3: 核心逻辑 ---"
run_test "C-REPORT-1: 无蒸馏代码" "report-no-distill.test.sh"
run_test "C-MERGE-*: merge 实现" "merge-executes.test.sh"
run_test "C-ATOMIC-1: 原子写入" "atomic-write.test.sh"

echo ""
echo "--- Phase 4: 功能完善 ---"
run_test "H-AUTO-1: ACTION 默认值" "auto-action-default.test.sh"
run_test "H-AUTO-2: draft 路由" "auto-draft-routing.test.sh"
run_test "H-EXEC-1: 动态步骤数" "exec-dynamic-steps.test.sh"
run_test "H-PLAN-1: 备份命名" "plan-backup-naming.test.sh"
run_test "H-INIT-1: 回滚机制" "init-rollback.test.sh"
run_test "H-MAINTAIN-1: compact 追加" "maintain-compact-append.test.sh"
run_test "H-READ-1: 扩展注入检测" "read-injection-extended.test.sh"

echo ""
echo "--- Phase 5: 性能优化 ---"
run_test "C-PERF-1: 事件日志轮转" "delegation-events-rotation.test.sh"
run_test "C-PERF-2: 增量索引" "rebuild-incremental.test.sh"

echo ""
echo "--- Phase 6: 文档一致性 ---"
run_test "C-DOC-1/H-DOC-1/2: 文档一致性" "doc-language.test.sh"
run_test "H-DOC-3: 无中文注释" "no-chinese-comments.test.sh"

echo ""
echo "--- Phase 7: 扩展功能 ---"
run_test "SKILL-HOTRELOAD: 热重载支持" "skill-hotreload.test.sh"
run_test "SKILL-SANDBOX: 原生沙箱验证" "skill-sandbox.test.sh"

echo ""
echo "====================================="
echo "结果: $PASSED 通过, $FAILED 失败"
echo "====================================="

exit $FAILED
