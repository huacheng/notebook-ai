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
            if not current_key:
                continue
            raw_val = v.strip()
            # D1: Track whether value was quoted (quoted booleans stay strings)
            was_quoted = (raw_val.startswith('"') and raw_val.endswith('"')) or \
                         (raw_val.startswith("'") and raw_val.endswith("'"))
            val = raw_val.strip('"').strip("'")
            if not val:
                # D1: Empty value after colon — could be a list header or truly empty
                fm[current_key] = []
            elif not was_quoted and val.lower() == 'true':
                fm[current_key] = True
            elif not was_quoted and val.lower() == 'false':
                fm[current_key] = False
            else:
                # D1: Try numeric conversion for integer fields (unquoted only)
                if not was_quoted:
                    try:
                        fm[current_key] = int(val)
                        continue
                    except ValueError:
                        pass
                fm[current_key] = val
        elif stripped.startswith('-') and current_key:
            val = stripped[1:].strip().strip('"').strip("'")
            if isinstance(fm.get(current_key), list):
                fm[current_key].append(val)
    return fm
