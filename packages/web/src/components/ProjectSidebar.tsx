import { useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { FileSection } from './FileSection';

function ProjectItemMenu({ projectId, projectSlug, onClose }: { projectId: string; projectSlug: string; onClose: () => void }) {
  const deleteProject = useStore(s => s.deleteProject);
  const authToken = useStore(s => s.authToken);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleExport = () => {
    const url = `/api/projects/${projectId}/files/zip`;
    const a = document.createElement('a');
    a.href = authToken ? `${url}?token=${encodeURIComponent(authToken)}` : url;
    a.download = `${projectSlug}.tar.gz`;
    a.click();
    onClose();
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this project? This cannot be undone.')) return;
    await deleteProject(projectId);
    onClose();
  };

  return (
    <div className="project-item-menu" ref={menuRef}>
      <button className="project-item-menu-item" onClick={handleExport}>Export</button>
      <button className="project-item-menu-item project-item-menu-item--danger" onClick={handleDelete}>Delete</button>
    </div>
  );
}

function ProjectList() {
  const { projects, projectsLoading, createProject, setActiveProject, importProject } = useStore();
  const [newTitle, setNewTitle] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    await createProject(newTitle.trim());
    setNewTitle('');
    setShowCreate(false);
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
                onClose={() => setMenuOpenId(null)}
              />
            )}
          </div>
        ))}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".tar.gz,.tgz"
        style={{ display: 'none' }}
        onChange={handleImport}
      />
      {showCreate ? (
        <div className="project-create-form">
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
            placeholder="Project name..."
          />
          <button onClick={handleCreate}>Create</button>
        </div>
      ) : (
        <div className="project-actions-bar">
          <button className="project-action-btn" onClick={() => setShowCreate(true)}>+ New</button>
          <button className="project-action-btn" onClick={() => fileInputRef.current?.click()}>&#8593; Import</button>
        </div>
      )}
    </div>
  );
}

function NotebookItemMenu({ projectId, relPath, baseUrl, authToken, onClose }: {
  projectId: string; relPath: string; baseUrl: string; authToken: string | null; onClose: () => void;
}) {
  const deleteProjectNotebook = useStore(s => s.deleteProjectNotebook);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleExport = () => {
    const url = `${baseUrl}/files/download?path=${encodeURIComponent(relPath)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = relPath.split('/').pop() || 'notebook.json';
    a.click();
    onClose();
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this notebook? This cannot be undone.')) return;
    await deleteProjectNotebook(projectId, relPath);
    onClose();
  };

  return (
    <div className="project-item-menu" ref={menuRef}>
      <button className="project-item-menu-item" onClick={handleExport}>Export</button>
      <button className="project-item-menu-item project-item-menu-item--danger" onClick={handleDelete}>Delete</button>
    </div>
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
  const [nbCreating, setNbCreating] = useState(false);
  const [nbMenuPath, setNbMenuPath] = useState<string | null>(null);
  const nbImportRef = useRef<HTMLInputElement>(null);

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
          openTab(data.notebookId, data.notebook, data.sessionId);
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

  const handleCreateNotebook = async () => {
    if (!nbTitle.trim() || !activeProjectId || nbCreating) return;
    setNbCreating(true);
    try {
      await useStore.getState().createNotebook(activeProjectId, nbTitle.trim());
      setNbTitle('');
      setShowNbCreate(false);
    } catch (err) {
      console.error('Failed to create notebook:', err);
    } finally {
      setNbCreating(false);
    }
  };

  const handleNbImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeProjectId) importProjectNotebook(activeProjectId, file);
    e.target.value = '';
  };

  const renderItemActions = useCallback((file: { name: string; type: string }, subPath: string) => {
    if (!file.name.endsWith('.notebook.json')) return null;
    const relPath = subPath === '.' ? file.name : `${subPath}/${file.name}`;
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
            onClose={() => setNbMenuPath(null)}
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
      />
      <input
        ref={nbImportRef}
        type="file"
        accept=".notebook.json,.json,.zip"
        style={{ display: 'none' }}
        onChange={handleNbImport}
      />
      {showNbCreate ? (
        <div className="project-create-form">
          <input
            autoFocus
            value={nbTitle}
            onChange={e => setNbTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateNotebook(); if (e.key === 'Escape') setShowNbCreate(false); }}
            placeholder="Notebook name..."
            disabled={nbCreating}
          />
          <button onClick={handleCreateNotebook} disabled={nbCreating || !nbTitle.trim()}>
            {nbCreating ? '...' : 'Create'}
          </button>
        </div>
      ) : (
        <div className="project-actions-bar">
          <button className="project-action-btn" onClick={() => setShowNbCreate(true)}>+ New</button>
          <button className="project-action-btn" onClick={() => nbImportRef.current?.click()}>&#8593; Import</button>
        </div>
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
