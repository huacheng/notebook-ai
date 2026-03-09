#!/usr/bin/env python3
"""Round 8: merge.sh must accept evolving status (consistent with SKILL.md).

D1-R7: merge.sh status check should accept both 'executing' and 'evolving'
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

merge_sh = (TASK_AI_ROOT / 'skills' / 'merge' / 'scripts' / 'merge.sh').read_text()

# The status validation should accept evolving (not just executing)
# Look for the status check block
if 'evolving' in merge_sh and ('executing' in merge_sh):
    # Check if the condition allows evolving
    lines = merge_sh.split('\n')
    for i, line in enumerate(lines):
        if 'CURRENT_STATUS' in line and 'executing' in line and '!=' in line:
            # Found the old-style check — should also allow evolving
            if 'evolving' not in line:
                emit_fail('D1-R7: merge.sh status check rejects evolving — inconsistent with SKILL.md')
                break
    else:
        emit_pass('D1-R7: merge.sh accepts evolving status')
else:
    emit_fail('D1-R7: merge.sh missing evolving status support')

sys.exit(summary())
