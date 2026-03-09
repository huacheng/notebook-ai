#!/usr/bin/env python3
"""Round 8: merge.sh must not double-write stage.history when status is already evolving.

D3-R9: When merge runs from evolving status (auto already wrote history),
       it should skip stage.history push to avoid duplicate entries.
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

merge_sh = (TASK_AI_ROOT / 'skills' / 'merge' / 'scripts' / 'merge.sh').read_text()

# merge.sh should distinguish executing vs evolving for history writing
# When status is evolving, auto already wrote stage.history — merge should skip
if 'CURRENT_STATUS' in merge_sh and 'evolving' in merge_sh:
    # Check if there's a conditional around the stage-history write
    lines = merge_sh.split('\n')
    history_write_line = -1
    status_guard = False
    for i, line in enumerate(lines):
        if '--stage-history' in line:
            history_write_line = i
        if history_write_line > 0 and i < history_write_line:
            if 'executing' in line and ('if' in line or 'case' in line or '==' in line):
                status_guard = True

    # Also check for conditional around the entire transition block
    if not status_guard:
        for i, line in enumerate(lines):
            if '--stage-history' in line:
                # Look backwards for a guard
                for j in range(i, max(0, i-10), -1):
                    if 'executing' in lines[j] and ('if' in lines[j] or '==' in lines[j]):
                        status_guard = True
                        break

    if status_guard:
        emit_pass('D3-R9: merge.sh guards stage.history write by status (no double-write from evolving)')
    else:
        emit_fail('D3-R9: merge.sh writes stage.history unconditionally — will duplicate when called from evolving')
else:
    emit_fail('D3-R9: merge.sh missing status handling logic')

sys.exit(summary())
