#!/usr/bin/env bash
# L2: Check that seed-type files have a ### Verification Cycle section
# Priority: P0 (software) = FAIL if missing, others = WARN
source "$(dirname "$0")/lib.sh"

SEED_DIR="$TASK_AI_ROOT/skills/init/references/seed-types"

if [[ ! -d "$SEED_DIR" ]]; then
  emit_fail "seed-types directory not found at $SEED_DIR"
  summary; exit $?
fi

# P0: must have Verification Cycle
P0_TYPES=("software")
# P1: should have it
P1_TYPES=("data-pipeline" "ml")
# P2: nice to have
P2_TYPES=("documentation" "infrastructure")

while IFS= read -r seed_file; do
  seed_name=$(basename "$seed_file" .md)

  # Skip summary/index files
  [[ "$seed_name" == ".summary" || "$seed_name" == ".index" ]] && continue

  # Check for ### Verification Cycle section
  if grep -q "^### Verification Cycle" "$seed_file"; then
    emit_pass "$seed_name: has Verification Cycle section"
    continue
  fi

  # Determine priority level
  priority="P3"
  for p0 in "${P0_TYPES[@]}"; do
    [[ "$seed_name" == "$p0" ]] && priority="P0"
  done
  for p1 in "${P1_TYPES[@]}"; do
    [[ "$seed_name" == "$p1" ]] && priority="P1"
  done
  for p2 in "${P2_TYPES[@]}"; do
    [[ "$seed_name" == "$p2" ]] && priority="P2"
  done

  case "$priority" in
    P0) emit_fail "$seed_name: MISSING Verification Cycle section (P0 — required)" ;;
    P1) emit_fail "$seed_name: MISSING Verification Cycle section (P1 — should have)" ;;
    P2) emit_warn "$seed_name: missing Verification Cycle section (P2 — nice to have)" ;;
    P3) emit_warn "$seed_name: missing Verification Cycle section (P3 — optional)" ;;
  esac
done < <(find "$SEED_DIR" -name "*.md" -type f | sort)

summary
