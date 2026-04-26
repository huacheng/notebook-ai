import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import * as lz4 from 'lz4js';
import { useStore } from '../store';
import { useT } from '../i18n';
import { FileSection } from './FileSection';
import { runDeleteFlow } from './deleteFlow';
import { runRenameFlow, type RenamePhase } from './renameFlow';
import { runCreateFlow, type CreatePhase } from './createFlow';
import { validateTitle, MAX_TITLE_LENGTH } from '../utils/validateTitle';
import { useWatcher } from '../hooks/useWatcher';
import { NotebookDeleteModal } from './NotebookDeleteModal';
import { getDeliverablesPath } from '../utils/deliverablesPath';
import { cacheRemoveByPrefix } from '../utils/localCache';

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
            // Clear all cached file listings for this project
            cacheRemoveByPrefix(`nb-filelist-/api/projects/${deleteTarget.id}`);
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

function ConfirmDeleteModal({ name, label = 'Notebook', isDefault = false, onCancel, onConfirm, onDone }: {
  name: string;
  label?: string;
  /** When true, show reset semantics ("重置") instead of delete ("删除"). */
  isDefault?: boolean;
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
            <div className="annotation-modal-title">
              {isDefault ? t('sidebar.resetLabel', label) : t('sidebar.deleteLabel', label)}
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-lg)' }}>
              {isDefault ? t('sidebar.resetConfirm', name) : t('sidebar.deleteConfirm', name)}
            </p>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onCancel}>{t('sidebar.cancel')}</button>
              <button className="annotation-modal-btn annotation-modal-btn--danger" onClick={handleConfirm}>
                {isDefault ? '重置' : t('sidebar.delete')}
              </button>
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

function NotebookItemMenu({ relPath, baseUrl, authToken, showExport, isDefault, onClose, onRequestRename, onRequestDelete, anchorRect }: {
  relPath: string; baseUrl: string; authToken: string | null; showExport?: boolean; isDefault?: boolean;
  onClose: () => void; onRequestRename?: () => void;
  onRequestDelete?: () => void;
  anchorRect?: DOMRect;
}) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Delay adding listener to avoid capturing the click that just closed the modal
    const timeoutId = setTimeout(() => {
      const handler = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
      };
      document.addEventListener('mousedown', handler);
      (window as any).__nbMenuHandler = handler; // Store for cleanup
    }, 100);
    return () => {
      clearTimeout(timeoutId);
      const handler = (window as any).__nbMenuHandler;
      if (handler) {
        document.removeEventListener('mousedown', handler);
        delete (window as any).__nbMenuHandler;
      }
    };
  }, [onClose]);

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

  // Use fixed positioning when anchorRect is provided
  const style: React.CSSProperties = anchorRect ? {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    right: window.innerWidth - anchorRect.right,
  } : {};

  return (
    <div className="project-item-menu" ref={menuRef} style={style}>
      {onRequestRename && <button className="project-item-menu-item" onClick={() => { onClose(); onRequestRename(); }}>{t('sidebar.rename')}</button>}
      {showExport !== false && <button className="project-item-menu-item" onClick={handleExport}>{t('sidebar.export')}</button>}
      <button className="project-item-menu-item project-item-menu-item--danger" onClick={() => { onClose(); onRequestDelete?.(); }}>
        {isDefault ? '重置' : t('sidebar.delete')}
      </button>
    </div>
  );
}

function FileBrowser() {
  const t = useT();
  const activeProjectId = useStore(s => s.activeProjectId);
  const activeProjectPath = useStore(s => s.activeProjectPath);
  const goBackToProjectList = useStore(s => s.goBackToProjectList);
  const authToken = useStore(s => s.authToken);
  const openFileTab = useStore(s => s.openFileTab);
  const deleteProjectNotebook = useStore(s => s.deleteProjectNotebook);
  const workspaceDir = useStore(s => s.workspaceDir);

  const projectTitle = useStore(s => s.projects.find(p => p.id === s.activeProjectId)?.title ?? 'Project');

  const sessionId = useStore(s => s.sessionId);

  const [l2Tab, setL2Tab] = useState<'files' | 'deliverables'>('files');
  const [nbMenuPath, setNbMenuPath] = useState<string | null>(null);
  const [nbMenuAnchorRect, setNbMenuAnchorRect] = useState<DOMRect | null>(null);
  const [nbRenameTarget, setNbRenameTarget] = useState<{ path: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ relPath: string; displayName: string; isWorktree: boolean; projectPath: string; isDefault?: boolean } | null>(null);
  const [currentSubPath, setCurrentSubPath] = useState('.');
  const [fileRefreshKey, setFileRefreshKey] = useState(0);

  const handleDeleteDone = useCallback(() => {
    if (!deleteTarget || !activeProjectId) return;
    const store = useStore.getState();
    store.closeProjectFileTabs(activeProjectId, deleteTarget.relPath.endsWith('/') ? deleteTarget.relPath : deleteTarget.relPath + '/');
    if (deleteTarget.projectPath) {
      const fullPath = deleteTarget.relPath.startsWith('/') ? deleteTarget.relPath : `${deleteTarget.projectPath}/${deleteTarget.relPath}`;
      store.closeNotebookTabByPath(fullPath);
    }
    setDeleteTarget(null);
    setFileRefreshKey(k => k + 1);
  }, [deleteTarget, activeProjectId]);

  // When navigating in Files tab, reset workspaceDir if leaving a worktree directory
  const handleSubPathChange = useCallback((newPath: string) => {
    setCurrentSubPath(newPath);
    // Reset workspaceDir when navigating back to project root or .worktrees level
    if (newPath === '.' || newPath === '.worktrees') {
      useStore.setState({ workspaceDir: null });
    }
  }, []);

  // Deliverables tab state
  const delivPath = getDeliverablesPath(workspaceDir, activeProjectPath);
  const [delivRefreshKey, setDelivRefreshKey] = useState(0);
  const [delivExists, setDelivExists] = useState<boolean | null>(null);

  useEffect(() => { setDelivExists(null); }, [delivPath]);

  const handleDelivExists = useCallback((exists: boolean) => { setDelivExists(exists); }, []);

  // Watch deliverables dir (or parent if not yet created)
  const delivWatchPath = delivExists === false
    ? (delivPath.lastIndexOf('/') > 0 ? delivPath.slice(0, delivPath.lastIndexOf('/')) : '.')
    : delivPath;
  useWatcher('files', { projectId: activeProjectId, dirPath: delivWatchPath });

  useEffect(() => {
    const handler = () => setDelivRefreshKey(k => k + 1);
    window.addEventListener('nb:files-changed', handler);
    return () => window.removeEventListener('nb:files-changed', handler);
  }, []);

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
        const { ws, openNotebookTab: openTab, authToken: token } = useStore.getState();

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
            ws.send(JSON.stringify({ type: 'open_notebook', request_id: requestId, path: notebookPath }));
          });
          openTab(opened.notebook_id, opened.notebook, opened.session_id, opened.workspace_dir);
          const totalCells = opened.total_cells ?? opened.notebook.cells.length;
          const cellsOffset = Math.max(0, totalCells - opened.notebook.cells.length);
          useStore.setState({ cellsOffset, loadingOlderCells: false });
          // Note: useWebSocket hook auto-subscribes when openNotebooks changes
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
            let notebook = data.notebook;
            if (data.notebook_compressed && data.compression === 'lz4') {
              const compressed = Uint8Array.from(atob(data.notebook_compressed), c => c.charCodeAt(0));
              const decompressed = lz4.decompress(compressed);
              notebook = JSON.parse(new TextDecoder().decode(decompressed));
            }
            openTab(data.notebookId, notebook, data.sessionId, data.workspaceDir);
            // Note: useWebSocket hook auto-subscribes when openNotebooks changes
          }
        }
      } catch (err) {
        console.error('Failed to open notebook:', err);
      } finally {
        useStore.setState({ notebookLoading: false });
      }
    } else {
      const { sessionId, activeProjectId: projId } = useStore.getState();
      if (!projId) return;
      const relPath = subPath === '.' ? filename : `${subPath}/${filename}`;
      openFileTab({ path: relPath, source: 'workspace', sessionId: sessionId ?? '', projectId: projId });
    }
  }, [activeProjectPath, openFileTab]);

  // Clicking a notebook directory updates workspaceDir so deliverables tab shows that notebook's deliverables.
  // The directory navigation still happens (return undefined).
  const handleDirClick = useCallback((subPath: string, name: string, meta: { isNotebook?: boolean; worktreePath?: string }) => {
    if (!meta.isNotebook || !activeProjectPath) return; // Regular dir → just navigate

    // Notebook directory clicked — update workspaceDir for deliverables path
    const worktreePath = meta.worktreePath || `${activeProjectPath}/${subPath === '.' ? name : `${subPath}/${name}`}`;
    useStore.setState({ workspaceDir: worktreePath });
    // Return undefined → FileSection still navigates into the directory
  }, [activeProjectPath]);

  const renderItemActions = useCallback((file: { name: string; type: string }, subPath: string) => {
    const isNbDir = file.type === 'directory' && (file as any).isNotebook;
    const isNbFile = file.name.endsWith('.notebook.json');
    if (!isNbDir && !isNbFile) return null;
    const relPath = (file as any).worktreePath
      || (subPath === '.' ? file.name : `${subPath}/${file.name}`);
    const displayName = (file as any).title || file.name.replace('.notebook.json', '').replace(/^task-/, '');
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
            relPath={relPath}
            baseUrl={`/api/projects/${activeProjectId}`}
            authToken={authToken}
            showExport={isNbDir}
            isDefault={!!(file as any).is_default}
            anchorRect={nbMenuAnchorRect ?? undefined}
            onClose={() => { setNbMenuPath(null); setNbMenuAnchorRect(null); }}
            onRequestDelete={() => setDeleteTarget({
              relPath,
              displayName,
              isWorktree: relPath.includes('.worktrees/'),
              projectPath: activeProjectPath ?? '',
              isDefault: !!(file as any).is_default,
            })}
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
      <div className="sidebar-l2-tabs">
        <button
          className={`sidebar-l2-tab${l2Tab === 'files' ? ' sidebar-l2-tab--active' : ''}`}
          onClick={() => setL2Tab('files')}
        >
          {t('sidebar.files')}
        </button>
        <button
          className="sidebar-l2-tab"
          onClick={() => openFileTab({ source: 'project-git', path: 'git', sessionId: sessionId ?? '', projectId: activeProjectId ?? undefined })}
        >
          {t('git.title')}
        </button>
        <button
          className={`sidebar-l2-tab${l2Tab === 'deliverables' ? ' sidebar-l2-tab--active' : ''}`}
          onClick={() => setL2Tab('deliverables')}
        >
          {workspaceDir ? t('deliverables.notebook') : t('deliverables.title')}
        </button>
      </div>
      {l2Tab === 'files' && (
        <>
          <FileSection
            key={activeProjectId ?? 'root'}
            baseUrl={`/api/projects/${activeProjectId}`}
            authToken={authToken}
            startPath={currentSubPath}
            allowNavigateAbove
            onFileClick={handleFileClick}
            onDirClick={handleDirClick}
            noDragFilter={(name) => name.endsWith('.notebook.json')}
            renderItemActions={renderItemActions}
            onSubPathChange={handleSubPathChange}
            refreshKey={fileRefreshKey}
            noDeleteFilter={(name, subPath) => {
              return name === '.status.json'
                || name === '.working'
                || name === '.MEMORY.md'
                || name === '.claude'
                || subPath === '.working'
                || subPath.startsWith('.working/')
                || subPath.endsWith('/.working')
                || subPath.includes('/.working/')
                || subPath === '.claude';
            }}
          />
        </>
      )}
      {l2Tab === 'deliverables' && (
        <FileSection
          key={delivPath}
          baseUrl={`/api/projects/${activeProjectId}`}
          authToken={authToken}
          showDownloadAll
          initialPath={delivPath}
          refreshKey={delivRefreshKey}
          onExists={handleDelivExists}
          onFileClick={(subPath, name) => {
            const relPath = subPath === '.' ? name : `${subPath}/${name}`;
            openFileTab({ path: relPath, source: 'deliverables', sessionId: sessionId ?? '', projectId: activeProjectId ?? undefined });
          }}
        />
      )}

      {/* Notebook delete modal — rendered at FileBrowser level so file list refreshes don't unmount it */}
      {deleteTarget && activeProjectId && deleteTarget.isWorktree && (
        <NotebookDeleteModal
          name={deleteTarget.displayName}
          branchName={'task/' + (deleteTarget.displayName.startsWith('task-') ? deleteTarget.displayName.slice(5) : deleteTarget.displayName)}
          isDefault={deleteTarget.isDefault}
          onMergeDelete={() => deleteProjectNotebook(activeProjectId, deleteTarget.relPath, true)}
          onDeleteOnly={() => deleteProjectNotebook(activeProjectId, deleteTarget.relPath, false)}
          onCancel={() => setDeleteTarget(null)}
          onDone={handleDeleteDone}
        />
      )}
      {deleteTarget && activeProjectId && !deleteTarget.isWorktree && (
        <ConfirmDeleteModal
          name={deleteTarget.displayName}
          isDefault={deleteTarget.isDefault}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteProjectNotebook(activeProjectId, deleteTarget.relPath)}
          onDone={handleDeleteDone}
        />
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
  const [libraryTab, setLibraryTab] = useState<'files'>('files');
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
        <div className="sidebar-l2-tabs">
          <button
            className={`sidebar-l2-tab${libraryTab === 'files' ? ' sidebar-l2-tab--active' : ''}`}
            onClick={() => setLibraryTab('files')}
          >
            {t('sidebar.files')}
          </button>
          <button
            className="sidebar-l2-tab"
            onClick={() => openFileTab({ source: 'library-git', path: 'git', sessionId: sessionId ?? '' })}
          >
            {t('git.title')}
          </button>
        </div>
        {libraryTab === 'files' && (
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
              const relPath = subPath === '.' ? name : `${subPath}/${name}`;
              openFileTab({ path: relPath, source: 'library', sessionId: sessionId ?? '' });
            }}
          />
        )}
      </div>
    </aside>
  );
}
