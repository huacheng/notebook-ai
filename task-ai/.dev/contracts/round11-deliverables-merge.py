#!/usr/bin/env python3
"""Contract tests for deliverables-only merge (path remapping from .deliverables/ to .deliverables/)."""
import sys

FAIL = 0

with open("task-ai/skills/merge/scripts/merge.sh") as f:
    merge_sh = f.read()

# F21: No full git merge
if "git merge --no-ff" in merge_sh:
    print("FAIL F21: merge.sh still uses full git merge")
    FAIL += 1
else:
    print("PASS F21: merge.sh does not use full git merge")

# F22: Source is .deliverables/
if '.deliverables' in merge_sh or "WORK_DIR/.deliverables" in merge_sh or 'SRC_DELIVERABLES="$WORK_DIR/.deliverables"' in merge_sh:
    print("PASS F22: merge.sh reads from .deliverables/ (task branch)")
else:
    print("FAIL F22: merge.sh missing .deliverables/ source path")
    FAIL += 1

# F23: Target is <project>/.deliverables/ (shared by all notebooks)
if "DELIVERABLES_TARGET" in merge_sh and '.deliverables/$NOTEBOOK' not in merge_sh and '.deliverables/"$NOTEBOOK"' not in merge_sh:
    print("PASS F23: merge.sh writes to shared <project>/.deliverables/ (main)")
else:
    print("FAIL F23: merge.sh should write to shared .deliverables/, not per-notebook subdirectory")
    FAIL += 1

# F24: Uses temp dir to survive branch switch
if "mktemp -d" in merge_sh and "cp -a" in merge_sh:
    print("PASS F24: merge.sh uses temp dir for branch-switch safety")
else:
    print("FAIL F24: merge.sh missing temp dir pattern for branch switch")
    FAIL += 1

# F25: SKILL.md documents path remapping
with open("task-ai/skills/merge/SKILL.md") as f:
    merge_skill = f.read()

if "<notebook>/.deliverables" in merge_skill and "<project>/.deliverables" in merge_skill:
    print("PASS F25: SKILL.md documents source→target path remapping")
else:
    print("FAIL F25: SKILL.md missing <notebook>/.deliverables → <project>/.deliverables path mapping")
    FAIL += 1

print(f"\n{'ALL PASSED' if FAIL == 0 else f'{FAIL} FAILED'}")
sys.exit(FAIL)
