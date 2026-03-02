# Mention System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a generic mention system to the notebook prompt textarea with `/` (commands), `@` (files), `#` (cells) triggers.

**Architecture:** Plugin-based mention system with `useMention` hook managing trigger detection, popup state, and keyboard navigation. Each trigger has a dedicated plugin implementing a common interface.

**Tech Stack:** React hooks, Zustand store, Express route, Vitest for TDD

---

## Task 1: MentionPlugin Type Definitions

**Files:**
- Create: `packages/web/src/mention/types.ts`
- Test: `packages/web/src/__tests__/mentionTypes.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/src/__tests__/mentionTypes.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('MentionPlugin types', () => {
  it('types.ts should export MentionPlugin interface', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/types.ts'),
      'utf-8',
    );
    expect(src).toMatch(/export interface MentionPlugin/);
    expect(src).toMatch(/trigger:\s*string/);
    expect(src).toMatch(/fetchItems:/);
    expect(src).toMatch(/renderItem:/);
    expect(src).toMatch(/onSelect:/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/__tests__/mentionTypes.test.ts`
Expected: FAIL with "ENOENT: no such file"

**Step 3: Write implementation**

```typescript
// packages/web/src/mention/types.ts
import type { ReactNode } from 'react';

export interface MentionPlugin<T = unknown> {
  /** Trigger character: '/', '@', '#' */
  trigger: string;
  /** Fetch items matching query */
  fetchItems: (query: string) => Promise<T[]>;
  /** Render a single item */
  renderItem: (item: T, selected: boolean) => ReactNode;
  /** Return text to insert when item selected */
  onSelect: (item: T) => string;
  /** Optional: can this item be navigated into (directory) */
  isNavigable?: (item: T) => boolean;
  /** Optional: fetch children when navigating into item */
  onNavigate?: (item: T) => Promise<T[]>;
}

export interface MentionState<T = unknown> {
  open: boolean;
  plugin: MentionPlugin<T> | null;
  query: string;
  items: T[];
  selectedIndex: number;
  triggerPos: number;
  path: T[];  // Navigation stack for tree mode
}

export interface Command {
  name: string;
  label: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface CellRef {
  index: number;
  id: string;
  preview: string;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/__tests__/mentionTypes.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/mention/types.ts packages/web/src/__tests__/mentionTypes.test.ts
git commit -m "feat(mention): add MentionPlugin type definitions"
```

---

## Task 2: Backend /api/commands Route

**Files:**
- Create: `packages/server/src/routes/commands.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/__tests__/commandsRoute.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/__tests__/commandsRoute.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('/api/commands route', () => {
  it('commands.ts should export router with GET handler', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../routes/commands.ts'),
      'utf-8',
    );
    expect(src).toMatch(/router\.get\(['"]\/['"]/);
    expect(src).toMatch(/task-ai:target/);
    expect(src).toMatch(/task-ai:research/);
    expect(src).toMatch(/task-ai:read/);
    expect(src).toMatch(/task-ai:library search/);
  });

  it('index.ts should register /api/commands route', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf-8',
    );
    expect(src).toMatch(/\/api\/commands/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/__tests__/commandsRoute.test.ts`
Expected: FAIL with "ENOENT: no such file"

**Step 3: Write implementation**

```typescript
// packages/server/src/routes/commands.ts
import { Router } from 'express';

const router = Router();

interface Command {
  name: string;
  label: string;
}

const COMMANDS: Command[] = [
  { name: 'task-ai:target', label: 'target define' },
  { name: 'task-ai:research', label: 'research' },
  { name: 'task-ai:read', label: 'read' },
  { name: 'task-ai:library search', label: 'search' },
];

router.get('/', (_req, res) => {
  res.json({ commands: COMMANDS });
});

export default router;
```

**Step 4: Register route in index.ts**

Find the route registration section and add:

```typescript
import commandsRouter from './routes/commands';
// ... after other route registrations
app.use('/api/commands', commandsRouter);
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run packages/server/src/__tests__/commandsRoute.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/routes/commands.ts packages/server/src/index.ts packages/server/src/__tests__/commandsRoute.test.ts
git commit -m "feat(api): add /api/commands route for slash commands"
```

---

## Task 3: Commands State in Store

**Files:**
- Modify: `packages/web/src/store/wsSlice.ts`
- Test: `packages/web/src/__tests__/commandsState.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/src/__tests__/commandsState.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('commands state in store', () => {
  it('wsSlice should have commands and commandsLoaded state', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../store/wsSlice.ts'),
      'utf-8',
    );
    expect(src).toMatch(/commands:\s*\[\]/);
    expect(src).toMatch(/commandsLoaded:\s*false/);
  });

  it('wsSlice should have setCommands action', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../store/wsSlice.ts'),
      'utf-8',
    );
    expect(src).toMatch(/setCommands:/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/__tests__/commandsState.test.ts`
Expected: FAIL

**Step 3: Add to wsSlice.ts state interface and initial state**

Add to state interface:
```typescript
commands: Command[];
commandsLoaded: boolean;
setCommands: (commands: Command[]) => void;
```

Add to initial state:
```typescript
commands: [],
commandsLoaded: false,
```

Add action:
```typescript
setCommands: (commands) => set({ commands, commandsLoaded: true }),
```

Import Command type:
```typescript
import type { Command } from '../mention/types';
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/__tests__/commandsState.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/store/wsSlice.ts packages/web/src/__tests__/commandsState.test.ts
git commit -m "feat(store): add commands state for slash command caching"
```

---

## Task 4: useMention Hook - Core Logic

**Files:**
- Create: `packages/web/src/hooks/useMention.ts`
- Test: `packages/web/src/__tests__/useMention.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/src/__tests__/useMention.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('useMention hook', () => {
  it('should export useMention function', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../hooks/useMention.ts'),
      'utf-8',
    );
    expect(src).toMatch(/export function useMention/);
  });

  it('should detect trigger characters', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../hooks/useMention.ts'),
      'utf-8',
    );
    // Must have trigger detection logic
    expect(src).toMatch(/plugin\.trigger/);
    expect(src).toMatch(/triggerPos/);
  });

  it('should handle keyboard navigation', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../hooks/useMention.ts'),
      'utf-8',
    );
    expect(src).toMatch(/ArrowUp/);
    expect(src).toMatch(/ArrowDown/);
    expect(src).toMatch(/Tab|Enter/);
    expect(src).toMatch(/Escape/);
  });

  it('should return state and handlers', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../hooks/useMention.ts'),
      'utf-8',
    );
    expect(src).toMatch(/return\s*\{/);
    expect(src).toMatch(/state/);
    expect(src).toMatch(/handleChange/);
    expect(src).toMatch(/handleKeyDown/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/__tests__/useMention.test.ts`
Expected: FAIL with "ENOENT"

**Step 3: Write implementation**

```typescript
// packages/web/src/hooks/useMention.ts
import { useState, useCallback, useRef } from 'react';
import type { MentionPlugin, MentionState } from '../mention/types';

const INITIAL_STATE: MentionState = {
  open: false,
  plugin: null,
  query: '',
  items: [],
  selectedIndex: 0,
  triggerPos: -1,
  path: [],
};

export function useMention<T>(plugins: MentionPlugin<T>[]) {
  const [state, setState] = useState<MentionState<T>>(INITIAL_STATE as MentionState<T>);
  const fetchingRef = useRef(false);

  const close = useCallback(() => {
    setState(INITIAL_STATE as MentionState<T>);
  }, []);

  const handleChange = useCallback(async (
    value: string,
    cursorPos: number,
  ) => {
    // Find if any trigger character precedes cursor
    for (const plugin of plugins) {
      const triggerIdx = value.lastIndexOf(plugin.trigger, cursorPos - 1);
      if (triggerIdx === -1) continue;

      // Check if trigger is at start or after whitespace
      if (triggerIdx > 0 && !/\s/.test(value[triggerIdx - 1])) continue;

      // Check no whitespace between trigger and cursor
      const query = value.slice(triggerIdx + 1, cursorPos);
      if (/\s/.test(query)) continue;

      // Trigger detected - fetch items
      if (!fetchingRef.current) {
        fetchingRef.current = true;
        try {
          const items = await plugin.fetchItems(query);
          setState({
            open: true,
            plugin: plugin as MentionPlugin<unknown> as MentionPlugin<T>,
            query,
            items: items as T[],
            selectedIndex: 0,
            triggerPos: triggerIdx,
            path: [],
          });
        } finally {
          fetchingRef.current = false;
        }
      }
      return;
    }

    // No trigger found - close if open
    if (state.open) close();
  }, [plugins, state.open, close]);

  const handleKeyDown = useCallback((
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    getText: () => string,
    setText: (v: string) => void,
  ) => {
    if (!state.open || !state.plugin) return false;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        setState(s => ({
          ...s,
          selectedIndex: Math.max(0, s.selectedIndex - 1),
        }));
        return true;

      case 'ArrowDown':
        e.preventDefault();
        setState(s => ({
          ...s,
          selectedIndex: Math.min(s.items.length - 1, s.selectedIndex + 1),
        }));
        return true;

      case 'Tab':
      case 'Enter':
        e.preventDefault();
        const item = state.items[state.selectedIndex];
        if (!item) return true;

        if (state.plugin.isNavigable?.(item)) {
          // Navigate into directory
          fetchingRef.current = true;
          state.plugin.onNavigate?.(item).then(children => {
            setState(s => ({
              ...s,
              items: children as T[],
              selectedIndex: 0,
              path: [...s.path, item],
              query: '',
            }));
            fetchingRef.current = false;
          });
        } else {
          // Select item - replace trigger+query with result
          const text = getText();
          const insertText = state.plugin.onSelect(item);
          const before = text.slice(0, state.triggerPos);
          const after = text.slice(state.triggerPos + 1 + state.query.length);
          setText(before + insertText + after);
          close();
        }
        return true;

      case 'Backspace':
        if (state.query === '' && state.path.length > 0) {
          e.preventDefault();
          // Navigate back up
          const newPath = state.path.slice(0, -1);
          const parent = newPath[newPath.length - 1];
          if (parent && state.plugin.onNavigate) {
            state.plugin.onNavigate(parent).then(items => {
              setState(s => ({
                ...s,
                items: items as T[],
                selectedIndex: 0,
                path: newPath,
              }));
            });
          } else {
            state.plugin.fetchItems('').then(items => {
              setState(s => ({
                ...s,
                items: items as T[],
                selectedIndex: 0,
                path: [],
              }));
            });
          }
          return true;
        }
        return false;

      case 'Escape':
        e.preventDefault();
        close();
        return true;

      default:
        return false;
    }
  }, [state, close]);

  const selectItem = useCallback((index: number, getText: () => string, setText: (v: string) => void) => {
    if (!state.plugin) return;
    const item = state.items[index];
    if (!item) return;

    if (state.plugin.isNavigable?.(item)) {
      state.plugin.onNavigate?.(item).then(children => {
        setState(s => ({
          ...s,
          items: children as T[],
          selectedIndex: 0,
          path: [...s.path, item],
          query: '',
        }));
      });
    } else {
      const text = getText();
      const insertText = state.plugin.onSelect(item);
      const before = text.slice(0, state.triggerPos);
      const after = text.slice(state.triggerPos + 1 + state.query.length);
      setText(before + insertText + after);
      close();
    }
  }, [state, close]);

  return {
    state,
    handleChange,
    handleKeyDown,
    selectItem,
    close,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/__tests__/useMention.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/hooks/useMention.ts packages/web/src/__tests__/useMention.test.ts
git commit -m "feat(mention): add useMention hook with keyboard navigation"
```

---

## Task 5: MentionPopup Component

**Files:**
- Create: `packages/web/src/components/MentionPopup.tsx`
- Test: `packages/web/src/__tests__/MentionPopup.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/src/__tests__/MentionPopup.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('MentionPopup component', () => {
  it('should export MentionPopup function', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/MentionPopup.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/export function MentionPopup/);
  });

  it('should render items with plugin.renderItem', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/MentionPopup.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/plugin\.renderItem/);
  });

  it('should have mention-popup class', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/MentionPopup.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/mention-popup/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/__tests__/MentionPopup.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/web/src/components/MentionPopup.tsx
import { useEffect, useRef } from 'react';
import type { MentionPlugin, MentionState } from '../mention/types';

interface Props<T> {
  state: MentionState<T>;
  position: { x: number; y: number };
  onSelect: (index: number) => void;
}

export function MentionPopup<T>({ state, position, onSelect }: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[state.selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [state.selectedIndex]);

  if (!state.open || !state.plugin) return null;

  const plugin = state.plugin as MentionPlugin<T>;

  return (
    <div
      className="mention-popup"
      style={{
        left: position.x,
        top: position.y + 20,
      }}
      ref={listRef}
    >
      {state.path.length > 0 && (
        <div className="mention-path">
          {state.path.map((p, i) => (
            <span key={i}>/{(p as { name?: string }).name ?? '?'}</span>
          ))}
        </div>
      )}
      {state.items.length === 0 ? (
        <div className="mention-empty">No matches</div>
      ) : (
        state.items.map((item, i) => (
          <div
            key={i}
            className={`mention-item ${i === state.selectedIndex ? 'selected' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(i);
            }}
            onMouseEnter={() => {
              // Update selection on hover for mouse users
            }}
          >
            {plugin.renderItem(item, i === state.selectedIndex)}
          </div>
        ))
      )}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/__tests__/MentionPopup.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/components/MentionPopup.tsx packages/web/src/__tests__/MentionPopup.test.ts
git commit -m "feat(mention): add MentionPopup component"
```

---

## Task 6: SlashCommandPlugin

**Files:**
- Create: `packages/web/src/mention/SlashCommandPlugin.tsx`
- Test: `packages/web/src/__tests__/SlashCommandPlugin.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/src/__tests__/SlashCommandPlugin.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('SlashCommandPlugin', () => {
  it('should export SlashCommandPlugin with trigger "/"', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/SlashCommandPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/export const SlashCommandPlugin/);
    expect(src).toMatch(/trigger:\s*['"]\/['"]/);
  });

  it('should have fetchItems that calls /api/commands', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/SlashCommandPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/\/api\/commands/);
  });

  it('onSelect should return "/{name} "', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/SlashCommandPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/onSelect.*`\/\$\{/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/__tests__/SlashCommandPlugin.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/web/src/mention/SlashCommandPlugin.tsx
import type { MentionPlugin, Command } from './types';
import { useStore } from '../store';

export const SlashCommandPlugin: MentionPlugin<Command> = {
  trigger: '/',

  fetchItems: async (query: string) => {
    const { commands, commandsLoaded, setCommands, authToken } = useStore.getState();

    let cmds = commands;
    if (!commandsLoaded) {
      try {
        const headers: Record<string, string> = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch('/api/commands', { headers });
        if (res.ok) {
          const data = await res.json();
          cmds = data.commands;
          setCommands(cmds);
        }
      } catch {
        // Use empty list on error
      }
    }

    const q = query.toLowerCase();
    return cmds.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q)
    );
  },

  renderItem: (cmd: Command, selected: boolean) => (
    <div className={`mention-cmd ${selected ? 'selected' : ''}`}>
      <span className="mention-cmd-name">/{cmd.name}</span>
      <span className="mention-cmd-label">{cmd.label}</span>
    </div>
  ),

  onSelect: (cmd: Command) => `/${cmd.name} `,
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/__tests__/SlashCommandPlugin.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/mention/SlashCommandPlugin.tsx packages/web/src/__tests__/SlashCommandPlugin.test.ts
git commit -m "feat(mention): add SlashCommandPlugin for / commands"
```

---

## Task 7: FileTreePlugin

**Files:**
- Create: `packages/web/src/mention/FileTreePlugin.tsx`
- Test: `packages/web/src/__tests__/FileTreePlugin.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/src/__tests__/FileTreePlugin.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('FileTreePlugin', () => {
  it('should export FileTreePlugin with trigger "@"', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/FileTreePlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/export const FileTreePlugin/);
    expect(src).toMatch(/trigger:\s*['"]@['"]/);
  });

  it('should have isNavigable and onNavigate for tree mode', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/FileTreePlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/isNavigable:/);
    expect(src).toMatch(/onNavigate:/);
  });

  it('onSelect should return "@{path} "', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/FileTreePlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/onSelect.*`@\$\{/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/__tests__/FileTreePlugin.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/web/src/mention/FileTreePlugin.tsx
import type { MentionPlugin, FileEntry } from './types';
import { useStore } from '../store';

async function fetchFiles(sessionId: string, authToken: string | null, subPath: string): Promise<FileEntry[]> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(subPath)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.files ?? []).map((f: { name: string; path: string; isDir: boolean }) => ({
    name: f.name,
    path: f.path,
    isDir: f.isDir,
  }));
}

export const FileTreePlugin: MentionPlugin<FileEntry> = {
  trigger: '@',

  fetchItems: async (query: string) => {
    const { sessionId, authToken } = useStore.getState();
    if (!sessionId) return [];
    const files = await fetchFiles(sessionId, authToken, '/');
    const q = query.toLowerCase();
    return files.filter(f => f.name.toLowerCase().includes(q));
  },

  renderItem: (entry: FileEntry, selected: boolean) => (
    <div className={`mention-file ${selected ? 'selected' : ''}`}>
      <span className="mention-file-icon">{entry.isDir ? '📁' : '📄'}</span>
      <span className="mention-file-name">{entry.name}</span>
    </div>
  ),

  onSelect: (entry: FileEntry) => `@${entry.path} `,

  isNavigable: (entry: FileEntry) => entry.isDir,

  onNavigate: async (dir: FileEntry) => {
    const { sessionId, authToken } = useStore.getState();
    if (!sessionId) return [];
    return fetchFiles(sessionId, authToken, dir.path);
  },
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/__tests__/FileTreePlugin.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/mention/FileTreePlugin.tsx packages/web/src/__tests__/FileTreePlugin.test.ts
git commit -m "feat(mention): add FileTreePlugin for @ file references"
```

---

## Task 8: CellRefPlugin

**Files:**
- Create: `packages/web/src/mention/CellRefPlugin.tsx`
- Test: `packages/web/src/__tests__/CellRefPlugin.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/src/__tests__/CellRefPlugin.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('CellRefPlugin', () => {
  it('should export CellRefPlugin with trigger "#"', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/CellRefPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/export const CellRefPlugin/);
    expect(src).toMatch(/trigger:\s*['"]#['"]/);
  });

  it('should read cells from store', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/CellRefPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/useStore\.getState\(\)\.notebook/);
  });

  it('onSelect should return "#{index} "', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/CellRefPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/onSelect.*`#\$\{/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/__tests__/CellRefPlugin.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/web/src/mention/CellRefPlugin.tsx
import type { MentionPlugin, CellRef } from './types';
import { useStore } from '../store';

export const CellRefPlugin: MentionPlugin<CellRef> = {
  trigger: '#',

  fetchItems: async (query: string) => {
    const { notebook } = useStore.getState();
    if (!notebook) return [];

    const cells: CellRef[] = notebook.cells.map((c, i) => ({
      index: i,
      id: c.id,
      preview: (c.source ?? '').slice(0, 50).replace(/\n/g, ' '),
    }));

    const q = query.toLowerCase();
    return cells.filter(c =>
      `${c.index}`.includes(q) ||
      c.preview.toLowerCase().includes(q)
    );
  },

  renderItem: (cell: CellRef, selected: boolean) => (
    <div className={`mention-cell ${selected ? 'selected' : ''}`}>
      <span className="mention-cell-idx">#{cell.index}</span>
      <span className="mention-cell-preview">{cell.preview || '(empty)'}...</span>
    </div>
  ),

  onSelect: (cell: CellRef) => `#${cell.index} `,
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/__tests__/CellRefPlugin.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/mention/CellRefPlugin.tsx packages/web/src/__tests__/CellRefPlugin.test.ts
git commit -m "feat(mention): add CellRefPlugin for # cell references"
```

---

## Task 9: Integrate into NotebookInputBar

**Files:**
- Modify: `packages/web/src/components/Notebook.tsx`
- Test: `packages/web/src/__tests__/notebookMention.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/src/__tests__/notebookMention.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Notebook mention integration', () => {
  it('NotebookInputBar should use useMention hook', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/Notebook.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/useMention/);
  });

  it('should render MentionPopup', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/Notebook.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/<MentionPopup/);
  });

  it('should include all three plugins', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/Notebook.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/SlashCommandPlugin/);
    expect(src).toMatch(/FileTreePlugin/);
    expect(src).toMatch(/CellRefPlugin/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/__tests__/notebookMention.test.ts`
Expected: FAIL

**Step 3: Modify NotebookInputBar**

Add imports at top of file:
```typescript
import { useMention } from '../hooks/useMention';
import { MentionPopup } from './MentionPopup';
import { SlashCommandPlugin } from '../mention/SlashCommandPlugin';
import { FileTreePlugin } from '../mention/FileTreePlugin';
import { CellRefPlugin } from '../mention/CellRefPlugin';
```

Inside `NotebookInputBar` function, add:
```typescript
const plugins = useMemo(() => [SlashCommandPlugin, FileTreePlugin, CellRefPlugin], []);
const mention = useMention(plugins);
const [caretPos, setCaretPos] = useState({ x: 0, y: 0 });
```

Modify textarea onChange:
```typescript
onChange={(e) => {
  setText(e.target.value);
  resize();
  const pos = e.target.selectionStart ?? 0;
  mention.handleChange(e.target.value, pos);
  // Update caret position for popup
  const rect = e.target.getBoundingClientRect();
  setCaretPos({ x: rect.left + 10, y: rect.top });
}}
```

Modify textarea onKeyDown:
```typescript
onKeyDown={(e) => {
  if (mention.handleKeyDown(e, () => text, setText)) return;
  // ... existing handleKeyDown logic
}}
```

Add MentionPopup after textarea:
```typescript
<MentionPopup
  state={mention.state}
  position={caretPos}
  onSelect={(i) => mention.selectItem(i, () => text, setText)}
/>
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/__tests__/notebookMention.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/components/Notebook.tsx packages/web/src/__tests__/notebookMention.test.ts
git commit -m "feat(mention): integrate mention system into NotebookInputBar"
```

---

## Task 10: Add CSS Styles

**Files:**
- Modify: `packages/web/src/styles.css`
- Test: `packages/web/src/__tests__/mentionStyles.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/web/src/__tests__/mentionStyles.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Mention CSS styles', () => {
  it('should have .mention-popup styles', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../styles.css'),
      'utf-8',
    );
    expect(src).toMatch(/\.mention-popup\s*\{/);
  });

  it('should have .mention-item styles', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../styles.css'),
      'utf-8',
    );
    expect(src).toMatch(/\.mention-item\s*\{/);
    expect(src).toMatch(/\.mention-item\.selected/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/__tests__/mentionStyles.test.ts`
Expected: FAIL

**Step 3: Add styles to styles.css**

```css
/* ── Mention Popup ──────────────────────────────────────────────────────────── */

.mention-popup {
  position: fixed;
  min-width: 200px;
  max-width: 400px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-cell);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
}

.mention-path {
  padding: 4px 12px;
  font-size: 11px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-default);
}

.mention-empty {
  padding: 12px;
  color: var(--text-secondary);
  font-style: italic;
}

.mention-item {
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.mention-item:hover,
.mention-item.selected {
  background: var(--color-primary-light);
}

.mention-cmd-name {
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--color-primary);
}

.mention-cmd-label {
  color: var(--text-secondary);
  font-size: 12px;
}

.mention-file-icon {
  flex-shrink: 0;
}

.mention-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mention-cell-idx {
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--color-primary);
  flex-shrink: 0;
}

.mention-cell-preview {
  color: var(--text-secondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/__tests__/mentionStyles.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/styles.css packages/web/src/__tests__/mentionStyles.test.ts
git commit -m "feat(mention): add mention popup CSS styles"
```

---

## Task 11: Full Regression Test Suite

**Files:**
- Test: `packages/web/src/__tests__/notebookInputRegression.test.ts`

**Step 1: Write regression tests**

```typescript
// packages/web/src/__tests__/notebookInputRegression.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('NotebookInputBar regression tests', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../components/Notebook.tsx'),
    'utf-8',
  );

  it('should still have paste handler', () => {
    expect(src).toMatch(/onPaste=\{handlePaste\}/);
  });

  it('should still have drop handler with MAX_DROP limit', () => {
    expect(src).toMatch(/onDrop=/);
    expect(src).toMatch(/MAX_DROP/);
  });

  it('should still have submit/run functionality', () => {
    expect(src).toMatch(/handleRun/);
    expect(src).toMatch(/submitPrompt/);
  });

  it('should still have file upload button', () => {
    expect(src).toMatch(/nb-attach-btn/);
    expect(src).toMatch(/fileInputRef/);
  });

  it('should still have disabled state handling', () => {
    expect(src).toMatch(/disabled=\{disabled\}/);
  });

  it('should still have placeholder text', () => {
    expect(src).toMatch(/placeholder=/);
  });
});
```

**Step 2: Run regression tests**

Run: `npx vitest run packages/web/src/__tests__/notebookInputRegression.test.ts`
Expected: PASS (all existing functionality preserved)

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass, zero regressions

**Step 4: Commit**

```bash
git add packages/web/src/__tests__/notebookInputRegression.test.ts
git commit -m "test(mention): add regression tests for NotebookInputBar"
```

---

## Task 12: Final Integration Test

**Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass (1100+ tests)

**Step 2: Manual smoke test**

1. Start the app: `./restart.sh`
2. Open a notebook
3. Type `/` → verify command popup appears
4. Type `@` → verify file popup appears
5. Type `#` → verify cell popup appears
6. Use ↑↓ Tab Esc → verify keyboard navigation

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(mention): complete mention system implementation

- Add useMention hook with keyboard navigation
- Add MentionPopup component
- Add SlashCommandPlugin for / commands
- Add FileTreePlugin for @ file references
- Add CellRefPlugin for # cell references
- Add /api/commands backend route
- Full TDD coverage with regression tests"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Type definitions | mentionTypes.test.ts |
| 2 | Backend /api/commands | commandsRoute.test.ts |
| 3 | Commands state in store | commandsState.test.ts |
| 4 | useMention hook | useMention.test.ts |
| 5 | MentionPopup component | MentionPopup.test.ts |
| 6 | SlashCommandPlugin | SlashCommandPlugin.test.ts |
| 7 | FileTreePlugin | FileTreePlugin.test.ts |
| 8 | CellRefPlugin | CellRefPlugin.test.ts |
| 9 | NotebookInputBar integration | notebookMention.test.ts |
| 10 | CSS styles | mentionStyles.test.ts |
| 11 | Regression tests | notebookInputRegression.test.ts |
| 12 | Final integration | Full suite run |
