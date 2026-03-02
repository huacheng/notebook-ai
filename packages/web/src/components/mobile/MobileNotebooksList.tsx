import { useEffect, useState, useMemo } from 'react';
import { useStore } from '../../store';
import { MobileHeader } from './MobileHeader';
import { useNotebookActions } from '../../hooks/useNotebookActions';
import { runRenameFlow, type RenamePhase } from '../renameFlow';
import { validateTitle, MAX_TITLE_LENGTH } from '../../utils/validateTitle';

interface NotebookEntry {
  name: string;
  path: string;
}

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
            <h3 className="mobile-modal-title">Rename Notebook</h3>
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
 * Mobile Notebooks List (Level 2)
 * Shows notebooks in the selected project.
 *
 * Uses useNotebookActions hook for unified notebook operations,
 * ensuring consistency with desktop UI behavior.
 */
export function MobileNotebooksList() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeProjectPath = useStore((s) => s.activeProjectPath);
  const projects = useStore((s) => s.projects);
  const setMobileView = useStore((s) => s.setMobileView);
  const authToken = useStore((s) => s.authToken);

  const [notebooks, setNotebooks] = useState<NotebookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string } | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Unified notebook actions hook - same logic as desktop
  const { openNotebookWithTab, createAndOpenNotebook } = useNotebookActions({
    onError: (err: Error) => {
      alert(err.message || 'Failed to perform notebook operation');
    },
  });

  const fetchNotebooks = async () => {
    if (!activeProjectId) return;
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

  useEffect(() => {
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

  const handleRenameNotebook = (e: React.MouseEvent, nb: NotebookEntry) => {
    e.stopPropagation();
    setRenameTarget({ path: nb.path, name: nb.name });
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
              <li key={nb.path} className="mobile-list-item-wrapper">
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
                <button
                  className="mobile-list-edit-btn"
                  onClick={(e) => handleRenameNotebook(e, nb)}
                  aria-label="Rename notebook"
                >
                  ✏️
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

      {renameTarget && activeProjectId && (
        <MobileRenameModal
          currentName={renameTarget.name}
          onCancel={() => setRenameTarget(null)}
          onConfirm={async (newName) => {
            const res = await fetch(`/api/projects/${activeProjectId}/notebooks/rename`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
              },
              body: JSON.stringify({
                notebookPath: renameTarget.path,
                title: newName,
              }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || 'Failed to rename');
            }
          }}
          onDone={() => {
            setRenameTarget(null);
            fetchNotebooks();
          }}
        />
      )}
    </div>
  );
}
