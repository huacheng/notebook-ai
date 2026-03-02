# Mention System Design

**Date:** 2026-03-02
**Status:** Approved

## Overview

Implement a generic mention system for the notebook prompt textarea with three triggers:

| Trigger | Function | Behavior |
|---------|----------|----------|
| `/` | Slash commands | Flat list, filter by query, insert command text |
| `@` | File references | Tree navigation, workspaceDir scope, insert path |
| `#` | Cell references | Flat list, filter by index/content, insert `#N` |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  NotebookInputBar                                           │
│  ├─ textarea (controlled)                                   │
│  └─ useMention(plugins) ─────────────────────────────┐      │
│       ├─ Detect trigger chars (`/`, `@`, `#`)         │      │
│       ├─ Manage popup state (open, position, plugin)  │      │
│       └─ Handle keyboard (↑↓ nav, Tab select, Esc)    │      │
│                                                       ▼      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  MentionPopup (position: absolute)                  │    │
│  │  ├─ Render activePlugin.renderItem()                │    │
│  │  └─ Keyboard navigation handled by useMention       │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Core Types

```typescript
interface MentionPlugin<T> {
  trigger: string;                              // '/', '@', '#'
  fetchItems: (query: string) => Promise<T[]>;  // Fetch list items
  renderItem: (item: T, selected: boolean) => ReactNode;
  onSelect: (item: T) => string;                // Return text to insert
  // Optional: tree navigation (for @ files)
  isNavigable?: (item: T) => boolean;           // Can enter (directory)
  onNavigate?: (item: T) => Promise<T[]>;       // Fetch children
}
```

## Plugin Specifications

### SlashCommandPlugin (`/`)

- **Source:** Backend API `GET /api/commands`
- **Cache:** Store in Zustand, fetch once per session
- **Filter:** Match `name` or `label` fields
- **Insert:** `/{command.name} ` (with trailing space)

```typescript
interface Command {
  name: string;    // "task-ai:target"
  label: string;   // "target define"
}
```

**Preset commands:**
1. `task-ai:target` → "target define"
2. `task-ai:research` → "research"
3. `task-ai:read` → "read"
4. `task-ai:library search` → "search"

### FileTreePlugin (`@`)

- **Source:** Existing API `GET /api/sessions/:id/files?path=`
- **Scope:** `workspaceDir` only
- **Navigation:** ↑↓ to move, Tab to enter directory, Backspace to go up
- **Insert:** `@{relativePath} ` (with trailing space)

```typescript
interface FileEntry {
  name: string;
  path: string;      // Relative path
  isDir: boolean;
}
```

### CellRefPlugin (`#`)

- **Source:** `useStore.getState().notebook.cells`
- **Filter:** Match cell index or source preview
- **Insert:** `#{index} ` (with trailing space)

```typescript
interface CellRef {
  index: number;
  preview: string;   // First 50 chars of source
}
```

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move selection |
| `Tab` / `Enter` | Select item (or enter directory for `@`) |
| `Backspace` | Go up one level (tree mode, when query empty) |
| `Escape` | Close popup |
| Continue typing | Filter list |

## Popup Positioning

- Calculate caret coordinates using hidden mirror div
- Position popup below caret with 4px offset
- Max height: 240px with overflow scroll
- Z-index: 100 (above other UI)

## Backend API

### GET /api/commands

```typescript
// Response
{
  commands: [
    { name: "task-ai:target", label: "target define" },
    { name: "task-ai:research", label: "research" },
    { name: "task-ai:read", label: "read" },
    { name: "task-ai:library search", label: "search" }
  ]
}
```

## File Structure

### New Files

```
packages/web/src/
├── hooks/
│   └── useMention.ts           # Core hook
├── components/
│   └── MentionPopup.tsx        # Popup UI
├── mention/
│   ├── types.ts                # MentionPlugin interface
│   ├── SlashCommandPlugin.ts   # `/` plugin
│   ├── FileTreePlugin.ts       # `@` plugin
│   └── CellRefPlugin.ts        # `#` plugin

packages/server/src/
└── routes/
    └── commands.ts             # GET /api/commands
```

### Modified Files

| File | Changes |
|------|---------|
| `Notebook.tsx` | Integrate `useMention` in `NotebookInputBar` |
| `store/index.ts` | Add `commands` and `commandsLoaded` state |
| `server/index.ts` | Register `/api/commands` route |
| `styles.css` | Add `.mention-*` styles |

## Styling

```css
.mention-popup {
  position: absolute;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-cell);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 100;
}

.mention-item {
  padding: 8px 12px;
  cursor: pointer;
}

.mention-item.selected {
  background: var(--color-primary-light);
}
```

## Testing Requirements

- **TDD Red/Green:** Each component must have failing test first, then implementation
- **Unit tests:** `useMention` hook, each plugin's `fetchItems`/`onSelect`
- **Integration tests:** Keyboard navigation, popup positioning
- **Regression tests:** Existing textarea functionality (paste, drop, submit)

## Implementation Order

1. Types and interfaces
2. Backend `/api/commands` route
3. `useMention` hook (core logic)
4. `MentionPopup` component
5. Three plugins in order: Slash → File → Cell
6. Integration into `NotebookInputBar`
7. Styles
8. Full regression test suite
