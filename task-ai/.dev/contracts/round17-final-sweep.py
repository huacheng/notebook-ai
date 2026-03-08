#!/usr/bin/env python3
"""Round 17: Final sweep — remaining stale references in model-routing.md."""
import sys

FAIL = 0

with open("task-ai/commands/references/model-routing.md") as f:
    routing = f.read()

# F49: model-routing.md medium tier should not mention "conflict resolution"
if "conflict resolution" in routing:
    print("FAIL F49: model-routing.md still mentions 'conflict resolution'")
    FAIL += 1
else:
    print("PASS F49: model-routing.md updated")

# F50: merge tier could be lowered to light since no conflict resolution needed
# Actually merge still needs git operations and state management, medium is fine
# Just check the rationale text is updated
merge_line = [l for l in routing.splitlines() if '**merge**' in l]
if merge_line:
    if 'conflict' in merge_line[0].lower():
        print("FAIL F50: merge routing rationale still mentions conflict")
        FAIL += 1
    else:
        print("PASS F50: merge routing rationale updated")
else:
    print("PASS F50: No merge entry found (skipped)")

print(f"\n{'ALL PASSED' if FAIL == 0 else f'{FAIL} FAILED'}")
sys.exit(FAIL)
