#!/usr/bin/env python3
"""L1: Verify expected-states.json is complete against SKILL.md tables.

Checks:
  1. Meta note transition count matches actual array length
  2. All state-changing transitions from annotate/plan/exec SKILL.md are present
  3. Key self-loop transitions are present (report on terminal states, target/annotate self-loops)
  4. No duplicate transitions
"""
import json
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

data = json.loads((TASK_AI_ROOT / '.dev' / 'fixtures' / 'expected-states.json').read_text())
transitions = data['transitions']
meta_note = data['_meta']['note']

# --- Test 1: Meta count matches actual ---
actual_count = len(transitions)
# Extract number from meta note
import re
m = re.search(r'(\d+) transitions', meta_note)
claimed_count = int(m.group(1)) if m else -1
if claimed_count == actual_count:
    emit_pass(f'meta count matches actual ({actual_count})')
else:
    emit_fail(f'meta claims {claimed_count} but actual is {actual_count}')

# --- Test 2: State-changing transitions from annotate ---
def has_t(frm, to, via_contains):
    return any(t['from'] == frm and t['to'] == to and via_contains in t.get('via', '')
               for t in transitions)

missing = []
# annotate state-changing
for frm, to in [('review', 're-planning'), ('executing', 're-planning'), ('blocked', 'planning')]:
    if not has_t(frm, to, 'annotate'):
        missing.append(f'{frm}→{to} via annotate')
# plan on executing
if not has_t('executing', 're-planning', 'plan'):
    missing.append('executing→re-planning via plan')
# exec blocked
if not has_t('executing', 'blocked', 'exec'):
    missing.append('executing→blocked via exec')

if not missing:
    emit_pass('all state-changing transitions from annotate/plan/exec present')
else:
    emit_fail(f'missing state-changing transitions: {", ".join(missing)}')

# --- Test 3: Key self-loop transitions ---
missing_loops = []
# report self-loops on terminal + evolving
for state in ['satisfied', 'blocked', 'cancelled']:
    if not has_t(state, state, 'report'):
        missing_loops.append(f'{state}→{state} via report')
# target/annotate self-loops on planning
for via in ['target', 'annotate']:
    if not has_t('planning', 'planning', via):
        missing_loops.append(f'planning→planning via {via}')
# target self-loop on re-planning
if not has_t('re-planning', 're-planning', 'target'):
    missing_loops.append('re-planning→re-planning via target')
# annotate self-loop on re-planning
if not has_t('re-planning', 're-planning', 'annotate'):
    missing_loops.append('re-planning→re-planning via annotate')

if not missing_loops:
    emit_pass('key self-loop transitions present')
else:
    emit_fail(f'missing self-loops: {", ".join(missing_loops)}')

# --- Test 4: No duplicate transitions ---
seen = set()
dupes = []
for t in transitions:
    key = (t['from'], t['to'], t['via'])
    if key in seen:
        dupes.append(f'{t["from"]}→{t["to"]} via {t["via"]}')
    seen.add(key)
if not dupes:
    emit_pass('no duplicate transitions')
else:
    emit_fail(f'duplicates: {", ".join(dupes)}')

sys.exit(summary())
