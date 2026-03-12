#!/usr/bin/env python3
"""
Enhanced Library Search with scoring:
  - Keyword matching (base score)
  - used-by count weighting (from .relations.jsonl)
  - Freshness bonus (from file mtime)
  - Related-to recommendations (expand results with associations)

Usage: search.py "<query>" [--type <type>] [--limit 10] [--no-recommend]
"""
import os
import sys
import json
import time
import re
from pathlib import Path
from datetime import datetime, timezone

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
FRESHNESS_WINDOW_DAYS = 30  # Files within this window get freshness bonus
USED_BY_CAP = 5             # Cap for used_by normalization (5 refs = max bonus)
WEIGHT_BASE = 0.5           # Base keyword match weight
WEIGHT_USED_BY = 0.3        # used-by count weight
WEIGHT_FRESHNESS = 0.2      # Freshness weight
RECOMMEND_SCORE_FACTOR = 0.5  # Related recommendations get 50% of parent score
MAX_GRAPH_HOPS = 2            # Max hops for graph traversal (1 = direct, 2 = two-hop)
MAX_GRAPH_EXPAND = 20         # Max nodes to expand in graph search

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def parse_args():
    """Parse command line arguments."""
    args = {"query": "", "type_filter": "", "limit": 10, "recommend": True}
    argv = sys.argv[1:]
    i = 0
    while i < len(argv):
        if argv[i] == "--type" and i + 1 < len(argv):
            args["type_filter"] = argv[i + 1].lower()
            i += 2
        elif argv[i] == "--limit" and i + 1 < len(argv):
            try:
                args["limit"] = int(argv[i + 1])
            except ValueError:
                args["limit"] = 10
            i += 2
        elif argv[i] == "--no-recommend":
            args["recommend"] = False
            i += 1
        elif not args["query"] and not argv[i].startswith("--"):
            args["query"] = argv[i]
            i += 1
        else:
            i += 1
    return args


def load_master_index(path: Path) -> list[dict]:
    """
    Parse .master-index.md into list of entries.
    Format: | Topic | Type | Keywords | File Path | Source |
    """
    entries = []
    if not path.exists():
        return entries

    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or line.startswith('|--') or line.startswith('| Topic'):
                continue
            parts = [p.strip() for p in line.split('|')]
            if len(parts) >= 6:
                entries.append({
                    "topic": parts[1],
                    "type": parts[2],
                    "keywords": parts[3],
                    "path": parts[4],
                    "source": parts[5],
                    "raw_line": line
                })
    return entries


def load_relations(path: Path) -> dict:
    """
    Load .relations.jsonl and build lookup structures.
    Returns: {
        "used_by_count": {file_path: count},
        "related_to": {file_path: [related_paths]}
    }
    """
    used_by_count = {}
    related_to = {}

    if not path.exists():
        return {"used_by_count": used_by_count, "related_to": related_to}

    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rel = json.loads(line)
                source = rel.get("s", "")
                predicate = rel.get("p", "")
                obj = rel.get("o", "")

                if predicate == "used-by":
                    used_by_count[source] = used_by_count.get(source, 0) + 1
                elif predicate == "related-to":
                    if source not in related_to:
                        related_to[source] = []
                    related_to[source].append(obj)
            except json.JSONDecodeError:
                continue

    return {"used_by_count": used_by_count, "related_to": related_to}


def calc_freshness(file_path: Path, lib_path: Path) -> float:
    """
    Calculate freshness score [0, 1] based on file mtime.
    Files within FRESHNESS_WINDOW_DAYS get a score > 0.
    """
    full_path = lib_path / file_path
    if not full_path.exists():
        return 0.0

    try:
        mtime = full_path.stat().st_mtime
        now = time.time()
        days_old = (now - mtime) / 86400
        return max(0.0, 1.0 - days_old / FRESHNESS_WINDOW_DAYS)
    except OSError:
        return 0.0


def keyword_match_score(entry: dict, query: str) -> float:
    """
    Calculate keyword match score.
    - Topic exact match: 1.0
    - Topic contains query: 0.8
    - Keywords contain query: 0.6
    - Type contains query: 0.4
    """
    query_lower = query.lower()
    topic = entry.get("topic", "").lower()
    keywords = entry.get("keywords", "").lower()
    entry_type = entry.get("type", "").lower()

    if topic == query_lower:
        return 1.0
    if query_lower in topic:
        return 0.8
    if query_lower in keywords:
        return 0.6
    if query_lower in entry_type:
        return 0.4
    return 0.0


def search(query: str, type_filter: str, limit: int, recommend: bool, lib_path: Path):
    """Main search function with scoring and recommendations."""
    start_time = time.time()

    master_index_path = lib_path / ".master-index.md"
    relations_path = lib_path / ".relations.jsonl"

    # Load data
    entries = load_master_index(master_index_path)
    if not entries:
        print("[ERROR] Master index not found or empty. Run: library maintain --rebuild-index", file=sys.stderr)
        return

    relations = load_relations(relations_path)
    used_by_count = relations["used_by_count"]
    related_to = relations["related_to"]

    # Phase 1: Keyword matching with scoring
    scored_results = []
    query_lower = query.lower()

    for entry in entries:
        # Apply type filter
        if type_filter and type_filter not in entry.get("type", "").lower():
            continue

        # Check if query matches any field (case-insensitive)
        searchable = f"{entry['topic']} {entry['keywords']} {entry['type']}".lower()
        if query_lower not in searchable:
            continue

        # Calculate base score
        base = keyword_match_score(entry, query)
        if base == 0:
            base = 0.3  # Minimum score for grep-style match

        # Get used_by count
        file_path = entry.get("path", "")
        ub_count = used_by_count.get(file_path, 0)
        ub_norm = min(1.0, ub_count / USED_BY_CAP)

        # Calculate freshness
        freshness = calc_freshness(Path(file_path), lib_path)

        # Final score
        final_score = base * (WEIGHT_BASE + WEIGHT_USED_BY * ub_norm + WEIGHT_FRESHNESS * freshness)

        scored_results.append({
            "entry": entry,
            "score": final_score,
            "base": base,
            "used_by": ub_count,
            "freshness": freshness,
            "is_recommendation": False
        })

    # Sort by score descending
    scored_results.sort(key=lambda x: x["score"], reverse=True)

    # Phase 2: Graph traversal (BFS multi-hop)
    recommendations = []
    if recommend and scored_results:
        seen_paths = {r["entry"]["path"] for r in scored_results}

        # Build path-to-entry lookup for fast access
        path_to_entry = {e["path"]: e for e in entries}
        topic_to_entry = {e["topic"].lower(): e for e in entries}

        # BFS queue: (topic, parent_topic, hop_level, parent_score)
        from collections import deque
        queue = deque()

        # Seed with top scored results
        for result in scored_results[:5]:
            topic = result["entry"]["topic"]
            queue.append((topic, None, 0, result["score"]))

        expanded_count = 0
        while queue and expanded_count < MAX_GRAPH_EXPAND:
            current_topic, parent_topic, hop, parent_score = queue.popleft()

            # Find current entry's path
            current_entry = topic_to_entry.get(current_topic.lower())
            if not current_entry:
                continue

            current_path = current_entry["path"]

            # Get related topics from relations
            related_topics = related_to.get(current_path, [])

            for rel_topic in related_topics:
                rel_entry = topic_to_entry.get(rel_topic.lower())
                if not rel_entry:
                    continue

                rel_path = rel_entry["path"]
                if rel_path in seen_paths:
                    continue

                # Calculate score with decay per hop
                decay = RECOMMEND_SCORE_FACTOR ** (hop + 1)
                rec_score = parent_score * decay

                recommendations.append({
                    "entry": rel_entry,
                    "score": rec_score,
                    "base": 0,
                    "used_by": used_by_count.get(rel_path, 0),
                    "freshness": calc_freshness(Path(rel_path), lib_path),
                    "is_recommendation": True,
                    "recommended_by": current_topic,
                    "hop": hop + 1
                })
                seen_paths.add(rel_path)
                expanded_count += 1

                # Continue BFS if within hop limit
                if hop + 1 < MAX_GRAPH_HOPS:
                    queue.append((rel_topic, current_topic, hop + 1, rec_score))

    # Merge and limit
    all_results = scored_results + recommendations
    all_results.sort(key=lambda x: x["score"], reverse=True)
    all_results = all_results[:limit]

    # Output
    print("--- Search Results (Graph-Enhanced) ---")
    print(f"{'Score':<8} {'Hop':<5} {'Topic':<28} {'Type':<15} {'Used':<6} {'Fresh':<6} {'Path'}")
    print("-" * 110)

    direct_count = 0
    rec_count = 0

    for r in all_results:
        e = r["entry"]
        hop = r.get("hop", 0)
        hop_str = f"H{hop}" if hop > 0 else "-"
        rec_by = f" ← {r.get('recommended_by', '')}" if r.get("recommended_by") else ""

        print(f"{r['score']:<8.3f} {hop_str:<5} {e['topic'][:26]:<28} {e['type'][:13]:<15} {r['used_by']:<6} {r['freshness']:<6.2f} {e['path'][:40]}{rec_by}")

        if r["is_recommendation"]:
            rec_count += 1
        else:
            direct_count += 1

    if not all_results:
        print("No matches found.")

    elapsed = (time.time() - start_time) * 1000
    print(f"\n[PERF] search took {elapsed:.0f}ms | {direct_count} direct, {rec_count} recommended")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    args = parse_args()

    if not args["query"]:
        print("[ERROR] Search query is required.", file=sys.stderr)
        print("Usage: search.py \"<query>\" [--type <type>] [--limit 10] [--no-recommend]", file=sys.stderr)
        sys.exit(1)

    lib_path = Path(os.getenv('NB_WORKSPACES_LIBRARY', os.getenv('NB_WORKSPACES_ROOT', '.') + '/.library'))

    search(
        query=args["query"],
        type_filter=args["type_filter"],
        limit=args["limit"],
        recommend=args["recommend"],
        lib_path=lib_path
    )
