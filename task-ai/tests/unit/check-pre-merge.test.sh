#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK_SH="$SCRIPT_DIR/skills/check/scripts/check.sh"

# Red: check.sh does not handle pre-merge checkpoint yet
# grep for "pre-merge" in check.sh to verify it's handled
if ! grep -q 'pre-merge' "$CHECK_SH"; then
    echo "FAIL (expected Red): check.sh has no pre-merge handler"
    exit 1
fi

echo "PASS: check.sh has pre-merge handler"
