#!/usr/bin/env python3
import os
import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'core'))
from frontmatter import parse_frontmatter

def audit_library():
    lib_path = Path(os.getenv('NB_WORKSPACES_LIBRARY', os.getenv('NB_WORKSPACES_ROOT', '.') + '/.library'))
    memory_path = lib_path / '.memory'
    master_index_path = lib_path / '.master-index.md'
    
    if not lib_path.exists():
        print(f"[ERROR] Library path {lib_path} missing.")
        return

    print(f"--- Library Health Audit: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ---")
    
    indexed_files = set()
    if master_index_path.exists():
        with open(master_index_path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.startswith('|') and '.md' in line:
                    parts = line.split('|')
                    if len(parts) >= 5:
                        path = parts[4].strip()
                        indexed_files.add(path)

    physical_files = set()
    staleness_threshold = 90
    stale_count = 0
    orphan_count = 0
    now = datetime.now()
    
    if memory_path.exists():
        for p in memory_path.rglob('*.md'):
            if p.name.startswith('.') or p.name == '.index.md': continue
            
            rel_path = str(p.relative_to(lib_path))
            physical_files.add(rel_path)
            
            try:
                content = p.read_text(encoding='utf-8', errors='ignore')
                fm = parse_frontmatter(content)
                last_ver = fm.get('last_verified_at')
                if last_ver:
                    # Support both YYYY-MM-DD and other standard formats if needed
                    last_ver_date = datetime.strptime(last_ver, '%Y-%m-%d')
                    age = (now - last_ver_date).days
                    if age > staleness_threshold:
                        print(f"[STALE] {rel_path}: {age} days since last verification")
                        stale_count += 1
            except (OSError, UnicodeDecodeError, ValueError) as e:
                print(f"[WARN] Skipping {rel_path}: {e}", file=sys.stderr)

    orphans = physical_files - indexed_files
    ghosts = indexed_files - physical_files
    
    for o in orphans:
        print(f"[ORPHAN] File exists but not indexed: {o}")
        orphan_count += 1
    
    for g in ghosts:
        print(f"[GHOST] Indexed but file missing: {g}")

    inc_log = lib_path / '.inconsistency.log'
    if inc_log.exists():
        print(f"\n--- Pending Inconsistencies (.inconsistency.log) ---")
        print(inc_log.read_text())

    print(f"\nAudit Summary:")
    print(f"- Total Files: {len(physical_files)}")
    print(f"- Stale References: {stale_count}")
    print(f"- Orphan Files: {orphan_count}")
    print(f"- Ghost Entries: {len(ghosts)}")
    
    if not orphans and not ghosts and stale_count == 0:
        print("\n[RESULT] Library is HEALTHY.")
    else:
        print("\n[RESULT] Library needs MAINTENANCE.")

if __name__ == "__main__":
    audit_library()
