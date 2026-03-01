#!/usr/bin/env python3
import os
import sys
import json
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
        for p in dir_path.rglob('*.md'):
            if p.name.startswith('.') or p.name == '.index.md': continue
            
            try:
                content = p.read_text(encoding='utf-8')
                fm = parse_frontmatter(content)
                
                topic = fm.get('topic') or fm.get('title') or p.stem
                type_field = fm.get('type', 'generic')
                keywords = fm.get('keywords', '')
                if isinstance(keywords, list): keywords = ', '.join(keywords)
                
                rel_path = p.relative_to(lib_path)
                master_rows.append(f"| {topic} | {type_field} | {keywords} | {rel_path} | system |")
                
                updated = fm.get('last_verified_at') or datetime.fromtimestamp(p.stat().st_mtime).strftime('%Y-%m-%d')
                dir_rows.append(f"| {topic} | {type_field} | {updated} | {p.name} |")
            except (IOError, UnicodeDecodeError) as e:
                print(f"[ERROR] Failed to read {p}: {e}")

        if dir_rows:
            index_md = dir_path / '.index.md'
            with open(index_md, 'w', encoding='utf-8') as f:
                f.write(f"# {cat_type} Index\n\n| Topic | Type | Updated | File |\n|-------|------|---------|------|\n")
                f.write('\n'.join(sorted(dir_rows)) + '\n')

    if master_rows:
        with open(master_index_path, 'w', encoding='utf-8') as f:
            f.write("# Library Master Index\n\n| Topic | Type | Keywords | File Path | Source |\n|-------|------|----------|-----------|--------|\n")
            f.write('\n'.join(sorted(master_rows)) + '\n')

if __name__ == "__main__":
    rebuild_index()
