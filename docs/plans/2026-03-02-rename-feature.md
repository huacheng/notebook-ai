# Rename Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add rename functionality for Projects and Notebooks across Desktop and Mobile interfaces using Modal dialogs.

**Architecture:** Create `renameFlow.ts` (pure logic, testable) + `RenameModal` component (UI). Integrate into existing menus via new "Rename" buttons.

**Tech Stack:** React, TypeScript, Vitest, existing i18n system

---

## Task 1: Create renameFlow.ts (Pure Logic)

**Files:**
- Create: `packages/web/src/components/renameFlow.ts`
- Test: `packages/web/src/__tests__/renameFlow.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/web/src/__tests__/renameFlow.test.ts
/**
 * runRenameFlow — Red/Green regression tests
 *
 * Mirrors deleteFlow.test.ts structure for consistency.
 * Key invariant: onDone fires ONLY on success, never on error or cancel.
 */

import { describe, it, expect, vi } from 'vitest';
import { runRenameFlow, type RenamePhase } from '../components/renameFlow';

function createSpies() {
  const phases: RenamePhase[] = [];
  return {
    phases,
    setPhase: (p: RenamePhase) => phases.push(p),
    setErrorMsg: vi.fn(),
    onDone: vi.fn(),
  };
}

describe('runRenameFlow', () => {
  it('calls onDone exactly once after successful rename', async () => {
    const spies = createSpies();

    await runRenameFlow(async () => {}, {
      setPhase: spies.setPhase,
      setErrorMsg: spies.setErrorMsg,
      onDone: spies.onDone,
    });

    expect(spies.onDone).toHaveBeenCalledTimes(1);
  });

  it('transitions through saving → done on success', async () => {
    const spies = createSpies();

    await runRenameFlow(async () => {}, {
      setPhase: spies.setPhase,
      setErrorMsg: spies.setErrorMsg,
      onDone: spies.onDone,
    });

    expect(spies.phases).toEqual(['saving', 'done']);
  });

  it('does NOT call onDone when onConfirm throws', async () => {
    const spies = createSpies();

    await runRenameFlow(
      async () => { throw new Error('server error'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.onDone).not.toHaveBeenCalled();
  });

  it('transitions through saving → error on failure', async () => {
    const spies = createSpies();

    await runRenameFlow(
      async () => { throw new Error('server error'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.phases).toEqual(['saving', 'error']);
  });

  it('sets error message from thrown error', async () => {
    const spies = createSpies();

    await runRenameFlow(
      async () => { throw new Error('duplicate name'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.setErrorMsg).toHaveBeenCalledWith('duplicate name');
  });

  it('sets fallback error message when error has no message', async () => {
    const spies = createSpies();

    await runRenameFlow(
      async () => { throw {}; },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.setErrorMsg).toHaveBeenCalledWith('Rename failed');
  });

  it('works when onDone is undefined (backward compat)', async () => {
    const spies = createSpies();

    await expect(
      runRenameFlow(async () => {}, {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
      }),
    ).resolves.toBeUndefined();

    expect(spies.phases).toEqual(['saving', 'done']);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/web/src/__tests__/renameFlow.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/web/src/components/renameFlow.ts
/**
 * Pure logic extracted for RenameModal's handleConfirm.
 * Mirrors deleteFlow.ts structure for consistency.
 */

export type RenamePhase = 'editing' | 'saving' | 'done' | 'error';

export interface RenameFlowCallbacks {
  setPhase: (phase: RenamePhase) => void;
  setErrorMsg: (msg: string) => void;
  /** Called ONLY after successful rename. NOT on cancel or error. */
  onDone?: () => void;
}

/**
 * Executes the rename flow:
 *   saving → (await onConfirm) → done + onDone()
 *   saving → (onConfirm throws) → error
 */
export async function runRenameFlow(
  onConfirm: () => Promise<void>,
  cb: RenameFlowCallbacks,
): Promise<void> {
  cb.setPhase('saving');
  try {
    await onConfirm();
    cb.setPhase('done');
    cb.onDone?.();
  } catch (err: any) {
    cb.setErrorMsg(err?.message || 'Rename failed');
    cb.setPhase('error');
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/web/src/__tests__/renameFlow.test.ts`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add packages/web/src/components/renameFlow.ts packages/web/src/__tests__/renameFlow.test.ts
git commit -m "feat(web): add renameFlow pure logic with tests"
```

---

## Task 2: Add i18n Keys

**Files:**
- Modify: `packages/web/src/i18n/locales.ts`

**Step 1: Add English translations**

Add after line 213 (`sidebar.deleteFailed`):

```typescript
    'sidebar.rename': 'Rename',
    'sidebar.renameLabel': 'Rename {0}',
    'sidebar.renaming': 'Renaming {0}...',
    'sidebar.renamed': '{0} renamed',
    'sidebar.renameFailed': 'Rename Failed',
    'sidebar.newName': 'New name',
```

**Step 2: Add Chinese translations**

Add after line 473 (`sidebar.deleteFailed`):

```typescript
    'sidebar.rename': '重命名',
    'sidebar.renameLabel': '重命名 {0}',
    'sidebar.renaming': '正在重命名 {0}...',
    'sidebar.renamed': '{0} 已重命名',
    'sidebar.renameFailed': '重命名失败',
    'sidebar.newName': '新名称',
```

**Step 3: Verify no syntax errors**

Run: `npx vitest run packages/web/src/__tests__/i18n.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/web/src/i18n/locales.ts
git commit -m "feat(i18n): add rename-related translations"
```

---

## Task 3: Create RenameModal Component

**Files:**
- Modify: `packages/web/src/components/ProjectSidebar.tsx` (add RenameModal after ConfirmDeleteModal)

**Step 1: Add RenameModal component**

Insert after `ConfirmDeleteModal` function (around line 298):

```tsx
function RenameModal({ currentName, label = 'Item', onCancel, onConfirm, onDone }: {
  currentName: string;
  label?: string;
  onCancel: () => void;
  onConfirm: (newName: string) => Promise<void>;
  onDone?: () => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<RenamePhase>('editing');
  const [errorMsg, setErrorMsg] = useState('');
  const [newName, setNewName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    // Auto-select input text on mount
    inputRef.current?.select();
  }, []);

  const nameError = useMemo(() => validateTitle(newName), [newName]);
  const canSave = newName.trim().length > 0 && newName.trim() !== currentName && !nameError;

  const handleConfirm = () => {
    if (!canSave || phase === 'saving') return;
    runRenameFlow(
      () => onConfirm(newName.trim()),
      {
        setPhase,
        setErrorMsg,
        onDone: () => setTimeout(() => onDoneRef.current?.(), 800),
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSave) handleConfirm();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="annotation-modal-overlay" onClick={phase === 'editing' || phase === 'error' ? onCancel : undefined}>
      <div className="annotation-modal" onClick={e => e.stopPropagation()}>
        {phase === 'editing' && (
          <>
            <div className="annotation-modal-title">{t('sidebar.renameLabel', label)}</div>
            <div style={{ margin: '0 0 var(--space-lg)' }}>
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('sidebar.newName')}
                maxLength={MAX_TITLE_LENGTH}
                className={nameError ? 'input-error' : ''}
                style={{ width: '100%', padding: 'var(--space-sm) var(--space-md)', fontSize: 'var(--font-size-sm)' }}
              />
              {nameError && <div className="create-form-error">{nameError}</div>}
            </div>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onCancel}>{t('sidebar.cancel')}</button>
              <button className="annotation-modal-btn" onClick={handleConfirm} disabled={!canSave}>{t('sidebar.rename')}</button>
            </div>
          </>
        )}
        {phase === 'saving' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div className="nb-delete-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
              {t('sidebar.renaming', currentName)}
            </p>
          </div>
        )}
        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {t('sidebar.renamed', label)}
            </p>
          </div>
        )}
        {phase === 'error' && (
          <>
            <div className="annotation-modal-title" style={{ color: 'var(--color-error)' }}>{t('sidebar.renameFailed')}</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-lg)' }}>
              {errorMsg}
            </p>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onCancel}>{t('sidebar.close')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Add imports at top of file**

```typescript
import { runRenameFlow, type RenamePhase } from './renameFlow';
```

**Step 3: Verify build**

Run: `npx vitest run`
Expected: All tests pass (no regressions)

**Step 4: Commit**

```bash
git add packages/web/src/components/ProjectSidebar.tsx
git commit -m "feat(web): add RenameModal component"
```

---

## Task 4: Add Rename to ProjectItemMenu (Desktop)

**Files:**
- Modify: `packages/web/src/components/ProjectSidebar.tsx`

**Step 1: Update ProjectItemMenu props**

Change function signature (around line 54):

```tsx
function ProjectItemMenu({ projectId, projectSlug, projectTitle, authToken, onClose, onRequestDelete, onRequestRename }: {
  projectId: string; projectSlug: string; projectTitle: string; authToken: string | null;
  onClose: () => void; onRequestDelete: () => void; onRequestRename: () => void;
}) {
```

**Step 2: Add Rename button in menu**

Insert before the Export button (around line 86):

```tsx
      <button className="project-item-menu-item" onClick={() => { onClose(); onRequestRename(); }}>{t('sidebar.rename')}</button>
```

**Step 3: Update ProjectList to handle rename**

In `ProjectList` component, add state (around line 100):

```tsx
const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
```

**Step 4: Pass onRequestRename to ProjectItemMenu**

Update the menu render (around line 159):

```tsx
<ProjectItemMenu
  projectId={p.id}
  projectSlug={p.slug}
  projectTitle={p.title}
  authToken={authToken}
  onClose={() => setMenuOpenId(null)}
  onRequestDelete={() => setDeleteTarget({ id: p.id, title: p.title })}
  onRequestRename={() => setRenameTarget({ id: p.id, title: p.title })}
/>
```

**Step 5: Add RenameModal render**

After the delete modal render (around line 187), add:

```tsx
{renameTarget && (
  <RenameModal
    currentName={renameTarget.title}
    label={t('sidebar.projects')}
    onCancel={() => setRenameTarget(null)}
    onConfirm={async (newName) => {
      const res = await fetch(`/api/projects/${renameTarget.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ title: newName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to rename');
      }
    }}
    onDone={() => {
      setRenameTarget(null);
      useStore.getState().fetchProjects();
    }}
  />
)}
```

**Step 6: Verify UI works**

Run: `./restart.sh`
Manual test: Open project menu → click Rename → enter new name → verify list updates

**Step 7: Commit**

```bash
git add packages/web/src/components/ProjectSidebar.tsx
git commit -m "feat(web): add rename to ProjectItemMenu"
```

---

## Task 5: Add Rename to NotebookItemMenu (Desktop)

**Files:**
- Modify: `packages/web/src/components/ProjectSidebar.tsx`

**Step 1: Update NotebookItemMenu props**

Change function signature (around line 300):

```tsx
function NotebookItemMenu({ projectId, relPath, notebookName, baseUrl, authToken, showExport, onClose, onDeleted, onRequestRename }: {
  projectId: string; relPath: string; notebookName: string; baseUrl: string; authToken: string | null; showExport?: boolean;
  onClose: () => void; onDeleted?: () => void; onRequestRename?: () => void;
}) {
```

**Step 2: Add Rename button**

Insert before Export button (inside the menu div):

```tsx
{onRequestRename && <button className="project-item-menu-item" onClick={() => { onClose(); onRequestRename(); }}>{t('sidebar.rename')}</button>}
```

**Step 3: Update FileBrowser to handle notebook rename**

Add state in FileBrowser (around line 370):

```tsx
const [nbRenameTarget, setNbRenameTarget] = useState<{ path: string; name: string } | null>(null);
```

**Step 4: Pass onRequestRename to NotebookItemMenu**

Find where NotebookItemMenu is rendered and add:

```tsx
onRequestRename={() => setNbRenameTarget({ path: relPath, name: displayName })}
```

**Step 5: Add RenameModal for notebooks**

After NotebookItemMenu usage, add:

```tsx
{nbRenameTarget && (
  <RenameModal
    currentName={nbRenameTarget.name}
    label="Notebook"
    onCancel={() => setNbRenameTarget(null)}
    onConfirm={async (newName) => {
      const res = await fetch(`/api/projects/${activeProjectId}/notebooks/rename`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          notebookPath: `${activeProjectPath}/${nbRenameTarget.path}`,
          title: newName,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to rename');
      }
    }}
    onDone={() => {
      setNbRenameTarget(null);
      setFileRefreshKey(k => k + 1);
    }}
  />
)}
```

**Step 6: Manual test**

Run: `./restart.sh`
Test: Open notebook menu → Rename → enter new name → verify file renamed

**Step 7: Commit**

```bash
git add packages/web/src/components/ProjectSidebar.tsx
git commit -m "feat(web): add rename to NotebookItemMenu"
```

---

## Task 6: Update MobileProjectsList (Replace prompt with Modal)

**Files:**
- Modify: `packages/web/src/components/mobile/MobileProjectsList.tsx`

**Step 1: Add imports**

```tsx
import { useState, useMemo } from 'react';
import { runRenameFlow, type RenamePhase } from '../renameFlow';
import { validateTitle, MAX_TITLE_LENGTH } from '../../utils/validateTitle';
```

**Step 2: Add state for rename modal**

```tsx
const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
```

**Step 3: Replace handleRenameProject**

Replace the existing prompt-based handler:

```tsx
const handleRenameProject = (e: React.MouseEvent, project: typeof projects[0]) => {
  e.stopPropagation();
  setRenameTarget({ id: project.id, title: project.title });
};
```

**Step 4: Create MobileRenameModal component**

Add before the export:

```tsx
function MobileRenameModal({ currentName, onCancel, onConfirm, onDone }: {
  currentName: string;
  onCancel: () => void;
  onConfirm: (newName: string) => Promise<void>;
  onDone?: () => void;
}) {
  const [phase, setPhase] = useState<RenamePhase>('editing');
  const [errorMsg, setErrorMsg] = useState('');
  const [newName, setNewName] = useState(currentName);

  const nameError = useMemo(() => validateTitle(newName), [newName]);
  const canSave = newName.trim().length > 0 && newName.trim() !== currentName && !nameError;

  const handleConfirm = () => {
    if (!canSave || phase === 'saving') return;
    runRenameFlow(
      () => onConfirm(newName.trim()),
      { setPhase, setErrorMsg, onDone: () => setTimeout(() => onDone?.(), 600) },
    );
  };

  return (
    <div className="mobile-modal-overlay" onClick={phase === 'editing' ? onCancel : undefined}>
      <div className="mobile-modal" onClick={e => e.stopPropagation()}>
        {phase === 'editing' && (
          <>
            <h3 className="mobile-modal-title">Rename Project</h3>
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canSave) handleConfirm(); if (e.key === 'Escape') onCancel(); }}
              placeholder="New name"
              maxLength={MAX_TITLE_LENGTH}
              className="mobile-input"
            />
            {nameError && <p className="mobile-error">{nameError}</p>}
            <div className="mobile-modal-actions">
              <button className="mobile-btn" onClick={onCancel}>Cancel</button>
              <button className="mobile-btn-primary" onClick={handleConfirm} disabled={!canSave}>Rename</button>
            </div>
          </>
        )}
        {phase === 'saving' && <div className="mobile-loading">Renaming...</div>}
        {phase === 'done' && <div className="mobile-success">Renamed!</div>}
        {phase === 'error' && (
          <>
            <p className="mobile-error">{errorMsg}</p>
            <button className="mobile-btn" onClick={onCancel}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 5: Render modal in component**

Add before closing `</div>` of mobile-view:

```tsx
{renameTarget && (
  <MobileRenameModal
    currentName={renameTarget.title}
    onCancel={() => setRenameTarget(null)}
    onConfirm={async (newName) => {
      const res = await fetch(`/api/projects/${renameTarget.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ title: newName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to rename');
      }
    }}
    onDone={() => {
      setRenameTarget(null);
      fetchProjects();
    }}
  />
)}
```

**Step 6: Commit**

```bash
git add packages/web/src/components/mobile/MobileProjectsList.tsx
git commit -m "feat(mobile): replace prompt with RenameModal for projects"
```

---

## Task 7: Add Rename to MobileNotebooksList

**Files:**
- Modify: `packages/web/src/components/mobile/MobileNotebooksList.tsx`

**Step 1: Read current file structure**

First understand existing code patterns.

**Step 2: Add rename state and button**

Similar pattern to MobileProjectsList — add edit button + modal.

**Step 3: Commit**

```bash
git add packages/web/src/components/mobile/MobileNotebooksList.tsx
git commit -m "feat(mobile): add rename to MobileNotebooksList"
```

---

## Task 8: Run Full Test Suite (Regression)

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass, including new renameFlow tests

**Step 2: Manual E2E verification**

- [ ] Desktop: Rename project via menu
- [ ] Desktop: Rename notebook via menu
- [ ] Mobile: Rename project via edit button
- [ ] Mobile: Rename notebook via edit button
- [ ] Validation: empty name rejected
- [ ] Validation: duplicate name shows server error
- [ ] Cancel: Escape key works
- [ ] Cancel: Click outside works

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address regression issues from rename feature"
```

---

## Summary

| Task | Description | Test Coverage |
|------|-------------|---------------|
| 1 | renameFlow.ts pure logic | 7 unit tests |
| 2 | i18n translations | existing i18n tests |
| 3 | RenameModal component | via renameFlow tests |
| 4 | Desktop Project rename | manual |
| 5 | Desktop Notebook rename | manual |
| 6 | Mobile Project rename | manual |
| 7 | Mobile Notebook rename | manual |
| 8 | Regression suite | full vitest run |
