# Rename Feature Design

**Date**: 2026-03-02
**Status**: Approved

## Overview

Add rename functionality for Projects and Notebooks across Desktop and Mobile interfaces.

## Current State

**Backend API (already implemented)**:
- `PATCH /api/projects/:projectId` — Project rename (updates DB title only)
- `PATCH /api/notebooks/:notebookId` — Notebook rename by ID
- `PATCH /api/projects/:projectId/notebooks/rename` — Notebook rename by path (renames file + DB)

**Frontend UI (missing)**:
| Location | Project Rename | Notebook Rename |
|----------|----------------|-----------------|
| Desktop  | Missing        | Missing         |
| Mobile   | prompt() only  | Missing         |

## Design Decision

**Approach**: Create a reusable `RenameModal` component that mirrors `ConfirmDeleteModal` structure and styling.

**Interaction**: Modal dialog (consistent with delete confirmation flow)

## Component Design

### RenameModal

```tsx
interface RenameModalProps {
  currentName: string;
  label: string;  // "Project" or "Notebook"
  onCancel: () => void;
  onConfirm: (newName: string) => Promise<void>;
  onDone?: () => void;
}
```

**State flow**: `editing` → `saving` → `done` / `error`

**Features**:
- Input pre-filled with current name, auto-selected for easy replacement
- Validation via existing `validateTitle()` (length, illegal characters)
- Enter to save, Escape to cancel
- Loading spinner during save
- Success checkmark on completion
- Error display with retry option

### Integration Points

| Component | File | Changes |
|-----------|------|---------|
| ProjectItemMenu | `ProjectSidebar.tsx` | Add "Rename" button, wire to RenameModal |
| NotebookItemMenu | `ProjectSidebar.tsx` | Add "Rename" button, wire to RenameModal |
| MobileProjectsList | `MobileProjectsList.tsx` | Replace prompt() with RenameModal |
| MobileNotebooksList | `MobileNotebooksList.tsx` | Add rename button + RenameModal |

### API Calls

**Project rename**:
```ts
fetch(`/api/projects/${projectId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title: newName }),
});
```

**Notebook rename** (within project):
```ts
fetch(`/api/projects/${projectId}/notebooks/rename`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ notebookPath, title: newName }),
});
```

### Post-Rename Refresh

- Desktop: Call `fetchProjects()` for project list, increment `fileRefreshKey` for notebook list
- Mobile: Call `fetchProjects()` or `fetchNotebooks()` as appropriate

## UI Styling

Reuse existing modal styles:
- `.annotation-modal-overlay`
- `.annotation-modal`
- `.annotation-modal-title`
- `.annotation-modal-btn`

Input styling:
- Match project/notebook create form input style
- Error state: `.input-error` class + error message below

## i18n Keys

Add to translation files:
- `sidebar.rename`: "Rename"
- `sidebar.renameLabel`: "Rename {0}"
- `sidebar.renaming`: "Renaming..."
- `sidebar.renamed`: "{0} renamed"
- `sidebar.renameFailed`: "Rename failed"

## Test Plan

1. Desktop Project rename: open menu → click Rename → enter new name → verify list updates
2. Desktop Notebook rename: open menu → click Rename → verify file renamed on disk
3. Mobile Project rename: tap edit button → enter new name → verify update
4. Mobile Notebook rename: tap edit button → enter new name → verify update
5. Validation: empty name, too long name, special characters
6. Error handling: network failure, duplicate name conflict
7. Cancel flow: Escape key, click outside, Cancel button
