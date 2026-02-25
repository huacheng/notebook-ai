import { useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { FileSection } from './FileSection';

function ProjectList() {
  const { projects, projectsLoading, createProject, setActiveProject } = useStore();
  const [newTitle, setNewTitle] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    await createProject(newTitle.trim());
    setNewTitle('');
    setShowCreate(false);
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
            <span className="project-list-item-title">{p.title}</span>
            <span className="project-list-item-meta">
              {p.notebook_count} notebooks
            </span>
          </div>
        ))}
      </div>
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
        <button className="project-create-btn" onClick={() => setShowCreate(true)}>
          + New Project
        </button>
      )}
    </div>
  );
}

function FileBrowser() {
  const activeProjectId = useStore(s => s.activeProjectId);
  const activeProjectPath = useStore(s => s.activeProjectPath);
  const goBackToProjectList = useStore(s => s.goBackToProjectList);
  const authToken = useStore(s => s.authToken);
  const openFileTab = useStore(s => s.openFileTab);

  const projectTitle = useStore(s => s.projects.find(p => p.id === s.activeProjectId)?.title ?? 'Project');

  const [showNbCreate, setShowNbCreate] = useState(false);
  const [nbTitle, setNbTitle] = useState('');
  const [nbCreating, setNbCreating] = useState(false);

  const handleFileClick = useCallback(async (subPath: string, filename: string) => {
    if (filename.endsWith('.notebook.json')) {
      const notebookPath = subPath === '.' ? `${activeProjectPath}/${filename}` : `${activeProjectPath}/${subPath}/${filename}`;
      // Activate loading screen: deactivate file/git tabs so loading screen is visible
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
        <button className="file-browser-create-btn" onClick={() => setShowNbCreate(true)}>
          + New Notebook
        </button>
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
          onFileClick={(subPath, name) => {
            const relPath = subPath === '.' ? name : `${subPath}/${name}`;
            openFileTab({ path: relPath, source: 'library', sessionId: sessionId ?? '' });
          }}
        />
      </div>
    </aside>
  );
}
