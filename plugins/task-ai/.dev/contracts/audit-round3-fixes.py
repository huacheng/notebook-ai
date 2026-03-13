#!/usr/bin/env python3
"""L2: Regression tests for six-dimension audit round 3 findings.

D1-01 Critical: rebuild-relations.py missing `import re` — runtime crash on re.search()
D3-02 High:     rebuild-relations.py bare `except Exception: pass` — silent error swallowing
D3-04 High:     plan.sh unconditionally overwrites existing .plan.md — no backup/warning
"""
import re
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

# --- T1: rebuild-relations.py must import re ---
relations_py = TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'rebuild-relations.py'
content = relations_py.read_text()

if re.search(r'^import re$', content, re.MULTILINE):
    emit_pass('D1-01: rebuild-relations.py imports re')
else:
    emit_fail('D1-01: rebuild-relations.py missing `import re` — re.search() will crash')

# --- T2: rebuild-relations.py must not have bare except pass ---
# Match patterns like `except Exception: pass` or `except: pass` (with optional whitespace)
bare_except = re.findall(r'except\b.*:\s*pass\b', content)
if not bare_except:
    emit_pass('D3-02: rebuild-relations.py has no bare except-pass')
else:
    emit_fail(f'D3-02: rebuild-relations.py has bare except-pass: {bare_except}')

# --- T3: plan.sh must guard against overwriting existing .plan.md ---
plan_sh = TASK_AI_ROOT / 'skills' / 'plan' / 'scripts' / 'plan.sh'
plan_content = plan_sh.read_text()

# The script should check if .plan.md exists before overwriting
# Valid guards: checking -f .plan.md, backup, or --force flag
has_overwrite_guard = bool(
    re.search(r'-f\s+.*\.plan\.md', plan_content) or
    re.search(r'--force', plan_content) or
    re.search(r'backup|\.bak', plan_content, re.IGNORECASE)
)
if has_overwrite_guard:
    emit_pass('D3-04: plan.sh has overwrite guard for existing .plan.md')
else:
    emit_fail('D3-04: plan.sh unconditionally overwrites .plan.md without guard')

sys.exit(summary())
