#!/usr/bin/env python3
"""L2: Verify data flow contract - producers mention artifacts, consumers reference them"""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from lib import (
    find_skills, load_fixture, strip_code_blocks,
    emit_pass, emit_fail, emit_warn, summary,
    TASK_AI_ROOT
)

artifacts = load_fixture('expected-artifacts.json')
data_flow = artifacts['data_flow']

# Load all SKILL.md content (stripped of code blocks)
skill_contents: dict[str, str] = {}
for skill_file in find_skills():
    skill_name = skill_file.parent.name
    content = strip_code_blocks(skill_file.read_text())
    skill_contents[skill_name] = content

# Also load command references
refs_dir = TASK_AI_ROOT / 'commands' / 'references'
if refs_dir.exists():
    for ref_file in refs_dir.glob('*.md'):
        content = strip_code_blocks(ref_file.read_text())
        skill_contents[f'ref:{ref_file.stem}'] = content

for entry in data_flow:
    producer = entry['producer']
    artifact = entry['artifact']
    consumers = entry['consumers']

    # Check producer mentions the artifact
    # Extract a searchable keyword from the artifact name
    keywords = []
    # Clean up artifact name for searching
    clean = artifact.replace('[', '').replace(']', '').replace('...', '')
    # Split into searchable parts
    parts = clean.split()
    for part in parts:
        p = part.strip('.,/()').strip()
        if len(p) > 3 and p not in ('in', 'the', 'and', 'for'):
            keywords.append(p)

    if not keywords:
        keywords = [clean.strip()]

    # Check producer
    producer_found = False
    if producer in skill_contents:
        for kw in keywords:
            if kw.lower() in skill_contents[producer].lower():
                producer_found = True
                break

    if producer_found:
        emit_pass(f'data-flow: {producer} mentions artifact "{artifact}"')
    else:
        emit_fail(f'data-flow: {producer} does NOT mention artifact "{artifact}"')

    # Check consumers
    for consumer in consumers:
        if consumer == 'daemon':
            # daemon is the auto execution loop
            consumer_key = 'auto'
        elif consumer == 'user':
            continue  # Skip user consumers
        else:
            consumer_key = consumer

        consumer_found = False
        if consumer_key in skill_contents:
            for kw in keywords:
                if kw.lower() in skill_contents[consumer_key].lower():
                    consumer_found = True
                    break

        if consumer_found:
            emit_pass(f'data-flow: {consumer} references artifact "{artifact}"')
        else:
            emit_fail(f'data-flow: {consumer} does NOT reference artifact "{artifact}"')

sys.exit(summary())
