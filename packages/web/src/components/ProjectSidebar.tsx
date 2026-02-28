import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../store';
import { FileSection } from './FileSection';
import { runDeleteFlow } from './deleteFlow';
import { runCreateFlow, type CreatePhase } from './createFlow';
import { validateTitle, MAX_TITLE_LENGTH } from '../utils/validateTitle';

function CreateOverlay({ phase, label, errorMsg, onDismiss }: {
  phase: 'creating' | 'done' | 'error';
  label: string;
  errorMsg: string;
  onDismiss: () => void;
}) {
  return (
    <div className="annotation-modal-overlay" onClick={phase === 'error' ? onDismiss : undefined}>
      <div className="annotation-modal" onClick={e => e.stopPropagation()}>
        {phase === 'creating' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div className="nb-delete-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
              Creating <strong>{label}</strong>...
            </p>
          </div>
        )}
        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {label} created
            </p>
          </div>
        )}
        {phase === 'error' && (
          <>
            <div className="annotation-modal-title" style={{ color: 'var(--color-error)' }}>Create Failed</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-lg)' }}>
              {errorMsg}
            </p>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onDismiss}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}



function ProjectItemMenu({ projectId, projectSlug, authToken, onClose, onRequestDelete }: {
  projectId: string; projectSlug: string; authToken: string | null;
  onClose: () => void; onRequestDelete: () => void;
}) {
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

  return (
    <div className="project-item-menu" ref={menuRef} onClick={e => e.stopPropagation()}>
      <button className="project-item-menu-item" onClick={handleExport}>Export</button>
      <button className="project-item-menu-item project-item-menu-item--danger" onClick={() => { onClose(); onRequestDelete(); }}>Delete</button>
    </div>
  );
}

function ProjectList() {
  const { projects, projectsLoading, createProject, setActiveProject, importProject } = useStore();
  const deleteProject = useStore(s => s.deleteProject);
  const authToken = useStore(s => s.authToken);
  const [newTitle, setNewTitle] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
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
        <span>Projects</span>
      </div>
      {projectsLoading && <div className="project-list-loading">Loading...</div>}
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
                onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === p.id ? null : p.id); }}
                title="Project actions"
              >⋯</button>
            </div>
            <span className="project-list-item-meta">
              {p.notebook_count} notebooks
            </span>
            {menuOpenId === p.id && (
              <ProjectItemMenu
                projectId={p.id}
                projectSlug={p.slug}
                authToken={authToken}
                onClose={() => setMenuOpenId(null)}
                onRequestDelete={() => setDeleteTarget({ id: p.id, title: p.title })}
              />
            )}
          </div>
        ))}
      </div>

      {/* Delete modal rendered OUTSIDE projects.map — survives list refresh */}
      {deleteTarget && (
        <ConfirmDeleteModal
          name={deleteTarget.title}
          label="Project"
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
              placeholder="Project name..."
              maxLength={MAX_TITLE_LENGTH}
              className={titleError ? 'input-error' : ''}
            />
            <button onClick={handleCreate} disabled={!canCreate}>Create</button>
          </div>
          {titleError && <div className="create-form-error">{titleError}</div>}
        </div>
      ) : (
        <div className="project-actions-bar">
          <button className="project-action-btn" onClick={() => setShowCreate(true)}>+ New</button>
          <button className="project-action-btn" onClick={() => fileInputRef.current?.click()}>&#8593; Import</button>
        </div>
      )}

      {createPhase !== 'idle' && (
        <CreateOverlay
          phase={createPhase as 'creating' | 'done' | 'error'}
          label="Project"
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
            <div className="annotation-modal-title">Delete {label}</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-lg)' }}>
              Are you sure you want to delete <strong>{name}</strong>? This cannot be undone.
            </p>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onCancel}>Cancel</button>
              <button className="annotation-modal-btn annotation-modal-btn--danger" onClick={handleConfirm}>Delete</button>
            </div>
          </>
        )}
        {phase === 'deleting' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div className="nb-delete-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
              Deleting <strong>{name}</strong>...
            </p>
          </div>
        )}
        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {label} deleted
            </p>
          </div>
        )}
        {phase === 'error' && (
          <>
            <div className="annotation-modal-title" style={{ color: 'var(--color-error)' }}>Delete Failed</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-lg)' }}>
              {errorMsg}
            </p>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onCancel}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NotebookItemMenu({ projectId, relPath, baseUrl, authToken, showExport, onClose, onDeleted }: {
  projectId: string; relPath: string; baseUrl: string; authToken: string | null; showExport?: boolean; onClose: () => void; onDeleted?: () => void;
}) {
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

  return (
    <>
      <div className="project-item-menu" ref={menuRef}>
        {showExport !== false && <button className="project-item-menu-item" onClick={handleExport}>Export</button>}
        <button className="project-item-menu-item project-item-menu-item--danger" onClick={() => setShowDeleteModal(true)}>Delete</button>
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
  const [currentSubPath, setCurrentSubPath] = useState('.');
  const [fileRefreshKey, setFileRefreshKey] = useState(0);
  const nbImportRef = useRef<HTMLInputElement>(null);
  const isInsideNotebook = currentSubPath !== '.';

  const handleFileClick = useCallback(async (subPath: string, filename: string) => {
    if (filename.endsWith('.notebook.json')) {
      const notebookPath = subPath === '.' ? `${activeProjectPath}/${filename}` : `${activeProjectPath}/${subPath}/${filename}`;
      useStore.getState().deactivateFileTab();
      useStore.setState({ notebookLoading: true, gitTabOpen: false });
      try {
        const { authToken: token, openNotebookTab: openTab, subscribeToSession: sub } = useStore.getState();
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
    return (
      <div className="fp-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="fp-action"
          onClick={() => setNbMenuPath(nbMenuPath === relPath ? null : relPath)}
          title="Notebook actions"
        >⋯</button>
        {nbMenuPath === relPath && activeProjectId && (
          <NotebookItemMenu
            projectId={activeProjectId}
            relPath={relPath}
            baseUrl={`/api/projects/${activeProjectId}`}
            authToken={authToken}
            showExport={isNbDir}
            onClose={() => setNbMenuPath(null)}
            onDeleted={() => setFileRefreshKey(k => k + 1)}
          />
        )}
      </div>
    );
  }, [nbMenuPath, activeProjectId, authToken]);

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
        noDragFilter={(name) => name.endsWith('.notebook.json')}
        renderItemActions={renderItemActions}
        onSubPathChange={setCurrentSubPath}
        refreshKey={fileRefreshKey}
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
                  placeholder="Notebook name..."
                  disabled={nbCreatePhase === 'creating'}
                  maxLength={MAX_TITLE_LENGTH}
                  className={nbTitleError ? 'input-error' : ''}
                />
                <button onClick={handleCreateNotebook} disabled={nbCreatePhase === 'creating' || !canCreateNb}>
                  Create
                </button>
              </div>
              {nbTitleError && <div className="create-form-error">{nbTitleError}</div>}
            </div>
          ) : (
            <div className="project-actions-bar">
              <button className="project-action-btn" onClick={() => setShowNbCreate(true)}>+ New</button>
              <button className="project-action-btn" onClick={() => nbImportRef.current?.click()}>&#8593; Import</button>
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
    </div>
  );
}

export function ProjectSidebar() {
  const sidebarLevel = useStore(s => s.sidebarLevel);
  const leftSidebarSplitRatio = useStore(s => s.leftSidebarSplitRatio);
  const setLeftSidebarSplitRatio = useStore(s => s.setLeftSidebarSplitRatio);
  const authToken = useStore(s => s.authToken);
  const workspaceDir = useStore(s => s.workspaceDir);
  const sessionId = useStore(s => s.sessionId);
  const openFileTab = useStore(s => s.openFileTab);
  const sidebarWidth = useStore(s => s.sidebarWidth);

  const sidebarRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);

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
          <span>Library</span>
          <span className="fp-section-sub">drag to prompt</span>
        </div>
        <FileSection
          baseUrl="/api/library"
          authToken={authToken}
          showDownloadAll
          dropLabel="Drop to add to Library"
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
      </div>
    </aside>
  );
}
