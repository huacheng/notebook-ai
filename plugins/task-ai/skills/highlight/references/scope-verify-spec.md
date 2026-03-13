# scope=verify — Verification Experience Write Specification

Extracted from SKILL.md §3.2. This file contains the detailed write spec, frontmatter template, and content structure.

## Write Spec

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<semantic>-verify.md` |
| Write mode | O_APPEND + `---` separator |
| Lock | `.memory/.experiences/.lock` |
| quality_status | `provisional` |
| completeness | `partial` |
| source | `highlight-verify` |

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
source: highlight-verify
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2]
---
```

## Content Structure

```markdown
## Verification Experience — <semantic_name> (<date>)

### Test Results
- <outcome summary>

### Effective Methods
- <what verification approaches worked>

### Thresholds
- <discovered metric ranges>

### VFP Patterns (software types)
- <VH stub techniques, CGG results, refactoring patterns>
```

## Write Steps

**Use `library write` for all library writes** — same as scope=impl.

1. Generate content per Content Structure above (with frontmatter)
2. Execute:
   ```bash
   /task-ai:library write ".memory/.experiences/<type>/<semantic>-verify.md" \
     --content-file <temp-content-file> \
     --notebook <notebook-name>
   ```

> **WARNING**: Do NOT use direct Write tool for library writes — it bypasses concurrency protection.
