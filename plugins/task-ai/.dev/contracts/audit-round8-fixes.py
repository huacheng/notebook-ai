#!/usr/bin/env python3
"""Regression tests for R8 six-dimension audit fixes."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, summary, TASK_AI_ROOT

# --- T1: search.sh rejects empty QUERY ---
def test_search_empty_query_guard():
    path = TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'search.sh'
    content = path.read_text()
    # Should check for empty QUERY and exit/error before grep
    if re.search(r'if\s+\[\[\s+-z\s+"\$QUERY"', content):
        emit_pass('T1: search.sh guards against empty QUERY')
    else:
        emit_fail('T1: search.sh does not guard against empty QUERY')

# --- T2: status.sh find has -maxdepth ---
def test_status_find_maxdepth():
    path = TASK_AI_ROOT / 'skills' / 'library' / 'scripts' / 'status.sh'
    content = path.read_text()
    # Find the lock-scanning find command
    for line in content.split('\n'):
        if 'find ' in line and '.lock' in line:
            if '-maxdepth' not in line:
                emit_fail('T2: status.sh find for .lock missing -maxdepth')
                return
            else:
                emit_pass('T2: status.sh find for .lock has -maxdepth')
                return
    emit_pass('T2: status.sh no unbounded find for .lock')

# --- T3: report.sh no dead TMP_FILE trap ---
def test_report_no_dead_trap():
    path = TASK_AI_ROOT / 'skills' / 'report' / 'scripts' / 'report.sh'
    content = path.read_text()
    has_tmp_in_trap = bool(re.search(r'trap\s.*TMP_FILE', content))
    assigns_tmp = 'TMP_FILE=' in content or 'TMP_FILE=$' in content
    if has_tmp_in_trap and not assigns_tmp:
        emit_fail('T3: report.sh trap references TMP_FILE but never assigns it')
    else:
        emit_pass('T3: report.sh trap consistent with variable usage')

# --- T4: concurrency.md writer attributions use highlight (not report) for experiences/type-profiles ---
def test_concurrency_highlight_attribution():
    path = TASK_AI_ROOT / 'commands' / 'references' / 'concurrency.md'
    content = path.read_text()
    errors = []
    for i, line in enumerate(content.split('\n'), 1):
        # Check table rows that list writers for experiences or type-profiles
        if ('.experiences' in line or '.type-profiles' in line or 'patterns/' in line) and '|' in line:
            if '`report`' in line or ', report' in line or 'report,' in line or '| report |' in line:
                # Allow "report" in non-writer columns (e.g., description text)
                # Only flag if report appears in a Writers column of a table
                errors.append(f'line {i}: stale report attribution')
    if errors:
        emit_fail(f'T4: concurrency.md still attributes library writes to report: {errors}')
    else:
        emit_pass('T4: concurrency.md writer attributions use highlight')

# --- T5: library-repo-protocol.md uses highlight for distillation ---
def test_library_repo_protocol_highlight():
    path = TASK_AI_ROOT / 'commands' / 'references' / 'library-repo-protocol.md'
    content = path.read_text()
    # Check the Commit Scope table and commit message examples
    errors = []
    for i, line in enumerate(content.split('\n'), 1):
        # Flag :report directly followed by distill (wrong attribution)
        if ':report distill' in line or ':report ' in line and ':report' in line and (
            '| report |' in line and ('.experiences/' in line or '.type-profiles/' in line or 'patterns/' in line)
        ):
            errors.append(f'line {i}')
        # Flag table rows attributing experiences/type-profiles/patterns to report
        if '`report`' in line and ('distill' in line.lower() or '.experiences/' in line or '.type-profiles/' in line or 'patterns/' in line):
            errors.append(f'line {i}')
    if errors:
        emit_fail(f'T5: library-repo-protocol.md stale report references: {errors}')
    else:
        emit_pass('T5: library-repo-protocol.md uses highlight for distillation')

# --- T6: library-write-protocol.md uses highlight (not report) for summary rebuild ---
def test_library_write_protocol_highlight():
    path = TASK_AI_ROOT / 'commands' / 'references' / 'library-write-protocol.md'
    content = path.read_text()
    if 'rebuilt by `report`' in content or 'rebuilt by report' in content:
        emit_fail('T6: library-write-protocol.md still says summary rebuilt by report')
    else:
        emit_pass('T6: library-write-protocol.md does not attribute summary rebuild to report')

# --- T7: type-profiling.md uses highlight (not report) for experience writes ---
def test_type_profiling_highlight():
    path = TASK_AI_ROOT / 'skills' / 'plan' / 'references' / 'type-profiling.md'
    content = path.read_text()
    errors = []
    for i, line in enumerate(content.split('\n'), 1):
        if ('.experiences/' in line or 'Merge refinements' in line) and '`report`' in line:
            errors.append(f'line {i}')
        if 'report` writes to' in line:
            errors.append(f'line {i}')
    if errors:
        emit_fail(f'T7: type-profiling.md stale report references: {errors}')
    else:
        emit_pass('T7: type-profiling.md uses highlight for experience writes')

# --- T8: plugin.json version matches marketplace.json ---
def test_plugin_version_sync():
    import json
    plugin = json.loads((TASK_AI_ROOT / 'plugin.json').read_text())
    marketplace = json.loads((TASK_AI_ROOT / 'marketplace.json').read_text())
    mp_version = marketplace.get('plugins', [{}])[0].get('version', '')
    pj_version = plugin.get('version', '')
    if pj_version != mp_version:
        emit_fail(f'T8: plugin.json version ({pj_version}) != marketplace.json ({mp_version})')
    else:
        emit_pass(f'T8: plugin.json version matches marketplace.json ({pj_version})')

# --- T9: REFERENCE-INDEX.md report description does not claim distillation ---
def test_reference_index_report_desc():
    path = TASK_AI_ROOT / 'REFERENCE-INDEX.md'
    content = path.read_text()
    for line in content.split('\n'):
        if '| `report`' in line or '| report |' in line:
            if 'distill' in line.lower():
                emit_fail('T9: REFERENCE-INDEX.md report description still claims distillation')
                return
    emit_pass('T9: REFERENCE-INDEX.md report description does not claim distillation')

if __name__ == '__main__':
    test_search_empty_query_guard()
    test_status_find_maxdepth()
    test_report_no_dead_trap()
    test_concurrency_highlight_attribution()
    test_library_repo_protocol_highlight()
    test_library_write_protocol_highlight()
    test_type_profiling_highlight()
    test_plugin_version_sync()
    test_reference_index_report_desc()
    sys.exit(summary())
