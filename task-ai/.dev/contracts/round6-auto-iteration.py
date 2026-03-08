#!/usr/bin/env python3
"""Round 6: auto.sh iteration safety.

F17: auto.sh must increment ITERATION before writing signal
F18: auto.sh must have a hard iteration limit (fallback safety)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

auto_sh = (TASK_AI_ROOT / 'skills' / 'auto' / 'scripts' / 'auto.sh').read_text()

# F17: ITERATION should be incremented (ITERATION++ or ITERATION=$((ITERATION+1)))
if 'ITERATION=$((' in auto_sh or '((ITERATION++' in auto_sh or 'ITERATION=$((ITERATION' in auto_sh:
    emit_pass('F17: auto.sh increments ITERATION')
else:
    emit_fail('F17: auto.sh does not increment ITERATION')

# F18: Hard iteration limit check (e.g., MAX_ITERATIONS, >= 200, etc.)
if 'MAX_ITERATION' in auto_sh or 'iteration.*limit' in auto_sh.lower() or 'ITERATION -ge' in auto_sh or 'ITERATION -gt' in auto_sh:
    emit_pass('F18: auto.sh has hard iteration limit')
else:
    emit_fail('F18: auto.sh missing hard iteration limit')

sys.exit(summary())
