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

1. acquire `.memory/.experiences/.lock`
2. O_APPEND write to `<semantic>-impl.md` (if file has frontmatter, append after `---` separator)
3. acquire `.changelog.lock` → append: `<ts> | experience | .memory/.experiences/<type>/<semantic>-impl.md | quality_status:provisional | source:highlight-exec` → release `.changelog.lock`
4. update `<type>/.index.md` (overwrite matching row or append new row)
5. release `.memory/.experiences/.lock`
