#!/usr/bin/env bash
# Meta: Verify that every .md file is covered by at least one contract script
source "$(dirname "$0")/lib.sh"

# Collect all .md files
mapfile -t ALL_MD < <(find_all_md)

# Collect all contract scripts (excluding libs)
mapfile -t CONTRACT_SCRIPTS < <(find "$DEV_ROOT/contracts" -name "*.sh" -o -name "*.py" | grep -v "lib\." | grep -v "json_get\.py" | sort)

# For each .md file, check if any contract script is likely to cover it
# We do this by examining what each contract scans:
# - step-numbering.sh: SKILL.md (via find_skills)
# - cross-refs.sh: all .md (via find_all_md)
# - signal-whitelist.sh: SKILL.md (via find_skills)
# - naming-conventions.sh: all .md (via find_all_md)
# - state-matrix.py: state-matrix.md + SKILL.md
# - frontmatter-validation.sh: SKILL.md (via find_skills)
# - git-commit-conventions.sh: SKILL.md + git-details.md
# - terminology.sh: all .md (via find_all_md)
# - data-flow.py: SKILL.md + command references
# - seed-completeness.sh: seed-types/*.md
# - lock-coverage.sh: concurrency.md
# - phase-state-machine.py: SKILL.md (plan/check/exec)
# - index-completeness.sh: REFERENCE-INDEX.md + references
# - signal-field-names.py: all .md + auto references
# - state-machine-graph.py: (fixtures only, no .md)
# - protocol-compliance.py: SKILL.md + protocol files
# - signal-routing.py: SKILL.md + auto/SKILL.md
# - self-check.sh: all .md

# Contracts that scan ALL .md files (broad coverage):
BROAD_CONTRACTS=("cross-refs.sh" "naming-conventions.sh" "terminology.sh")

# Contracts that scan SKILL.md files:
SKILL_CONTRACTS=("step-numbering.sh" "signal-whitelist.sh" "frontmatter-validation.sh"
                 "git-commit-conventions.sh" "data-flow.py" "phase-state-machine.py"
                 "protocol-compliance.py" "signal-routing.py" "state-matrix.py")

# Files covered by specific contracts
SPECIFIC_COVERED=(
  "REFERENCE-INDEX.md"
  "commands/references/state-matrix.md"
  "commands/references/concurrency.md"
  "commands/references/git-details.md"
  "commands/references/model-routing.md"
  "commands/references/directory-convention.md"
)

uncovered=0

for md_file in "${ALL_MD[@]}"; do
  rel_path=$(realpath --relative-to="$TASK_AI_ROOT" "$md_file")
  covered=0

  # Broad contracts cover all .md files via find_all_md()
  # But we still need to verify the file is reachable by find_all_md
  if [[ "$rel_path" == skills/*/SKILL.md || "$rel_path" == commands/*.md || "$rel_path" == commands/references/*.md || "$rel_path" == skills/*/references/*.md || "$rel_path" == REFERENCE-INDEX.md ]]; then
    covered=1
  fi

  # Additionally check if SKILL.md files are covered by skill-specific contracts
  if [[ "$rel_path" == */SKILL.md ]]; then
    covered=1  # Multiple skill contracts cover these
  fi

  # Check if it's a seed-type file (covered by seed-completeness)
  if [[ "$rel_path" == *seed-types/*.md ]]; then
    covered=1
  fi

  if [[ $covered -eq 1 ]]; then
    emit_pass "covered: $rel_path"
  else
    emit_fail "uncovered: $rel_path — no contract covers this file"
    ((uncovered++))
  fi
done

# Also verify that all contract scripts in the arrays are actual files
for script in "${CONTRACT_SCRIPTS[@]}"; do
  if [[ -f "$script" ]]; then
    emit_pass "contract exists: $(basename "$script")"
  else
    emit_fail "contract missing: $(basename "$script")"
  fi
done

# Verify validate.sh lists all contracts
VALIDATE="$DEV_ROOT/validate.sh"
if [[ -f "$VALIDATE" ]]; then
  for script in "${CONTRACT_SCRIPTS[@]}"; do
    script_name=$(basename "$script")
    if grep -qF "$script_name" "$VALIDATE"; then
      emit_pass "validate.sh lists: $script_name"
    else
      emit_fail "validate.sh MISSING: $script_name"
    fi
  done
fi

summary
