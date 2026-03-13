#!/usr/bin/env python3
"""L1: Verify research SKILL.md D1/D2/D3 review fixes.

Checks:
  D1-2: --caller test Test-S2a condition includes re-planning
  D2-1: Step 15 active research mentions request timeout (--max-time or timeout)
  D3-1: Step 15 has failure threshold / degradation strategy
  D3-2: Notes concurrency section mentions .type-profiles/.lock (third lock)
"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import emit_pass, emit_fail, extract_section, summary, TASK_AI_ROOT

research_text = (TASK_AI_ROOT / 'skills' / 'research' / 'SKILL.md').read_text()

# --- D1-2: Test-S2a includes re-planning ---
# The Test-S2a section header or body should mention re-planning
test_s2a_start = research_text.find('Test-S2a')
test_s2b_start = research_text.find('Test-S2b')
test_s2a_section = research_text[test_s2a_start:test_s2b_start] if test_s2a_start >= 0 and test_s2b_start >= 0 else ''

if 're-planning' in test_s2a_section:
    emit_pass('research: Test-S2a condition includes re-planning')
else:
    emit_fail('research: Test-S2a condition missing re-planning')

# --- D2-1: Step 15 mentions request timeout ---
step15_start = research_text.find('15. **Active research**')
step16_start = research_text.find('16. **Update**')
step15_section = research_text[step15_start:step16_start] if step15_start >= 0 and step16_start >= 0 else ''

if 'max-time' in step15_section or 'timeout' in step15_section.lower():
    emit_pass('research: step 15 mentions request timeout')
else:
    emit_fail('research: step 15 missing request timeout guidance')

# --- D3-1: Step 15 has failure threshold / degradation ---
if ('failure threshold' in step15_section.lower() or
    'consecutive fail' in step15_section.lower() or
    'degrad' in step15_section.lower() or
    'skip remaining' in step15_section.lower()):
    emit_pass('research: step 15 has failure degradation strategy')
else:
    emit_fail('research: step 15 missing failure degradation strategy')

# --- D3-2: Notes mentions .type-profiles/.lock ---
notes_section = extract_section(
    TASK_AI_ROOT / 'skills' / 'research' / 'SKILL.md', '## Notes'
)
# The concurrency note should explicitly mention THREE locks (not just two)
if 'three' in notes_section.lower() or '.type-profiles/.lock' in notes_section:
    emit_pass('research: Notes concurrency mentions third lock (.type-profiles/.lock)')
else:
    emit_fail('research: Notes concurrency missing explicit third lock mention')

sys.exit(summary())
