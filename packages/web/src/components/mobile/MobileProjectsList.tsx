import { useEffect, useState, useMemo } from 'react';
import { useStore } from '../../store';
import { MobileHeader } from './MobileHeader';
import { runRenameFlow, type RenamePhase } from '../renameFlow';
import { validateTitle, MAX_TITLE_LENGTH } from '../../utils/validateTitle';

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

/**
 * Mobile Projects List (Level 1)
 * Shows all projects, tap to navigate to notebooks list.
 */
export function MobileProjectsList() {
  const projects = useStore((s) => s.projects);
  const projectsLoading = useStore((s) => s.projectsLoading);
  const fetchProjects = useStore((s) => s.fetchProjects);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const setMobileView = useStore((s) => s.setMobileView);
  const createProject = useStore((s) => s.createProject);
  const authToken = useStore((s) => s.authToken);

  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleProjectClick = (project: typeof projects[0]) => {
    setActiveProject(project.id, project.path);
    setMobileView('notebooks');
  };

  const handleNewProject = async () => {
    const title = prompt('Project name:');
    if (title?.trim()) {
      try {
        await createProject(title.trim());
        await fetchProjects();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to create project');
      }
    }
  };

  const handleRenameProject = (e: React.MouseEvent, project: typeof projects[0]) => {
    e.stopPropagation();
    setRenameTarget({ id: project.id, title: project.title });
  };

  return (
    <div className="mobile-view mobile-projects-list">
      <MobileHeader title="NoteBook AI" />

      <main className="mobile-content">
        {projectsLoading ? (
          <div className="mobile-loading">Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className="mobile-empty">
            <p>No projects yet</p>
            <button className="mobile-btn-primary" onClick={handleNewProject}>
              Create Project
            </button>
          </div>
        ) : (
          <ul className="mobile-list">
            {projects.map((project) => (
              <li key={project.id} className="mobile-list-item-wrapper">
                <button
                  className="mobile-list-item"
                  onClick={() => handleProjectClick(project)}
                >
                  <span className="mobile-list-icon">📁</span>
                  <span className="mobile-list-text">
                    <span className="mobile-list-title">{project.title}</span>
                    <span className="mobile-list-meta">
                      {project.notebook_count} notebook{project.notebook_count !== 1 ? 's' : ''}
                    </span>
                  </span>
                  <span className="mobile-list-arrow">›</span>
                </button>
                <button
                  className="mobile-list-edit-btn"
                  onClick={(e) => handleRenameProject(e, project)}
                  aria-label="Rename project"
                >
                  ✏️
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {projects.length > 0 && (
        <footer className="mobile-footer">
          <button className="mobile-btn-primary mobile-btn-full" onClick={handleNewProject}>
            + New Project
          </button>
        </footer>
      )}

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
    </div>
  );
}
