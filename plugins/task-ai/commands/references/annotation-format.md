# Annotation Format (for `annotate` sub-command)

Annotations arrive as **JSONL** (one JSON object per line) in the prompt context. The frontend prepends `/task-ai:annotate\n` for system files (`.working/` dotfiles).

## Field Reference

**Common fields (all types)**:

| Field | Type | Description |
|-------|------|-------------|
| `file` | string | Absolute path to the annotated file |
| `type` | string | `'insert'` \| `'delete'` \| `'replace'` \| `'comment'` |
| `selected` | string | User-selected text (max 80 chars) |
| `cursor` | number | Character offset of selection start in source file text |

**Type-specific fields**:

| Type | Extra field | Description |
|------|------------|-------------|
| `insert` | `content` | Text to insert after the selected position |
| `delete` | (none) | `selected` is the text to delete |
| `replace` | `replacement` | Text to replace `selected` with |
| `comment` | `comment` | Comment on the selected text |

## Example

```jsonl
{"file":"/home/user/nb-workspaces/proj/.worktrees/task-1/.working/.target.md","type":"replace","selected":"Max response time: 500ms","cursor":42,"replacement":"Max response time: 200ms"}
```

## Positioning

`cursor` is the character offset in the **source file** (not rendered text). The model uses `cursor` + `selected` as dual anchors to locate the exact position in the source file. When multiple annotations target the same file, group them by `file` and read each source file only once.

> See `skills/annotate/references/annotation-processing.md` for full processing logic.
