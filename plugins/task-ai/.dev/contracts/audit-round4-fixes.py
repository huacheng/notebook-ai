#!/usr/bin/env python3
"""L2: Regression tests for six-dimension audit round 4 findings.

F1 High: 5 library scripts have unprotected `cd "$LIB_PATH"` — git ops in wrong dir if cd fails
F2 High: init.sh git operations (branch/worktree/checkout) have no error checking
F3 Medium: trap handlers reference ${LOCK_FILE:-} but variable is never set (dead code)
"""
import re
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

# --- F1: Library scripts must guard `cd` with error check ---
cd_guard_files = [
    ('report', TASK_AI_ROOT / 'skills' / 'report' / 'scripts' / 'report.sh'),
    ('init-lib', TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'init-lib.sh'),
    ('lib-commit', TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'lib-commit.sh'),
    ('maintain', TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'maintain.sh'),
    ('status', TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'status.sh'),
]

for name, path in cd_guard_files:
    content = path.read_text()
    # Find cd commands that change to LIB_PATH
    # They should have `|| { ... exit ...; }` or `|| exit` guard
    cd_lines = [
        (i + 1, line) for i, line in enumerate(content.split('\n'))
        if re.match(r'\s*cd\s+"?\$', line) and 'LIB_PATH' in line
    ]
    all_guarded = True
    for lineno, line in cd_lines:
        if '||' not in line:
            all_guarded = False
            break
    if not cd_lines:
        emit_pass(f'F1-{name}: no cd to LIB_PATH found (N/A)')
    elif all_guarded:
        emit_pass(f'F1-{name}: cd to LIB_PATH has error guard')
    else:
        emit_fail(f'F1-{name}: cd to LIB_PATH at line {lineno} has no error guard')

# --- F2: init.sh git operations must have error checking ---
init_sh = TASK_AI_ROOT / 'skills' / 'init' / 'scripts' / 'init.sh'
init_content = init_sh.read_text()

# Check that git branch, git worktree add, git checkout have error guards
git_ops = re.findall(r'^(\s*git\s+(?:branch|worktree\s+add|checkout)\s+.*)$', init_content, re.MULTILINE)
unguarded = [op for op in git_ops if '||' not in op]

if not unguarded:
    emit_pass('F2: init.sh git operations all have error guards')
else:
    emit_fail(f'F2: init.sh has {len(unguarded)} unguarded git operations: {unguarded[0].strip()[:60]}')

# --- F3: trap handlers should not reference unused variables ---
trap_files = [
    ('auto', TASK_AI_ROOT / 'skills' / 'auto' / 'scripts' / 'auto.sh'),
    ('report', TASK_AI_ROOT / 'skills' / 'report' / 'scripts' / 'report.sh'),
]

for name, path in trap_files:
    content = path.read_text()
    # Find trap lines referencing LOCK_FILE
    trap_lines = [line for line in content.split('\n') if 'trap ' in line and 'LOCK_FILE' in line]
    # Check if LOCK_FILE is ever assigned in the script (excluding the trap line itself)
    lock_assigned = bool(re.search(r'^LOCK_FILE=', content, re.MULTILINE))

    if not trap_lines:
        emit_pass(f'F3-{name}: no trap referencing LOCK_FILE')
    elif lock_assigned:
        emit_pass(f'F3-{name}: trap references LOCK_FILE and it is assigned')
    else:
        emit_fail(f'F3-{name}: trap references LOCK_FILE but it is never assigned')

sys.exit(summary())
