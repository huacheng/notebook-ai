"""task-ai markdown parsing utilities (stdlib only, Python >= 3.9)"""
import re
import json
import sys
from pathlib import Path

TASK_AI_ROOT = Path(__file__).resolve().parent.parent.parent
DEV_ROOT = TASK_AI_ROOT / '.dev'
FIXTURES = DEV_ROOT / 'fixtures'

# --- Counters ---
_counts = {'PASS': 0, 'FAIL': 0, 'WARN': 0}


def strip_code_blocks(text: str) -> str:
    """Remove fenced code block content, preserving line count alignment."""
    lines = text.split('\n')
    result: list[str] = []
    in_fence = False
    for line in lines:
        if line.strip().startswith('```'):
            in_fence = not in_fence
            result.append('')
        elif in_fence:
            result.append('')
        else:
            result.append(line)
    return '\n'.join(result)


def split_table_row(line: str) -> list[str]:
    """Split a markdown table row, handling backtick-escaped pipes."""
    if not line.strip().startswith('|'):
        return []
    cells: list[str] = []
    current = ''
    in_bt = False
    content = line.strip()
    if content.startswith('|'):
        content = content[1:]
    if content.endswith('|'):
        content = content[:-1]
    for ch in content:
        if ch == '`':
            in_bt = not in_bt
            current += ch
        elif ch == '|' and not in_bt:
            cells.append(current.strip())
            current = ''
        else:
            current += ch
    cells.append(current.strip())
    return cells


def parse_md_table(text: str) -> list[dict]:
    """Parse a markdown table into a list of dicts."""
    lines = [l for l in text.strip().split('\n') if l.strip()]
    if len(lines) < 3:
        return []
    headers = split_table_row(lines[0])
    if not headers:
        return []
    sep = split_table_row(lines[1])
    if not all(re.match(r'^:?-+:?$', c.strip()) for c in sep if c.strip()):
        return []
    rows: list[dict] = []
    for line in lines[2:]:
        if not line.strip().startswith('|'):
            break
        cells = split_table_row(line)
        if len(cells) == len(headers):
            rows.append(dict(zip(headers, cells)))
    return rows


def extract_section(filepath: Path, heading: str) -> str:
    """Extract content under a specific heading (level-aware)."""
    text = filepath.read_text()
    level = len(heading) - len(heading.lstrip('#'))
    pattern = f'^{re.escape(heading.rstrip())}\\s*$'
    m = re.search(pattern, text, re.MULTILINE)
    if not m:
        return ''
    start = m.end()
    # Find next heading at same or higher level
    next_pattern = f'^{"#" * level}(?!#)'
    m2 = re.search(next_pattern, text[start:], re.MULTILINE)
    return text[start:start + m2.start()] if m2 else text[start:]


def extract_frontmatter(filepath: Path) -> dict:
    """Parse YAML frontmatter into a simple dict (legacy, single-value only)."""
    text = filepath.read_text()
    m = re.match(r'^---\s*\n(.*?)\n---', text, re.DOTALL)
    if not m:
        return {}
    result: dict = {}
    for line in m.group(1).split('\n'):
        if ':' in line:
            k, _, v = line.partition(':')
            result[k.strip()] = v.strip()
    return result


def parse_frontmatter(content: str) -> dict:
    """Robust YAML-like frontmatter parser with multi-line list support.

    Shared implementation — library scripts (audit-library, rebuild-index,
    rebuild-relations) should import this instead of defining local copies.
    """
    fm: dict = {}
    m = re.search(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL | re.MULTILINE)
    if not m:
        return fm
    lines = m.group(1).split('\n')
    current_key: str | None = None
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if ':' in line and not stripped.startswith('-'):
            k, v = line.split(':', 1)
            current_key = k.strip()
            val = v.strip().strip('"').strip("'")
            fm[current_key] = val if val else []
        elif stripped.startswith('-') and current_key:
            val = stripped[1:].strip().strip('"').strip("'")
            if isinstance(fm.get(current_key), list):
                fm[current_key].append(val)
    return fm


def find_skills() -> list[Path]:
    """Find all SKILL.md files."""
    return sorted((TASK_AI_ROOT / 'skills').rglob('SKILL.md'))


def find_references() -> list[Path]:
    """Find all command reference .md files."""
    refs_dir = TASK_AI_ROOT / 'commands' / 'references'
    if not refs_dir.exists():
        return []
    return sorted(refs_dir.glob('*.md'))


def find_skill_references() -> list[Path]:
    """Find all skill-level reference .md files."""
    return sorted((TASK_AI_ROOT / 'skills').rglob('references/*.md'))


def find_all_md() -> list[Path]:
    """Find all .md files in task-ai (excluding .dev/)."""
    return sorted(
        p for p in TASK_AI_ROOT.rglob('*.md')
        if '.dev' not in p.parts and 'node_modules' not in p.parts
    )


def load_fixture(name: str):
    """Load a JSON fixture file."""
    return json.loads((FIXTURES / name).read_text())


# --- Output helpers ---

def emit(level: str, msg: str):
    """Print a formatted test result."""
    print(f'[{level}] {msg}')
    _counts[level] = _counts.get(level, 0) + 1


def emit_pass(msg: str):
    emit('PASS', msg)


def emit_fail(msg: str):
    emit('FAIL', msg)


def emit_warn(msg: str):
    emit('WARN', msg)


def emit_json(test_id: str, status: str, detail: str = ''):
    """Print a JSONL result line."""
    print(json.dumps({'test': test_id, 'status': status, 'detail': detail}))


def summary() -> int:
    """Print summary and return exit code (min(failures, 255))."""
    print('---')
    print(f"Summary: {_counts['PASS']} passed, {_counts['FAIL']} failed, {_counts['WARN']} warnings")
    return min(_counts['FAIL'], 255)
