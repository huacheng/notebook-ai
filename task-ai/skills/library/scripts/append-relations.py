#!/usr/bin/env python3
"""
Append relations to .relations.jsonl for a newly written library file.

Usage: append-relations.py <file_path> [--notebook <notebook_name>]

Extracts:
  - related_references from frontmatter → "related-to" relations
  - notebook tag (if provided) → "used-by" relation

Appends to .relations.jsonl using O_APPEND for atomicity.
"""
import os
import sys
import json
import fcntl
from pathlib import Path

# Import frontmatter parser from core
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'core'))
from frontmatter import parse_frontmatter


def append_relations(file_path: str, notebook: str = None):
    """
    Read frontmatter from file_path, extract relations, append to .relations.jsonl.
    """
    lib_path = Path(os.getenv('NB_WORKSPACES_LIBRARY', os.getenv('NB_WORKSPACES_ROOT', '.') + '/.library'))
    relations_path = lib_path / '.relations.jsonl'

    full_path = Path(file_path)
    if not full_path.is_absolute():
        full_path = lib_path / file_path

    if not full_path.exists():
        print(f"[WARN] File not found: {full_path}", file=sys.stderr)
        return

    # Compute relative path for storage
    try:
        rel_path = str(full_path.relative_to(lib_path))
    except ValueError:
        rel_path = file_path

    relations = []

    # 1. Extract related_references from frontmatter
    try:
        content = full_path.read_text(encoding='utf-8', errors='ignore')
        fm = parse_frontmatter(content)

        related = fm.get('related_references', [])
        if isinstance(related, str):
            # Parse comma-separated or bracketed list
            related = [t.strip() for t in related.replace('[', '').replace(']', '').split(',')]

        for topic in related:
            topic = topic.strip()
            if topic:
                relations.append({
                    "s": rel_path,
                    "p": "related-to",
                    "o": topic,
                    "w": 1
                })
    except (OSError, UnicodeDecodeError, ValueError) as e:
        print(f"[WARN] Failed to parse frontmatter: {e}", file=sys.stderr)

    # 2. Add used-by relation if notebook provided
    if notebook:
        relations.append({
            "s": rel_path,
            "p": "used-by",
            "o": f"notebook:{notebook}",
            "w": 5
        })

    # 3. Append to .relations.jsonl (O_APPEND for atomicity, with shared lock
    #    to prevent data loss during concurrent rebuild-relations.py full rebuild)
    if relations:
        # Ensure parent directory exists
        relations_path.parent.mkdir(parents=True, exist_ok=True)

        lock_path = relations_path.parent / '.relations.lock'
        lock_fd = open(lock_path, 'w')
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
            with open(relations_path, 'a', encoding='utf-8') as f:
                for rel in relations:
                    f.write(json.dumps(rel) + '\n')
        finally:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            lock_fd.close()
            try:
                lock_path.unlink()
            except OSError:
                pass

        print(f"[relations] Appended {len(relations)} relation(s) for {rel_path}")
    else:
        print(f"[relations] No relations to append for {rel_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: append-relations.py <file_path> [--notebook <name>]", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    notebook = None

    # Parse --notebook argument
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == '--notebook' and i + 1 < len(sys.argv):
            notebook = sys.argv[i + 1]
            i += 2
        else:
            i += 1

    append_relations(file_path, notebook)


if __name__ == "__main__":
    main()
