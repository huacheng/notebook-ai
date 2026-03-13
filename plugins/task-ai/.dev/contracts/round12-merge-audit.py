#!/usr/bin/env python3
"""Contract tests for D1-D6 audit findings on merge.sh."""
import sys

FAIL = 0

with open("task-ai/skills/merge/scripts/merge.sh") as f:
    merge_sh = f.read()

# F26: trap must not silently override — both cleanup_merge and MERGE_TMPDIR cleanup should work
# Check that we don't have two separate trap EXIT that override each other
trap_exits = [i for i, line in enumerate(merge_sh.splitlines()) if 'trap ' in line and 'EXIT' in line]
if len(trap_exits) > 1:
    # If multiple trap EXIT, the later one must include cleanup_merge logic
    lines = merge_sh.splitlines()
    last_trap_line = lines[trap_exits[-1]]
    if 'cleanup_merge' not in last_trap_line and 'SIGNAL_FILE' not in last_trap_line:
        print(f"FAIL F26: Multiple trap EXIT handlers — later trap (line {trap_exits[-1]+1}) overrides cleanup_merge without including its logic")
        FAIL += 1
    else:
        print("PASS F26: trap EXIT handlers properly combined")
else:
    print("PASS F26: Single trap EXIT handler (no override issue)")

# F27: After checkout master, state.py operations must happen on task branch (checkout back)
# or WORK_DIR/STATUS_JSON must be accessible
# Key: state.py transition on STATUS_JSON must happen while on task branch, not master
checkout_master_pos = merge_sh.find('git checkout "$MAIN_BRANCH"')
state_transition_pos = merge_sh.find('STATE_PY" transition')
if checkout_master_pos > 0 and state_transition_pos > checkout_master_pos:
    # State transition happens after checkout master — check if we checkout back to task branch first
    between = merge_sh[checkout_master_pos:state_transition_pos]
    if 'checkout "$TASK_BRANCH"' in between or 'checkout $TASK_BRANCH' in between:
        print("PASS F27: Checks out task branch before state transition")
    else:
        print("FAIL F27: state.py transition runs after checkout master — .status.json may not exist on master")
        FAIL += 1
else:
    print("PASS F27: State transition order OK")

# F28: SKILL.md description should not mention "conflict resolution"
with open("task-ai/skills/merge/SKILL.md") as f:
    skill_md = f.read()

frontmatter_end = skill_md.find('---', 4)  # second ---
if frontmatter_end > 0:
    frontmatter = skill_md[:frontmatter_end]
    if 'conflict resolution' in frontmatter:
        print("FAIL F28: SKILL.md frontmatter description still mentions 'conflict resolution'")
        FAIL += 1
    else:
        print("PASS F28: SKILL.md frontmatter description updated")
else:
    print("PASS F28: Could not parse frontmatter, skipping")

# F29: disambiguate text should not mention "conflict resolution"
disambiguate_start = skill_md.find('disambiguate:')
if disambiguate_start > 0:
    disambiguate_section = skill_md[disambiguate_start:disambiguate_start+200]
    if 'conflict resolution' in disambiguate_section:
        print("FAIL F29: SKILL.md disambiguate still mentions 'conflict resolution'")
        FAIL += 1
    else:
        print("PASS F29: SKILL.md disambiguate updated")
else:
    print("PASS F29: No disambiguate section found")

print(f"\n{'ALL PASSED' if FAIL == 0 else f'{FAIL} FAILED'}")
sys.exit(FAIL)
