# scope=verify — Verification Experience Write Specification

Extracted from SKILL.md §3.2. This file contains the detailed write spec, frontmatter template, and content structure.

## Write Spec

| Field | Value |
|-------|-------|
| Target file | `$NB_WORKSPACES_LIBRARY/.memory/.experiences/<type>/<notebook>-verify.md` |
| Write mode | O_APPEND + `---` separator |
| Lock | `.memory/.experiences/.lock` |
| quality_status | `provisional` |
| completeness | `partial` |
| source | `highlight-verify` |

## Frontmatter

```yaml
---
quality_status: provisional
completeness: partial
source: highlight-verify
type: <from .status.json>
notebook: <notebook-name>
created_at: <ISO-8601>
topic_keywords: [keyword1, keyword2]
---
```

## Content Structure

```markdown
## Verification Experience — <notebook> (<date>)

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

Same as scope=impl (steps 1-5), with different filename (`<notebook>-verify.md`) and source field (`highlight-verify`).
