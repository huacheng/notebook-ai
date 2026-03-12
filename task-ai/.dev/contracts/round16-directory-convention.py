#!/usr/bin/env python3
"""Round 16: directory-convention.md must document notebook-level .deliverables/ and merge path mapping."""
import sys

FAIL = 0

with open("task-ai/commands/references/directory-convention.md") as f:
    conv = f.read()

# F47: .deliverables/ must appear at notebook level (sibling of .working/)
tree_section = conv[conv.find("notebook-1/"):conv.find("notebook-2/")]
if ".deliverables/" in tree_section:
    print("PASS F47: .deliverables/ documented in directory tree at notebook level")
else:
    print("FAIL F47: .deliverables/ missing from notebook section in directory tree")
    FAIL += 1

# F48: directory-convention.md must explain the merge path mapping (all notebooks share <project>/.deliverables/)
if "<notebook>/.deliverables" in conv and "<project>/.deliverables" in conv and "merge" in conv.lower():
    print("PASS F48: merge path mapping documented")
else:
    print("FAIL F48: merge path mapping (<notebook>/.deliverables → <project>/.deliverables) not documented")
    FAIL += 1

print(f"\n{'ALL PASSED' if FAIL == 0 else f'{FAIL} FAILED'}")
sys.exit(FAIL)
