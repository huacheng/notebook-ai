#!/usr/bin/env python3
"""Rebuild all .index.md files and .master-index.md from filesystem state (stdlib only, Python >= 3.9)."""
import os
import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'core'))
from frontmatter import parse_frontmatter

def rebuild_index():
    lib_path = Path(os.getenv('NB_WORKSPACES_LIBRARY', os.getenv('NB_WORKSPACES_ROOT', '.') + '/.library'))
    memory_path = lib_path / '.memory'
    master_index_path = lib_path / '.master-index.md'

    if not lib_path.exists(): return

    master_rows = []
    categories = {
        '.references': 'Reference',
        '.experiences': 'Experience',
        '.type-profiles': 'Type-Profile',
        '.thinking/patterns': 'Pattern'
    }

    for sub_dir_name, cat_type in categories.items():
        dir_path = memory_path / sub_dir_name
        if not dir_path.exists(): continue

        dir_rows = []
        # D1: For .experiences/, also collect per-subdirectory rows for sub-indexes
        subdir_rows: dict[Path, list[str]] = {}
        for p in dir_path.rglob('*.md'):
            if p.name.startswith('.'): continue

            try:
                content = p.read_text(encoding='utf-8', errors='ignore')
                fm = parse_frontmatter(content)

                topic = fm.get('topic') or fm.get('title') or p.stem
                type_field = fm.get('type', 'generic')
                keywords = fm.get('keywords', '')
                if isinstance(keywords, list): keywords = ', '.join(keywords)

                rel_path = p.relative_to(lib_path)
                master_rows.append(f"| {topic} | {type_field} | {keywords} | {rel_path} | system |")

                updated = fm.get('last_verified_at') or datetime.fromtimestamp(p.stat().st_mtime).strftime('%Y-%m-%d')
                row = f"| {topic} | {type_field} | {updated} | {p.name} |"
                dir_rows.append(row)

                # D1: Track rows per immediate subdirectory for per-type indexes
                if sub_dir_name == '.experiences' and p.parent != dir_path:
                    subdir_rows.setdefault(p.parent, []).append(row)
            except (OSError, UnicodeDecodeError, ValueError) as e:
                print(f"[ERROR] Failed to read {p}: {e}")

        if dir_rows:
            index_md = dir_path / '.index.md'
            # D3: Atomic write via tmp + rename (per write-protocol.md)
            tmp_path = dir_path / '.index.md.tmp'
            with open(tmp_path, 'w', encoding='utf-8') as f:
                f.write(f"# {cat_type} Index\n\n| Topic | Type | Updated | File |\n|-------|------|---------|------|\n")
                f.write('\n'.join(sorted(dir_rows)) + '\n')
            tmp_path.rename(index_md)

        # D1: Write per-type sub-indexes for .experiences/<type>/ directories
        for sub_path, rows in subdir_rows.items():
            sub_index = sub_path / '.index.md'
            sub_tmp = sub_path / '.index.md.tmp'
            with open(sub_tmp, 'w', encoding='utf-8') as f:
                f.write(f"# {sub_path.name} Experience Index\n\n| Topic | Type | Updated | File |\n|-------|------|---------|------|\n")
                f.write('\n'.join(sorted(rows)) + '\n')
            sub_tmp.rename(sub_index)

    # D1: Always write master index (even if empty) to ensure consistent state
    tmp_master = master_index_path.parent / '.master-index.md.tmp'
    with open(tmp_master, 'w', encoding='utf-8') as f:
        f.write("# Library Master Index\n\n| Topic | Type | Keywords | File Path | Source |\n|-------|------|----------|-----------|--------|\n")
        if master_rows:
            f.write('\n'.join(sorted(master_rows)) + '\n')
    tmp_master.rename(master_index_path)
    print(f"[rebuild-index] Master index: {len(master_rows)} entries")

if __name__ == "__main__":
    rebuild_index()
