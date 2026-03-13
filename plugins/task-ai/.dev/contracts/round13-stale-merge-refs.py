#!/usr/bin/env python3
"""Round 13: Stale merge references — conflict resolution, old commit patterns."""
import sys

FAIL = 0

def check(fid, path, bad_text, desc):
    global FAIL
    with open(path) as f:
        content = f.read()
    if bad_text in content:
        print(f"FAIL {fid}: {desc}")
        FAIL += 1
    else:
        print(f"PASS {fid}: {desc}")

# F30: REFERENCE-INDEX.md
check("F30", "task-ai/REFERENCE-INDEX.md",
      "conflict resolution",
      "REFERENCE-INDEX.md no longer mentions conflict resolution")

# F31: git-details.md merge type description
check("F31", "task-ai/commands/references/git-details.md",
      "Merge to main + conflict resolution",
      "git-details.md merge type updated")

# F32: git-details.md old commit example "merge completed task"
check("F32", "task-ai/commands/references/git-details.md",
      "merge merge completed task",
      "git-details.md no stale 'merge completed task' example")

# F33: git-details.md old commit example "resolve merge conflict"
check("F33", "task-ai/commands/references/git-details.md",
      "resolve merge conflict",
      "git-details.md no stale 'resolve merge conflict' example")

# F34: git-details.md old commit example "task completed" (line 53)
check("F34", "task-ai/commands/references/git-details.md",
      "merge task completed",
      "git-details.md no stale 'task completed' example")

# F35: git-details.md "Refactoring & Merge" section mentions conflict resolution
check("F35", "task-ai/commands/references/git-details.md",
      "conflict resolution — up to 3 attempts",
      "git-details.md Refactoring & Merge section updated")

# F36: git-details.md "conflict resolution flow" reference
check("F36", "task-ai/commands/references/git-details.md",
      "conflict resolution flow",
      "git-details.md no longer references conflict resolution flow")

# F37: check/SKILL.md merge description
check("F37", "task-ai/skills/check/SKILL.md",
      "merge, conflict resolution, and cleanup",
      "check/SKILL.md merge description updated")

# F38: highlight/SKILL.md conflict resolution thinking capture
check("F38", "task-ai/skills/highlight/SKILL.md",
      "During conflict resolution",
      "highlight/SKILL.md no longer references conflict resolution")

# F39: git-details.md worktree section "git merge task/<notebook>"
check("F39", "task-ai/commands/references/git-details.md",
      "git merge task/",
      "git-details.md worktree section no longer references git merge")

print(f"\n{'ALL PASSED' if FAIL == 0 else f'{FAIL} FAILED'}")
sys.exit(FAIL)
