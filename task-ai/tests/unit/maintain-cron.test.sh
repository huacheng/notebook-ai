#!/usr/bin/env bash
# Test: maintain.sh --install-cron / --uninstall-cron
# Uses a fake crontab to avoid modifying system crontab during tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_AI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MAINTAIN_SH="$TASK_AI_ROOT/skills/library/scripts/maintain.sh"

PASS=0
FAIL=0
pass() { echo "✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "✗ $1" >&2; FAIL=$((FAIL + 1)); }

# ─────────────────────────────────────────────────────────────────────────────
# Setup: fake crontab commands to avoid touching real crontab
# ─────────────────────────────────────────────────────────────────────────────
setup() {
    TEST_DIR=$(mktemp -d)
    export NB_WORKSPACES_ROOT="$TEST_DIR/project"
    export NB_WORKSPACES_LIBRARY="$TEST_DIR/project/.library"
    mkdir -p "$NB_WORKSPACES_LIBRARY"

    # Fake crontab file
    FAKE_CRONTAB="$TEST_DIR/fake-crontab"
    touch "$FAKE_CRONTAB"

    # Create fake crontab binary that reads/writes our file
    FAKE_BIN="$TEST_DIR/bin"
    mkdir -p "$FAKE_BIN"
    cat > "$FAKE_BIN/crontab" <<'FAKESCRIPT'
#!/usr/bin/env bash
CRONTAB_FILE="${FAKE_CRONTAB_FILE:-/tmp/fake-crontab}"
if [[ "${1:-}" == "-l" ]]; then
    cat "$CRONTAB_FILE" 2>/dev/null || true
elif [[ "${1:-}" == "-" ]]; then
    cat > "$CRONTAB_FILE"
else
    echo "fake crontab: unknown args: $@" >&2
    exit 1
fi
FAKESCRIPT
    chmod +x "$FAKE_BIN/crontab"

    export PATH="$FAKE_BIN:$PATH"
    export FAKE_CRONTAB_FILE="$FAKE_CRONTAB"
}

teardown() {
    rm -rf "$TEST_DIR"
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 1: --install-cron adds entry to crontab
# ─────────────────────────────────────────────────────────────────────────────
test_install_cron() {
    setup

    OUTPUT=$(bash "$MAINTAIN_SH" --install-cron 2>&1 || true)

    if grep -q "maintain.sh.*--scheduled" "$FAKE_CRONTAB"; then
        pass "--install-cron adds scheduled entry to crontab"
    else
        fail "--install-cron did not add entry (output: $OUTPUT)"
    fi

    # Should contain NB_WORKSPACES_ROOT path
    if grep -q "$TEST_DIR/project" "$FAKE_CRONTAB"; then
        pass "Cron entry contains correct NB_WORKSPACES_ROOT"
    else
        fail "Cron entry missing NB_WORKSPACES_ROOT path"
    fi

    # Should have identifying comment tag
    if grep -q "# task-ai:scheduled" "$FAKE_CRONTAB"; then
        pass "Cron entry has identifying tag"
    else
        fail "Cron entry missing identifying tag"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 2: --install-cron is idempotent (no duplicate entries)
# ─────────────────────────────────────────────────────────────────────────────
test_install_cron_idempotent() {
    setup

    bash "$MAINTAIN_SH" --install-cron >/dev/null 2>&1 || true
    bash "$MAINTAIN_SH" --install-cron >/dev/null 2>&1 || true

    COUNT=$(grep -c "task-ai:scheduled" "$FAKE_CRONTAB" 2>/dev/null || true)
    COUNT="${COUNT:-0}"
    COUNT=$(echo "$COUNT" | tr -d '[:space:]')
    if [[ "$COUNT" -eq 1 ]]; then
        pass "--install-cron is idempotent (1 entry after 2 calls)"
    else
        fail "--install-cron created $COUNT entries (expected 1)"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 3: --install-cron preserves existing crontab entries
# ─────────────────────────────────────────────────────────────────────────────
test_install_preserves_existing() {
    setup

    # Pre-existing cron entry
    echo "0 1 * * * /usr/bin/some-other-job # my-job" > "$FAKE_CRONTAB"

    bash "$MAINTAIN_SH" --install-cron >/dev/null 2>&1 || true

    if grep -q "some-other-job" "$FAKE_CRONTAB"; then
        pass "--install-cron preserves existing entries"
    else
        fail "--install-cron removed existing entries"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 4: --uninstall-cron removes the entry
# ─────────────────────────────────────────────────────────────────────────────
test_uninstall_cron() {
    setup

    bash "$MAINTAIN_SH" --install-cron >/dev/null 2>&1 || true
    bash "$MAINTAIN_SH" --uninstall-cron >/dev/null 2>&1 || true

    if grep -q "task-ai:scheduled" "$FAKE_CRONTAB"; then
        fail "--uninstall-cron did not remove entry"
    else
        pass "--uninstall-cron removes scheduled entry"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 5: --uninstall-cron preserves other entries
# ─────────────────────────────────────────────────────────────────────────────
test_uninstall_preserves_existing() {
    setup

    echo "0 1 * * * /usr/bin/some-other-job # my-job" > "$FAKE_CRONTAB"
    bash "$MAINTAIN_SH" --install-cron >/dev/null 2>&1 || true
    bash "$MAINTAIN_SH" --uninstall-cron >/dev/null 2>&1 || true

    if grep -q "some-other-job" "$FAKE_CRONTAB"; then
        pass "--uninstall-cron preserves other entries"
    else
        fail "--uninstall-cron removed unrelated entries"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 6: --uninstall-cron is safe when no entry exists
# ─────────────────────────────────────────────────────────────────────────────
test_uninstall_noop() {
    setup

    OUTPUT=$(bash "$MAINTAIN_SH" --uninstall-cron 2>&1 || true)

    if echo "$OUTPUT" | grep -qiE "no.*entry|not found|nothing"; then
        pass "--uninstall-cron handles missing entry gracefully"
    else
        fail "--uninstall-cron unexpected output (output: $OUTPUT)"
    fi

    teardown
}

# ─────────────────────────────────────────────────────────────────────────────
# Run all tests
# ─────────────────────────────────────────────────────────────────────────────
echo "=== maintain.sh --install-cron / --uninstall-cron Tests ==="
test_install_cron
test_install_cron_idempotent
test_install_preserves_existing
test_uninstall_cron
test_uninstall_preserves_existing
test_uninstall_noop

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
