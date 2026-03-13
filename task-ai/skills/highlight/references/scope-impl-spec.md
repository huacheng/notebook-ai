# scope=impl — Implementation Experience Write Specification

Extracted from SKILL.md §3.1. This file contains the detailed write spec, frontmatter template, content structure, and write steps.

## Write Spec

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<semantic>-impl.md` |
| Write mode | O_APPEND + `---` separator (create if not exists) |
| Lock | `.memory/.experiences/.lock` |
| quality_status | `provisional` |
| completeness | `partial` |
| source | `highlight-exec` |

## Frontmatter

```yaml
---
semantic_name: <kebab-case-knowledge-domain>
type: <from .status.json>
sources:
  - notebook: <notebook-name>
    project: <project-path>
    stage: <stage-number>
    date: <YYYY-MM-DD>
quality_status: provisional
completeness: partial
source: highlight-exec
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2]
---
```

## Content Structure

```markdown
## Implementation Experience — <semantic_name> (<date>)

### Decisions
- <decision 1>: <rationale>

### Patterns
- <pattern/technique discovered>

### Pitfalls
- <pitfall/workaround>

### Deviations from Plan
- <what changed and why>
```

## Write Steps

**Use `library write` for all library writes** — ensures proper locking, changelog, and index updates.

1. Generate content per Content Structure above (with frontmatter)
2. Execute:
   ```bash
   /task-ai:library write ".memory/.experiences/<type>/<semantic>-impl.md" \
     --content-file <temp-content-file> \
     --notebook <notebook-name>
   ```

The `library write` command handles the full 8-step protocol internally:
- Lock acquisition (directory-level `.lock`)
- Atomic write (.tmp → rename)
- Changelog append
- Index updates (.index.md + .master-index.md)
- Relations update (.relations.jsonl)
- Lock release
- Git commit

> **WARNING**: Do NOT use direct Write tool for library writes — it bypasses concurrency protection.
