#!/usr/bin/env python3
"""L2: Regression tests for six-dimension audit round 5 findings.

F1 High:   audit-library.py bare `except Exception: pass` — silent error swallowing
F2 Medium: search.sh --type argument consumed but not implemented (TODO) — contract violation
"""
import re
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

# --- F1: audit-library.py must not have bare except pass ---
audit_py = TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'audit-library.py'
content = audit_py.read_text()

bare_except = re.findall(r'except\b.*:\s*\n\s*#[^\n]*\n\s*pass\b', content)
if not bare_except:
    # Also check simpler pattern
    bare_except = re.findall(r'except\s+Exception.*:\s*\n.*pass\b', content)

if not bare_except:
    emit_pass('F1: audit-library.py has no bare except-pass')
else:
    emit_fail('F1: audit-library.py has bare except-pass pattern')

# --- F2: search.sh --type must not be a no-op TODO ---
search_sh = TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'search.sh'
search_content = search_sh.read_text()

# Check for TODO on the --type line (unimplemented)
type_todo = bool(re.search(r'--type\).*TODO', search_content))
if not type_todo:
    emit_pass('F2: search.sh --type has no TODO (implemented or removed)')
else:
    emit_fail('F2: search.sh --type is a no-op with TODO comment — contract violation')

sys.exit(summary())
