#!/usr/bin/env python3
"""Round 19: D1/D6 audit — auto SKILL.md output constraint + init documentation."""
import sys

FAIL = 0

# F57: auto/SKILL.md Phase 3 must mention .deliverables/ output requirement
with open("task-ai/skills/auto/SKILL.md") as f:
    auto_skill = f.read()

phase3_start = auto_skill.find("Phase 3: Execution")
if phase3_start > 0:
    # Check within ~500 chars of Phase 3 description
    phase3_section = auto_skill[phase3_start:phase3_start+600]
    if ".deliverables/" in phase3_section or ".deliverables" in phase3_section:
        print("PASS F57: auto/SKILL.md Phase 3 mentions .deliverables/ output")
    else:
        print("FAIL F57: auto/SKILL.md Phase 3 missing .deliverables/ output requirement")
        FAIL += 1
else:
    print("FAIL F57: auto/SKILL.md missing Phase 3 section")
    FAIL += 1

# F58: init/SKILL.md should mention .deliverables/ as notebook-level directory
with open("task-ai/skills/init/SKILL.md") as f:
    init_skill = f.read()

# Check in the directory structure or notes section
if ".deliverables/" in init_skill:
    print("PASS F58: init/SKILL.md mentions .deliverables/")
else:
    print("FAIL F58: init/SKILL.md missing .deliverables/ documentation")
    FAIL += 1

print(f"\n{'ALL PASSED' if FAIL == 0 else f'{FAIL} FAILED'}")
sys.exit(FAIL)
