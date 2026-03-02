import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { MobileHeader } from './MobileHeader';
import { useNotebookActions } from '../../hooks/useNotebookActions';

interface NotebookEntry {
  name: string;
  path: string;
}

/**
 * Mobile Notebooks List (Level 2)
 * Shows notebooks in the selected project.
 *
 * Uses useNotebookActions hook for unified notebook operations,
 * ensuring consistency with desktop UI behavior.
 */
export function MobileNotebooksList() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const setMobileView = useStore((s) => s.setMobileView);
  const authToken = useStore((s) => s.authToken);

  const [notebooks, setNotebooks] = useState<NotebookEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Unified notebook actions hook - same logic as desktop
  const { openNotebookWithTab, createAndOpenNotebook } = useNotebookActions({
    onError: (err: Error) => {
      alert(err.message || 'Failed to perform notebook operation');
    },
  });

  useEffect(() => {
    if (!activeProjectId) return;

    const fetchNotebooks = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${activeProjectId}/notebooks`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setNotebooks(data.notebooks || []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };

    fetchNotebooks();
  }, [activeProjectId, authToken]);

  const handleBack = () => {
    setMobileView('projects');
  };

  const handleNotebookClick = async (nb: NotebookEntry) => {
    try {
      // Use unified hook - same as desktop
      await openNotebookWithTab(nb.path);
      setMobileView('notebook');
    } catch {
      // Error already handled by onError callback
    }
  };

  const handleNewNotebook = async () => {
    if (!activeProjectId) return;

    const title = prompt('Notebook name:');
    if (title?.trim()) {
      try {
        // Use unified hook - same as desktop
        await createAndOpenNotebook(activeProjectId, title.trim());
        setMobileView('notebook');
      } catch {
        // Error already handled by onError callback
      }
    }
  };

  return (
    <div className="mobile-view mobile-notebooks-list">
      <MobileHeader
        title={activeProject?.title || 'Notebooks'}
        showBack
        onBack={handleBack}
      />

      <main className="mobile-content">
        {loading ? (
          <div className="mobile-loading">Loading notebooks...</div>
        ) : notebooks.length === 0 ? (
          <div className="mobile-empty">
            <p>No notebooks yet</p>
            <button className="mobile-btn-primary" onClick={handleNewNotebook}>
              Create Notebook
            </button>
          </div>
        ) : (
          <ul className="mobile-list">
            {notebooks.map((nb) => (
              <li key={nb.path}>
                <button
                  className="mobile-list-item"
                  onClick={() => handleNotebookClick(nb)}
                >
                  <span className="mobile-list-icon">📓</span>
                  <span className="mobile-list-text">
                    <span className="mobile-list-title">{nb.name}</span>
                  </span>
                  <span className="mobile-list-arrow">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {notebooks.length > 0 && (
        <footer className="mobile-footer">
          <button className="mobile-btn-primary mobile-btn-full" onClick={handleNewNotebook}>
            + New Notebook
          </button>
        </footer>
      )}
    </div>
  );
}
