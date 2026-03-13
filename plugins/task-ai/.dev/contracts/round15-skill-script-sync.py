#!/usr/bin/env python3
"""Round 15: SKILL.md vs merge.sh consistency."""
import sys

FAIL = 0

with open("task-ai/skills/merge/SKILL.md") as f:
    skill = f.read()

# F44: Execution steps must mention checkout back to task branch
if "checkout" in skill.lower() and "task branch" in skill.lower() and "state" in skill.lower():
    # Check execution steps section specifically
    exec_steps = skill[skill.find("## Execution Steps"):]
    if "task branch" in exec_steps or "checkout back" in exec_steps.lower():
        print("PASS F44: Execution steps mention checkout back to task branch")
    else:
        print("FAIL F44: Execution steps missing 'checkout back to task branch' step")
        FAIL += 1
else:
    print("FAIL F44: SKILL.md missing checkout-back-to-task-branch documentation")
    FAIL += 1

# F45: Phase 3 should match actual merge.sh behavior (state transition only, no .summary.md/.target.md writes)
phase3_section = skill[skill.find("### Phase 3"):]
phase3_end = phase3_section.find("## ")  # next section
phase3 = phase3_section[:phase3_end] if phase3_end > 0 else phase3_section[:500]
# merge.sh Phase 3 only does: state transition + signal + git commit
# It does NOT write .summary.md or update .target.md
if "Write `.summary.md`" in phase3:
    print("FAIL F45: Phase 3 claims merge writes .summary.md — merge.sh does not do this")
    FAIL += 1
else:
    print("PASS F45: Phase 3 does not claim .summary.md write")

# F46: Step 5 source path should say .deliverables/ (notebook-level, not .working/.deliverables/)
exec_steps = skill[skill.find("## Execution Steps"):skill.find("## State Transitions")]
if ".deliverables/" in exec_steps:
    print("PASS F46: Step 5 specifies .deliverables/ source path")
else:
    print("FAIL F46: Step 5 missing .deliverables/ source path")
    FAIL += 1

print(f"\n{'ALL PASSED' if FAIL == 0 else f'{FAIL} FAILED'}")
sys.exit(FAIL)
