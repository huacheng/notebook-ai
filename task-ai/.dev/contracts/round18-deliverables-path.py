#!/usr/bin/env python3
"""Round 18: .deliverables/ is notebook-level (sibling of .working/), not inside .working/."""
import sys

FAIL = 0

def check_no(fid, path, bad, desc):
    global FAIL
    with open(path) as f:
        c = f.read()
    if bad in c:
        print(f"FAIL {fid}: {desc}")
        FAIL += 1
    else:
        print(f"PASS {fid}: {desc}")

def check_yes(fid, path, good, desc):
    global FAIL
    with open(path) as f:
        c = f.read()
    if good in c:
        print(f"PASS {fid}: {desc}")
    else:
        print(f"FAIL {fid}: {desc}")
        FAIL += 1

# F51: merge.sh must NOT use WORK_DIR/.deliverables (that's inside .working/)
check_no("F51", "task-ai/skills/merge/scripts/merge.sh",
         'WORK_DIR/.deliverables',
         "merge.sh source is NOT inside .working/")

# F52: merge.sh must use NB_DIR/.deliverables (notebook level)
check_yes("F52", "task-ai/skills/merge/scripts/merge.sh",
          'NB_DIR/.deliverables',
          "merge.sh source is notebook-level .deliverables/")

# F53: directory-convention.md must show .deliverables/ as sibling of .working/
with open("task-ai/commands/references/directory-convention.md") as f:
    conv = f.read()
# .deliverables/ should appear BEFORE .working/ in the notebook section (as sibling)
# or at least NOT inside .working/ subtree
tree_section = conv[conv.find("notebook-1/"):conv.find("notebook-2/")]
working_pos = tree_section.find(".working/")
deliverables_pos = tree_section.find(".deliverables/")
if deliverables_pos >= 0 and working_pos >= 0:
    # Check indentation: .deliverables/ should be at same level as .working/
    deliv_line = [l for l in tree_section.splitlines() if ".deliverables/" in l and "working" not in l]
    working_line = [l for l in tree_section.splitlines() if ".working/" in l]
    if deliv_line and working_line:
        # Count leading │ and spaces — should be same depth
        d_depth = len(deliv_line[0]) - len(deliv_line[0].lstrip("│ "))
        w_depth = len(working_line[0]) - len(working_line[0].lstrip("│ "))
        if abs(d_depth - w_depth) <= 2:  # allow small formatting difference
            print("PASS F53: .deliverables/ is sibling of .working/ in tree")
        else:
            print(f"FAIL F53: .deliverables/ depth ({d_depth}) != .working/ depth ({w_depth})")
            FAIL += 1
    else:
        print("FAIL F53: Could not find .deliverables/ or .working/ lines in tree")
        FAIL += 1
else:
    print("FAIL F53: .deliverables/ missing from notebook section")
    FAIL += 1

# F54: No .deliverables/app/ reference (user said no app/ subdirectory)
check_no("F54", "task-ai/commands/references/directory-convention.md",
         ".deliverables/app",
         "No .deliverables/app/ in directory convention (removed)")

# F55: merge/SKILL.md source path should say <notebook>/.deliverables/ not .working/.deliverables/
with open("task-ai/skills/merge/SKILL.md") as f:
    skill = f.read()
if "<notebook>/.deliverables/" in skill or "/.deliverables/*" in skill:
    # Make sure it doesn't say .working/.deliverables/ as source
    if ".working/.deliverables" not in skill:
        print("PASS F55: SKILL.md uses correct notebook-level source path")
    else:
        print("FAIL F55: SKILL.md still references .working/.deliverables/")
        FAIL += 1
else:
    print("FAIL F55: SKILL.md missing notebook-level .deliverables/ path")
    FAIL += 1

# F56: auto or exec SKILL.md must mention .deliverables/ as output directory for non-system files
found = False
for path in ["task-ai/skills/auto/SKILL.md", "task-ai/skills/exec/SKILL.md"]:
    with open(path) as f:
        c = f.read()
    if ".deliverables/" in c and ("output" in c.lower() or "write" in c.lower() or "non-system" in c.lower() or "交付" in c):
        found = True
        break
if found:
    print("PASS F56: auto/exec documents .deliverables/ as output directory")
else:
    print("FAIL F56: Neither auto nor exec documents .deliverables/ output requirement")
    FAIL += 1

print(f"\n{'ALL PASSED' if FAIL == 0 else f'{FAIL} FAILED'}")
sys.exit(FAIL)
