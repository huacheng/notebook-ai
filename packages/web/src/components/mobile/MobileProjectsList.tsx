import { useEffect } from 'react';
import { useStore } from '../../store';
import { MobileHeader } from './MobileHeader';

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
              <li key={project.id}>
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
    </div>
  );
}
