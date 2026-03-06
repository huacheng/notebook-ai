#!/usr/bin/env python3
"""Rebuild .relations.jsonl from changelog and markdown cross-references (stdlib only, Python >= 3.9)."""
import os
import re
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'core'))
from frontmatter import parse_frontmatter

def rebuild_relations():
    lib_path = Path(os.getenv('NB_WORKSPACES_LIBRARY', os.getenv('NB_WORKSPACES_ROOT', '.') + '/.library'))
    changelog_path = lib_path / '.changelog'
    relations_path = lib_path / '.relations.jsonl'

    if not lib_path.exists(): return

    relations = []

    # 1. Parse Changelog
    # D1: Changelog format per write-protocol.md:
    # <ISO8601Z> | <type> | <subpath> | <tags>
    # Tags may contain: caller:<sub-command> notebook:<name> topic:<topic> quality_status:<status>
    if changelog_path.exists():
        with open(changelog_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                parts = [p.strip() for p in line.split('|')]
                if len(parts) >= 4:
                    source_file = parts[2]
                    detail = parts[3]
                    # D1: Match notebook:<name> tag (per changelog format spec)
                    nb_match = re.search(r'notebook:([a-zA-Z0-9_-]+)', detail)
                    if nb_match:
                        relations.append({"s": source_file, "p": "used-by", "o": f"notebook:{nb_match.group(1)}", "w": 5})
                    # Also match legacy source: tag if present
                    src_match = re.search(r'source:(task-[a-zA-Z0-9_-]+)', detail)
                    if src_match and not nb_match:
                        relations.append({"s": source_file, "p": "used-by", "o": f"notebook:{src_match.group(1)}", "w": 5})

    # 2. Parse Markdown for links (using robust parser)
    memory_path = lib_path / '.memory'
    if memory_path.exists():
        for p in memory_path.rglob('*.md'):
            if p.name.startswith('.'): continue
            try:
                fm = parse_frontmatter(p.read_text(encoding='utf-8', errors='ignore'))
                related = fm.get('related_references', [])
                if isinstance(related, str):
                    related = [t.strip() for t in related.replace('[', '').replace(']', '').split(',')]

                for t in related:
                    if t:
                        relations.append({"s": str(p.relative_to(lib_path)), "p": "related-to", "o": t, "w": 1})
            except (OSError, UnicodeDecodeError, ValueError) as e:
                print(f"[WARN] Skipping {p}: {e}", file=sys.stderr)

    # D3: Atomic write via tmp + rename (per write-protocol.md)
    tmp_path = relations_path.parent / '.relations.jsonl.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        for rel in relations:
            f.write(json.dumps(rel) + '\n')
    tmp_path.rename(relations_path)
    print(f"Generated {len(relations)} relations.")

if __name__ == "__main__":
    rebuild_relations()
