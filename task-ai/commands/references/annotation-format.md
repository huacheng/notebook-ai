# Annotation Format (for `annotate` sub-command)

Annotations arrive as **JSONL** (one JSON object per line) in the prompt context. The frontend prepends `/task-ai:annotate\n` for system files (`.working/` dotfiles).

## Field Reference

**Common fields (all types)**:

| Field | Type | Description |
|-------|------|-------------|
| `file` | string | Absolute path to the annotated file |
| `type` | string | `'insert'` \| `'delete'` \| `'replace'` \| `'comment'` |
| `selected` | string | User-selected text (from rendered text, not source) |
| `before` | string | Rendered text context before selection (≤40 chars) |
| `after` | string | Rendered text context after selection (≤40 chars) |

**Type-specific fields**:

| Type | Extra field | Description |
|------|------------|-------------|
| `insert` | `content` | Text to insert after the selected position |
| `delete` | (none) | `selected` is the text to delete |
| `replace` | `replacement` | Text to replace `selected` with |
| `comment` | `comment` | Comment on the selected text |

## Example

```jsonl
{"file":"/home/user/nb-workspaces/proj/task-1/.working/.target.md","type":"replace","selected":"Max response time: 500ms","before":"Performance\n","after":"\nMax memory usage: 512MB","replacement":"Max response time: 200ms"}
```

## Positioning

`before` + `selected` + `after` are extracted from **rendered visible text** (`container.innerText`), not markdown source. They form a unique positional anchor. Claude reads the source file and maps rendered-text context → source location using markdown syntax knowledge.

> See `skills/annotate/references/annotation-processing.md` for full processing logic.
