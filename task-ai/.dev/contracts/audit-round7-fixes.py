#!/usr/bin/env python3
"""Regression tests for R7 six-dimension audit fixes."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

# --- T1: read.sh heredoc delimiter must not be plain EOF ---
def test_read_heredoc_delimiter():
    path = TASK_AI_ROOT / 'skills' / 'read' / 'scripts' / 'read.sh'
    content = path.read_text()
    # Check for heredoc with plain EOF (vulnerable to content containing EOF)
    if re.search(r'<<\s*EOF\b', content):
        emit_fail('T1: read.sh uses plain EOF heredoc delimiter (content injection risk)')
    else:
        emit_pass('T1: read.sh uses unique heredoc delimiter')

# --- T2: library/SKILL.md complete.md writer is highlight, not report ---
def test_library_complete_writer():
    path = TASK_AI_ROOT / 'skills' / 'library' / 'SKILL.md'
    content = path.read_text()
    # Find the Knowledge Quality Model table row for complete.md
    for line in content.split('\n'):
        if '<nb>-complete.md' in line or 'complete.md' in line:
            if '`report`' in line:
                emit_fail('T2: library/SKILL.md lists report as complete.md writer (should be highlight)')
                return
    emit_pass('T2: library/SKILL.md complete.md writer is not report')

# --- T3: list/SKILL.md must not reference phantom mode field ---
def test_list_no_phantom_mode():
    path = TASK_AI_ROOT / 'skills' / 'list' / 'SKILL.md'
    content = path.read_text()
    if 'mode == "light"' in content or 'Lightweight Shadow Task' in content:
        emit_fail('T3: list/SKILL.md references phantom mode field / Lightweight Shadow Task')
    else:
        emit_pass('T3: list/SKILL.md has no phantom mode field references')

# --- T4: highlight/SKILL.md scope count matches actual ---
def test_highlight_scope_count():
    path = TASK_AI_ROOT / 'skills' / 'highlight' / 'SKILL.md'
    content = path.read_text()
    # Count actual scope sections (§3.N patterns)
    scope_sections = re.findall(r'^###\s+§3\.\d+\s+scope=', content, re.MULTILINE)
    actual_count = len(scope_sections)
    # Check claimed count
    m = re.search(r'highlight defines (\d+) scopes', content)
    if m:
        claimed = int(m.group(1))
        if claimed != actual_count:
            emit_fail(f'T4: highlight/SKILL.md claims {claimed} scopes but documents {actual_count}')
        else:
            emit_pass(f'T4: highlight/SKILL.md scope count matches ({actual_count})')
    else:
        emit_fail('T4: highlight/SKILL.md missing scope count statement')

# --- T5: target.sh trap must not reference unused LOCK_FILE ---
def test_target_no_dead_lock_trap():
    path = TASK_AI_ROOT / 'skills' / 'target' / 'scripts' / 'target.sh'
    content = path.read_text()
    has_lock_in_trap = bool(re.search(r'trap\s.*LOCK_FILE', content))
    assigns_lock = 'LOCK_FILE=' in content or 'LOCK_FILE=$' in content
    if has_lock_in_trap and not assigns_lock:
        emit_fail('T5: target.sh trap references LOCK_FILE but never assigns it')
    else:
        emit_pass('T5: target.sh trap consistent with variable usage')

# --- T6: auto.sh must not have dead TMP_FILE trap ---
def test_auto_no_dead_tmp_trap():
    path = TASK_AI_ROOT / 'skills' / 'auto' / 'scripts' / 'auto.sh'
    content = path.read_text()
    has_tmp_in_trap = bool(re.search(r'trap\s.*TMP_FILE', content))
    assigns_tmp = 'TMP_FILE=' in content or 'TMP_FILE=$' in content
    if has_tmp_in_trap and not assigns_tmp:
        emit_fail('T6: auto.sh trap references TMP_FILE but never assigns it')
    else:
        emit_pass('T6: auto.sh trap consistent with variable usage')

# --- T7: search.sh --type filter uses fixed-string match, not regex ---
def test_search_type_fixed_string():
    path = TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'search.sh'
    content = path.read_text()
    # awk ~ operator is regex match; index() is fixed-string
    if re.search(r'tolower\(\$\d+\)\s*~\s*tolower\(t\)', content):
        emit_fail('T7: search.sh --type uses awk regex ~ (should use fixed-string match)')
    else:
        emit_pass('T7: search.sh --type uses fixed-string matching')

# --- T8: search.sh LIMIT has integer validation ---
def test_search_limit_validation():
    path = TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'search.sh'
    content = path.read_text()
    if re.search(r'LIMIT.*[0-9].*\|\|.*LIMIT=', content) or \
       re.search(r'\[\[.*LIMIT.*=~.*\^?\[0-9\]', content):
        emit_pass('T8: search.sh validates LIMIT as integer')
    else:
        emit_fail('T8: search.sh does not validate LIMIT as integer')

# --- T9: state.py cleans up stale lock files ---
def test_state_stale_lock_cleanup():
    path = TASK_AI_ROOT / 'core' / 'state.py'
    content = path.read_text()
    # After renaming to stale, should clean up
    if 'stale_path' in content and 'os.remove(stale_path)' not in content and 'os.unlink(stale_path)' not in content:
        emit_fail('T9: state.py creates stale lock files but never cleans them up')
    else:
        emit_pass('T9: state.py handles stale lock cleanup')

# --- T10: lib.sh resolve_workdir find has -maxdepth ---
def test_lib_find_maxdepth():
    path = TASK_AI_ROOT / 'core' / 'lib.sh'
    content = path.read_text()
    # Find the resolve_workdir function's find command
    in_resolve = False
    for line in content.split('\n'):
        if 'resolve_workdir' in line and '()' in line:
            in_resolve = True
        if in_resolve and 'find ' in line:
            if '-maxdepth' not in line:
                emit_fail('T10: lib.sh resolve_workdir find missing -maxdepth')
                return
            else:
                emit_pass('T10: lib.sh resolve_workdir find has -maxdepth')
                return
    emit_fail('T10: lib.sh resolve_workdir find command not found')

# --- T11: audit-library.py date parsing handles truncation ---
def test_audit_library_date_parsing():
    path = TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'audit-library.py'
    content = path.read_text()
    # Should handle ISO timestamps by truncating to date portion
    if 'last_ver[:10]' in content or 'split("T")' in content or \
       re.search(r'last_ver\[:\d+\]', content):
        emit_pass('T11: audit-library.py handles ISO timestamp truncation')
    else:
        emit_fail('T11: audit-library.py does not handle ISO timestamp formats')

# --- T12: state.py uses datetime.now(timezone.utc) not utcnow() ---
def test_state_no_utcnow():
    path = TASK_AI_ROOT / 'core' / 'state.py'
    content = path.read_text()
    if 'utcnow()' in content:
        emit_fail('T12: state.py uses deprecated datetime.utcnow()')
    else:
        emit_pass('T12: state.py does not use deprecated utcnow()')

if __name__ == '__main__':
    test_read_heredoc_delimiter()
    test_library_complete_writer()
    test_list_no_phantom_mode()
    test_highlight_scope_count()
    test_target_no_dead_lock_trap()
    test_auto_no_dead_tmp_trap()
    test_search_type_fixed_string()
    test_search_limit_validation()
    test_state_stale_lock_cleanup()
    test_lib_find_maxdepth()
    test_audit_library_date_parsing()
    test_state_no_utcnow()
    sys.exit(summary())
