"""Shared frontmatter parser for task-ai production scripts (stdlib only, Python >= 3.9)."""
import re


def parse_frontmatter(content: str) -> dict:
    """Robust YAML-like frontmatter parser with multi-line list support.

    Canonical implementation — library scripts (audit-library, rebuild-index,
    rebuild-relations) import this instead of defining local copies.
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
