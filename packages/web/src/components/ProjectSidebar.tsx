import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { FileSection } from './FileSection';
import { runDeleteFlow } from './deleteFlow';
import { runRenameFlow, type RenamePhase } from './renameFlow';
import { runCreateFlow, type CreatePhase } from './createFlow';
import { validateTitle, MAX_TITLE_LENGTH } from '../utils/validateTitle';
import { useWatcher } from '../hooks/useWatcher';

function CreateOverlay({ phase, label, errorMsg, onDismiss }: {
  phase: 'creating' | 'done' | 'error';
  label: string;
  errorMsg: string;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="annotation-modal-overlay" onClick={phase === 'error' ? onDismiss : undefined}>
      <div className="annotation-modal" onClick={e => e.stopPropagation()}>
        {phase === 'creating' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div className="nb-delete-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
              {t('sidebar.creating', label)}
            </p>
          </div>
        )}
        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {t('sidebar.created', label)}
            </p>
          </div>
        )}
        {phase === 'error' && (
          <>
            <div className="annotation-modal-title" style={{ color: 'var(--color-error)' }}>{t('sidebar.createFailed')}</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-lg)' }}>
              {errorMsg}
            </p>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onDismiss}>{t('sidebar.close')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}



function ProjectItemMenu({ projectId, projectSlug, authToken, onClose, onRequestDelete, onRequestRename, anchorRect }: {
  projectId: string; projectSlug: string; authToken: string | null;
  onClose: () => void; onRequestDelete: () => void; onRequestRename: () => void;
  anchorRect?: DOMRect;
}) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleExport = async () => {
    const url = `/api/projects/${projectId}/files/zip`;
    const res = await fetch(url, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${projectSlug}.tar.gz`;
    a.click();
    URL.revokeObjectURL(a.href);
    onClose();
  };

  // Use fixed positioning when anchorRect is provided
  const style: React.CSSProperties = anchorRect ? {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    right: window.innerWidth - anchorRect.right,
  } : {};

  return (
    <div className="project-item-menu" ref={menuRef} onClick={e => e.stopPropagation()} style={style}>
      <button className="project-item-menu-item" onClick={() => { onClose(); onRequestRename(); }}>{t('sidebar.rename')}</button>
      <button className="project-item-menu-item" onClick={handleExport}>{t('sidebar.export')}</button>
      <button className="project-item-menu-item project-item-menu-item--danger" onClick={() => { onClose(); onRequestDelete(); }}>{t('sidebar.delete')}</button>
    </div>
  );
}

function ProjectList() {
  const t = useT();
  const { projects, projectsLoading, createProject, setActiveProject, importProject } = useStore();
  const deleteProject = useStore(s => s.deleteProject);
  const authToken = useStore(s => s.authToken);
  const [newTitle, setNewTitle] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [createPhase, setCreatePhase] = useState<CreatePhase>('idle');
  const [createError, setCreateError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const titleError = useMemo(() => validateTitle(newTitle), [newTitle]);
  const canCreate = newTitle.trim().length > 0 && !titleError;

  const handleCreate = () => {
    if (!canCreate) return;
    const title = newTitle.trim();
    runCreateFlow(
      () => createProject(title),
      {
        setPhase: setCreatePhase,
        setErrorMsg: setCreateError,
        onDone: () => {
          setNewTitle('');
          setShowCreate(false);
          setTimeout(() => {
            setCreatePhase('idle');
            useStore.getState().fetchProjects();
          }, 800);
        },
      },
    );
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importProject(file);
    e.target.value = '';
  };

  return (
    <div className="project-list">
      <div className="project-list-header">
        <span>{t('sidebar.projects')}</span>
      </div>
      {projectsLoading && <div className="project-list-loading">{t('sidebar.loading')}</div>}
      <div className="project-list-items">
        {projects.map(p => (
          <div
            key={p.id}
            className="project-list-item"
            onClick={() => setActiveProject(p.id, p.path)}
          >
            <div className="project-list-item-row">
              <span className="project-list-item-title">{p.title}</span>
              <button
                className="project-item-menu-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (menuOpenId === p.id) {
                    setMenuOpenId(null);
                    setMenuAnchorRect(null);
                  } else {
                    setMenuOpenId(p.id);
                    setMenuAnchorRect((e.target as HTMLElement).getBoundingClientRect());
                  }
                }}
                title={t('sidebar.projectActions')}
              >⋯</button>
            </div>
            <span className="project-list-item-meta">
              {t('sidebar.notebooks', String(p.notebook_count))}
            </span>
            {menuOpenId === p.id && (
              <ProjectItemMenu
                projectId={p.id}
                projectSlug={p.slug}
                authToken={authToken}
                anchorRect={menuAnchorRect ?? undefined}
                onClose={() => { setMenuOpenId(null); setMenuAnchorRect(null); }}
                onRequestDelete={() => setDeleteTarget({ id: p.id, title: p.title })}
                onRequestRename={() => setRenameTarget({ id: p.id, title: p.title })}
              />
            )}
          </div>
        ))}
      </div>

      {/* Delete modal rendered OUTSIDE projects.map — survives list refresh */}
      {deleteTarget && (
        <ConfirmDeleteModal
          name={deleteTarget.title}
          label={t('sidebar.projects')}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteProject(deleteTarget.id)}
          onDone={() => {
            setDeleteTarget(null);
            const { activeProjectId, goBackToProjectList, fetchProjects, closeProjectFileTabs, closeProjectNotebookTabs } = useStore.getState();
            closeProjectFileTabs(deleteTarget.id);
            closeProjectNotebookTabs(deleteTarget.id);
            if (activeProjectId === deleteTarget.id) goBackToProjectList();
            fetchProjects();
          }}
        />
      )}

      {/* Rename modal */}
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

      <input
        ref={fileInputRef}
        type="file"
        accept=".tar.gz,.tgz"
        style={{ display: 'none' }}
        onChange={handleImport}
      />
      {showCreate ? (
        <div className="project-create-form-wrap">
          <div className="project-create-form">
            <input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
              placeholder={t('sidebar.projectName')}
              maxLength={MAX_TITLE_LENGTH}
              className={titleError ? 'input-error' : ''}
            />
            <button onClick={handleCreate} disabled={!canCreate}>{t('sidebar.create')}</button>
          </div>
          {titleError && <div className="create-form-error">{titleError}</div>}
        </div>
      ) : (
        <div className="project-actions-bar">
          <button className="project-action-btn" onClick={() => setShowCreate(true)}>{t('sidebar.new')}</button>
          <button className="project-action-btn" onClick={() => fileInputRef.current?.click()}>{t('sidebar.import')}</button>
        </div>
      )}

      {createPhase !== 'idle' && (
        <CreateOverlay
          phase={createPhase as 'creating' | 'done' | 'error'}
          label={t('sidebar.projects')}
          errorMsg={createError}
          onDismiss={() => setCreatePhase('idle')}
        />
      )}
    </div>
  );
}

function ConfirmDeleteModal({ name, label = 'Notebook', onCancel, onConfirm, onDone }: {
  name: string;
  label?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  /** Called after successful delete + success display. Use for state cleanup. */
  onDone?: () => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<'confirm' | 'deleting' | 'done' | 'error'>('confirm');
  const [errorMsg, setErrorMsg] = useState('');
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const handleConfirm = () => {
    runDeleteFlow(onConfirm, {
      setPhase,
      setErrorMsg,
      onDone: () => setTimeout(() => onDoneRef.current?.(), 800),
    });
  };

  return (
    <div className="annotation-modal-overlay" onClick={phase === 'confirm' || phase === 'error' ? onCancel : undefined}>
      <div className="annotation-modal" onClick={e => e.stopPropagation()}>
        {phase === 'confirm' && (
          <>
            <div className="annotation-modal-title">{t('sidebar.deleteLabel', label)}</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-lg)' }}>
              {t('sidebar.deleteConfirm', name)}
            </p>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onCancel}>{t('sidebar.cancel')}</button>
              <button className="annotation-modal-btn annotation-modal-btn--danger" onClick={handleConfirm}>{t('sidebar.delete')}</button>
            </div>
          </>
        )}
        {phase === 'deleting' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div className="nb-delete-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
              {t('sidebar.deleting', name)}
            </p>
          </div>
        )}
        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {t('sidebar.deleted', label)}
            </p>
          </div>
        )}
        {phase === 'error' && (
          <>
            <div className="annotation-modal-title" style={{ color: 'var(--color-error)' }}>{t('sidebar.deleteFailed')}</div>
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
                className={`annotation-modal-input${nameError ? ' input-error' : ''}`}
              />
              {nameError && <div className="create-form-error">{nameError}</div>}
            </div>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onCancel}>{t('sidebar.cancel')}</button>
              <button className="annotation-modal-btn annotation-modal-confirm" onClick={handleConfirm} disabled={!canSave}>{t('sidebar.rename')}</button>
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

function NotebookItemMenu({ projectId, relPath, baseUrl, authToken, showExport, onClose, onDeleted, onRequestRename, anchorRect }: {
  projectId: string; relPath: string; baseUrl: string; authToken: string | null; showExport?: boolean;
  onClose: () => void; onDeleted?: () => void; onRequestRename?: () => void;
  anchorRect?: DOMRect;
}) {
  const t = useT();
  const deleteProjectNotebook = useStore(s => s.deleteProjectNotebook);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showDeleteModal) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, showDeleteModal]);

  const handleExport = async () => {
    const url = `${baseUrl}/files/zip?path=${encodeURIComponent(relPath)}`;
    const res = await fetch(url, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${relPath.split('/').pop() || 'notebook'}.tar.gz`;
    a.click();
    URL.revokeObjectURL(a.href);
    onClose();
  };

  const displayName = relPath.split('/').pop() || relPath;

  // Use fixed positioning when anchorRect is provided
  const style: React.CSSProperties = anchorRect ? {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    right: window.innerWidth - anchorRect.right,
  } : {};

  return (
    <>
      <div className="project-item-menu" ref={menuRef} style={style}>
        {onRequestRename && <button className="project-item-menu-item" onClick={() => { onClose(); onRequestRename(); }}>{t('sidebar.rename')}</button>}
        {showExport !== false && <button className="project-item-menu-item" onClick={handleExport}>{t('sidebar.export')}</button>}
        <button className="project-item-menu-item project-item-menu-item--danger" onClick={() => setShowDeleteModal(true)}>{t('sidebar.delete')}</button>
      </div>
      {showDeleteModal && (
        <ConfirmDeleteModal
          name={displayName}
          onCancel={() => { setShowDeleteModal(false); onClose(); }}
          onConfirm={() => deleteProjectNotebook(projectId, relPath)}
          onDone={() => {
            useStore.getState().closeProjectFileTabs(projectId, relPath.endsWith('/') ? relPath : relPath + '/');
            setShowDeleteModal(false); onClose(); onDeleted?.();
          }}
        />
      )}
    </>
  );
}

function FileBrowser() {
  const t = useT();
  const activeProjectId = useStore(s => s.activeProjectId);
  const activeProjectPath = useStore(s => s.activeProjectPath);
  const goBackToProjectList = useStore(s => s.goBackToProjectList);
  const authToken = useStore(s => s.authToken);
  const openFileTab = useStore(s => s.openFileTab);
  const importProjectNotebook = useStore(s => s.importProjectNotebook);

  const projectTitle = useStore(s => s.projects.find(p => p.id === s.activeProjectId)?.title ?? 'Project');

  const [showNbCreate, setShowNbCreate] = useState(false);
  const [nbTitle, setNbTitle] = useState('');
  const [nbCreatePhase, setNbCreatePhase] = useState<CreatePhase>('idle');
  const [nbCreateError, setNbCreateError] = useState('');
  const [nbMenuPath, setNbMenuPath] = useState<string | null>(null);
  const [nbMenuAnchorRect, setNbMenuAnchorRect] = useState<DOMRect | null>(null);
  const [nbRenameTarget, setNbRenameTarget] = useState<{ path: string; name: string } | null>(null);
  const [currentSubPath, setCurrentSubPath] = useState('.');
  const [fileRefreshKey, setFileRefreshKey] = useState(0);
  const nbImportRef = useRef<HTMLInputElement>(null);
  const isInsideNotebook = currentSubPath !== '.';

  // WS-based file change detection (replaces 10s HTTP polling)
  useWatcher('files', { projectId: activeProjectId });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setFileRefreshKey(k => k + 1);
    };
    window.addEventListener('nb:files-changed', handler);
    return () => window.removeEventListener('nb:files-changed', handler);
  }, []);

  const handleFileClick = useCallback(async (subPath: string, filename: string) => {
    if (filename.endsWith('.notebook.json')) {
      // Check if this notebook is already open — switch tab instead of re-fetching
      const { openNotebooks, setActiveNotebookTab } = useStore.getState();
      const notebookPath = subPath === '.' ? `${activeProjectPath}/${filename}` : `${activeProjectPath}/${subPath}/${filename}`;
      // Match by workspaceDir (derived from notebookPath's directory)
      const wsDir = notebookPath.replace(/\/[^/]+$/, '');
      for (const [nbId, entry] of Object.entries(openNotebooks)) {
        if (entry.workspaceDir === wsDir) {
          useStore.getState().deactivateFileTab();
          setActiveNotebookTab(nbId);
          return;
        }
      }

      useStore.getState().deactivateFileTab();
      useStore.setState({ notebookLoading: true, gitTabOpen: false });
      try {
        const { ws, openNotebookTab: openTab, subscribeToSession: sub, authToken: token } = useStore.getState();

        // Try WS first, fallback to REST
        if (ws && ws.readyState === WebSocket.OPEN) {
          const requestId = crypto.randomUUID();
          const opened = await new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 180_000);
            function onOpened(e: Event) {
              const d = (e as CustomEvent).detail;
              if (d.request_id === requestId) { cleanup(); resolve(d); }
            }
            function onError(e: Event) {
              const d = (e as CustomEvent).detail;
              if (d.request_id === requestId) { cleanup(); reject(new Error(d.error)); }
            }
            function cleanup() {
              clearTimeout(timeout);
              window.removeEventListener('nb:notebook-opened', onOpened);
              window.removeEventListener('nb:notebook-open-error', onError);
            }
            window.addEventListener('nb:notebook-opened', onOpened);
            window.addEventListener('nb:notebook-open-error', onError);
            ws.send(JSON.stringify({ type: 'notebook_open', request_id: requestId, path: notebookPath }));
          });
          openTab(opened.notebook_id, opened.notebook, opened.session_id, opened.workspace_dir);
          const totalCells = opened.total_cells ?? opened.notebook.cells.length;
          const cellsOffset = totalCells - opened.notebook.cells.length;
          useStore.setState({ cellsOffset, loadingOlderCells: false });
          sub(opened.session_id);
        } else {
          // REST fallback
          const res = await fetch('/api/notebooks/open-by-path', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ path: notebookPath }),
          });
          if (res.ok) {
            const data = await res.json();
            openTab(data.notebookId, data.notebook, data.sessionId, data.workspaceDir);
            sub(data.sessionId);
          }
        }
      } catch (err) {
        console.error('Failed to open notebook:', err);
      } finally {
        useStore.setState({ notebookLoading: false });
      }
    } else {
      const { sessionId, activeProjectId: projId, activeNotebookTabId } = useStore.getState();
      if (!projId) return;
      // FileViewer is a split companion — only open when a notebook tab is active
      if (!activeNotebookTabId) return;
      const relPath = subPath === '.' ? filename : `${subPath}/${filename}`;
      openFileTab({ path: relPath, source: 'workspace', sessionId: sessionId ?? '', projectId: projId });
    }
  }, [activeProjectPath, openFileTab]);

  const handleDirClick = useCallback(async (_subPath: string, _name: string, meta: { isNotebook?: boolean; worktreePath?: string }) => {
    if (meta.isNotebook && meta.worktreePath) {
      // Open the notebook AND let navigateInto proceed (return false)
      try {
        const h: Record<string, string> = {};
        if (authToken) h['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(
          `/api/projects/${activeProjectId}/files?path=${encodeURIComponent(meta.worktreePath)}`,
          { headers: h },
        );
        if (res.ok) {
          const data = await res.json();
          const nbEntry = (data.files as { name: string }[]).find(f => f.name.endsWith('.notebook.json'));
          if (nbEntry) {
            handleFileClick(meta.worktreePath, nbEntry.name);
            // Don't return true — let FileSection navigate into the worktree dir
          }
        }
      } catch { /* fall through to navigate */ }
    } else if (meta.isNotebook) {
      // isNotebook without worktreePath — open notebook, let navigateInto proceed
      handleFileClick(_subPath, `${_name}.notebook.json`);
    }
    // Return undefined → FileSection calls navigateInto() to show directory contents
  }, [handleFileClick, authToken, activeProjectId]);

  const nbTitleError = useMemo(() => validateTitle(nbTitle), [nbTitle]);
  const canCreateNb = nbTitle.trim().length > 0 && !nbTitleError;

  const handleCreateNotebook = () => {
    if (!canCreateNb || !activeProjectId || nbCreatePhase === 'creating') return;
    const title = nbTitle.trim();
    runCreateFlow(
      async () => { await useStore.getState().createNotebook(activeProjectId, title); },
      {
        setPhase: setNbCreatePhase,
        setErrorMsg: setNbCreateError,
        onDone: () => {
          setNbTitle('');
          setShowNbCreate(false);
          setTimeout(() => {
            setNbCreatePhase('idle');
            setFileRefreshKey(k => k + 1);
          }, 800);
        },
      },
    );
  };

  const handleNbImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeProjectId) importProjectNotebook(activeProjectId, file);
    e.target.value = '';
  };

  const renderItemActions = useCallback((file: { name: string; type: string }, subPath: string) => {
    const isNbDir = file.type === 'directory' && (file as any).isNotebook;
    const isNbFile = file.name.endsWith('.notebook.json');
    if (!isNbDir && !isNbFile) return null;
    const relPath = (file as any).worktreePath
      || (subPath === '.' ? file.name : `${subPath}/${file.name}`);
    const displayName = file.name.replace('.notebook.json', '').replace(/^task-/, '');
    return (
      <div className="fp-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="fp-action"
          onClick={(e) => {
            if (nbMenuPath === relPath) {
              setNbMenuPath(null);
              setNbMenuAnchorRect(null);
            } else {
              setNbMenuPath(relPath);
              setNbMenuAnchorRect((e.target as HTMLElement).getBoundingClientRect());
            }
          }}
          title={t('sidebar.notebookActions')}
        >⋯</button>
        {nbMenuPath === relPath && activeProjectId && (
          <NotebookItemMenu
            projectId={activeProjectId}
            relPath={relPath}
            baseUrl={`/api/projects/${activeProjectId}`}
            authToken={authToken}
            showExport={isNbDir}
            anchorRect={nbMenuAnchorRect ?? undefined}
            onClose={() => { setNbMenuPath(null); setNbMenuAnchorRect(null); }}
            onDeleted={() => setFileRefreshKey(k => k + 1)}
            onRequestRename={() => setNbRenameTarget({ path: relPath, name: displayName })}
          />
        )}
      </div>
    );
  }, [nbMenuPath, nbMenuAnchorRect, activeProjectId, authToken]);

  return (
    <div className="file-browser">
      <div className="file-browser-header" onClick={goBackToProjectList}>
        <span className="file-browser-back">&larr;</span>
        <span className="file-browser-title">{projectTitle}</span>
      </div>
      <FileSection
        baseUrl={`/api/projects/${activeProjectId}`}
        authToken={authToken}
        onFileClick={handleFileClick}
        onDirClick={handleDirClick}
        noDragFilter={(name) => name.endsWith('.notebook.json')}
        renderItemActions={renderItemActions}
        onSubPathChange={setCurrentSubPath}
        refreshKey={fileRefreshKey}
        noDeleteFilter={(name, subPath) => {
          // Hide delete for protected system files:
          // - .index.json (project metadata)
          // - .working directory
          // - .MEMORY.md (notebook environment config, read-only)
          return name === '.index.json'
            || name === '.working'
            || name === '.MEMORY.md'
            || subPath === '.working'
            || subPath.startsWith('.working/')
            || subPath.endsWith('/.working')
            || subPath.includes('/.working/');
        }}
      />
      {!isInsideNotebook && (
        <>
          <input
            ref={nbImportRef}
            type="file"
            accept=".notebook.json,.json,.zip"
            style={{ display: 'none' }}
            onChange={handleNbImport}
          />
          {showNbCreate ? (
            <div className="project-create-form-wrap">
              <div className="project-create-form">
                <input
                  autoFocus
                  value={nbTitle}
                  onChange={e => setNbTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateNotebook(); if (e.key === 'Escape') setShowNbCreate(false); }}
                  placeholder={t('sidebar.notebookName')}
                  disabled={nbCreatePhase === 'creating'}
                  maxLength={MAX_TITLE_LENGTH}
                  className={nbTitleError ? 'input-error' : ''}
                />
                <button onClick={handleCreateNotebook} disabled={nbCreatePhase === 'creating' || !canCreateNb}>
                  {t('sidebar.create')}
                </button>
              </div>
              {nbTitleError && <div className="create-form-error">{nbTitleError}</div>}
            </div>
          ) : (
            <div className="project-actions-bar">
              <button className="project-action-btn" onClick={() => setShowNbCreate(true)}>{t('sidebar.new')}</button>
              <button className="project-action-btn" onClick={() => nbImportRef.current?.click()}>{t('sidebar.import')}</button>
            </div>
          )}

          {nbCreatePhase !== 'idle' && (
            <CreateOverlay
              phase={nbCreatePhase as 'creating' | 'done' | 'error'}
              label="Notebook"
              errorMsg={nbCreateError}
              onDismiss={() => setNbCreatePhase('idle')}
            />
          )}
        </>
      )}

      {/* Notebook rename modal */}
      {nbRenameTarget && activeProjectId && (
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
    </div>
  );
}

export function ProjectSidebar() {
  const t = useT();
  const sidebarLevel = useStore(s => s.sidebarLevel);
  const leftSidebarSplitRatio = useStore(s => s.leftSidebarSplitRatio);
  const setLeftSidebarSplitRatio = useStore(s => s.setLeftSidebarSplitRatio);
  const authToken = useStore(s => s.authToken);
  const workspaceDir = useStore(s => s.workspaceDir);
  const sessionId = useStore(s => s.sessionId);
  const openFileTab = useStore(s => s.openFileTab);
  const sidebarWidth = useStore(s => s.sidebarWidth);

  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const sidebarRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);

  // WS-based library change detection
  useWatcher('files', { dirPath: '__library__' });

  useEffect(() => {
    const handler = () => setLibraryRefreshKey(k => k + 1);
    window.addEventListener('nb:files-changed', handler);
    return () => window.removeEventListener('nb:files-changed', handler);
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragging.current || !sidebarRef.current) return;
      const rect = sidebarRef.current.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      setLeftSidebarSplitRatio(ratio);
    };
    const handleUp = () => { dragging.current = false; };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [setLeftSidebarSplitRatio]);

  return (
    <aside className="sidebar" ref={sidebarRef} style={{ width: sidebarWidth }}>
      <div className="sidebar-top" style={{ flex: leftSidebarSplitRatio }}>
        {sidebarLevel === 'L1' ? <ProjectList /> : <FileBrowser />}
      </div>
      <div
        className="sidebar-divider"
        onMouseDown={() => { dragging.current = true; }}
      />
      <div className="sidebar-bottom" style={{ flex: 1 - leftSidebarSplitRatio }}>
        <div className="sidebar-section-header">
          <span>{t('sidebar.library')}</span>
        </div>
        <FileSection
          baseUrl="/api/library"
          authToken={authToken}
          refreshKey={libraryRefreshKey}
          showDownloadAll
          dropLabel={t('sidebar.dropToLibrary')}
          workspaceDir={workspaceDir}
          noDeleteFilter={(name, subPath) => {
            // Root-level dot-prefixed entries and MEMORY.md are system files
            if (subPath === '.') return name.startsWith('.') || name === 'MEMORY.md';
            // Everything under .memory/ is system-managed
            return subPath === '.memory' || subPath.startsWith('.memory/');
          }}
          readOnlyPath={(subPath) => {
            // System directories: .memory and its subdirectories
            return subPath === '.memory' || subPath.startsWith('.memory/');
          }}
          onFileClick={(subPath, name) => {
            if (!useStore.getState().activeNotebookTabId) return;
            const relPath = subPath === '.' ? name : `${subPath}/${name}`;
            openFileTab({ path: relPath, source: 'library', sessionId: sessionId ?? '' });
          }}
        />
      </div>
    </aside>
  );
}
