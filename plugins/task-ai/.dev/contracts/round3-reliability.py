#!/usr/bin/env python3
"""Round 3: D3 Reliability fixes.

F10: target.sh --satisfy should check .status.json exists before reading
F11: target.sh --satisfy should warn (not swallow) git commit failure
F12: state.py --stage-history should reject invalid JSON (not fallback to string)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

target_sh = (TASK_AI_ROOT / 'skills' / 'target' / 'scripts' / 'target.sh').read_text()
state_py = (TASK_AI_ROOT / 'core' / 'state.py').read_text()

# F10: target.sh --satisfy should check file exists
# Look for STATUS_FILE existence check before the satisfy mode block
satisfy_block = target_sh[target_sh.find('Mode 1: Satisfy'):target_sh.find('Mode 2:')]
if '-f "$STATUS_FILE"' in satisfy_block or 'not found' in satisfy_block.lower() or 'does not exist' in satisfy_block.lower():
    emit_pass('F10: target.sh --satisfy checks .status.json exists')
else:
    emit_fail('F10: target.sh --satisfy missing .status.json existence check')

# F11: target.sh --satisfy should not silently swallow git commit errors
# Look for "|| true" without any warning
if '2>/dev/null || true' in satisfy_block and 'WARN' not in satisfy_block:
    emit_fail('F11: target.sh --satisfy silently swallows git commit failure')
else:
    emit_pass('F11: target.sh --satisfy handles git commit failure properly')

# F12: state.py should reject invalid JSON in --stage-history, not fallback
# Check if the except block contains sys.exit or raises
import re
# Extract the stage_history block more carefully
sh_start = state_py.find('stage_history is not None')
sh_end = state_py.find('history.append(entry)', sh_start) + 30 if sh_start >= 0 else 0
history_block = state_py[sh_start:sh_end] if sh_start >= 0 else ''
if 'entry = args.stage_history' in history_block:
    # Raw string fallback exists — bad
    emit_fail('F12: state.py --stage-history falls back to raw string on invalid JSON')
else:
    emit_pass('F12: state.py --stage-history rejects invalid JSON properly')

sys.exit(summary())
