import { useEffect, useState, useMemo, useRef } from 'react';
import { useStore } from '../../store';
import { MobileHeader } from './MobileHeader';
import { useNotebookActions } from '../../hooks/useNotebookActions';
import { runRenameFlow, type RenamePhase } from '../renameFlow';
import { runDeleteFlow, type DeletePhase } from '../deleteFlow';
import { validateTitle, MAX_TITLE_LENGTH } from '../../utils/validateTitle';

interface NotebookEntry {
  name: string;
  path: string;
}

/** Mobile delete confirmation modal */
function MobileDeleteModal({ name, label = 'Notebook', onCancel, onConfirm, onDone }: {
  name: string;
  label?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  onDone?: () => void;
}) {
  const [phase, setPhase] = useState<DeletePhase>('confirm');
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
              Are you sure you want to delete "{name}"? This cannot be undone.
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
              Deleting {name}...
            </p>
          </div>
        )}
        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {label} deleted!
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

/** Mobile dropdown menu for notebook actions */
function MobileNotebookMenu({ projectId, relPath, onClose, onRequestRename, onRequestDelete }: {
  projectId: string;
  relPath: string;
  onClose: () => void;
  onRequestRename: () => void;
  onRequestDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [onClose]);

  const handleExport = async () => {
    const url = `/api/projects/${projectId}/files/zip?path=${encodeURIComponent(relPath)}`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${relPath.split('/').pop() || 'notebook'}.tar.gz`;
    a.click();
    URL.revokeObjectURL(a.href);
    onClose();
  };

  // Touch event handlers for immediate response (don't wait for click)
  const handleRenameTouch = (e: React.TouchEvent) => {
    e.preventDefault();
    onClose();
    onRequestRename();
  };
  const handleExportTouch = (e: React.TouchEvent) => {
    e.preventDefault();
    handleExport();
  };
  const handleDeleteTouch = (e: React.TouchEvent) => {
    e.preventDefault();
    onClose();
    onRequestDelete();
  };

  return (
    <div
      className="mobile-item-menu"
      ref={menuRef}
      onClick={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
    >
      <button className="mobile-item-menu-item" onClick={() => { onClose(); onRequestRename(); }} onTouchEnd={handleRenameTouch}>Rename</button>
      <button className="mobile-item-menu-item" onClick={handleExport} onTouchEnd={handleExportTouch}>Export</button>
      <button className="mobile-item-menu-item mobile-item-menu-item--danger" onClick={() => { onClose(); onRequestDelete(); }} onTouchEnd={handleDeleteTouch}>Delete</button>
    </div>
  );
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
    <div className="annotation-modal-overlay" onClick={phase === 'editing' || phase === 'error' ? onCancel : undefined}>
      <div className="annotation-modal" onClick={e => e.stopPropagation()}>
        {phase === 'editing' && (
          <>
            <div className="annotation-modal-title">Rename Notebook</div>
            <div style={{ margin: '0 0 var(--space-lg)' }}>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && canSave) handleConfirm(); if (e.key === 'Escape') onCancel(); }}
                placeholder="New name"
                maxLength={MAX_TITLE_LENGTH}
                className="annotation-modal-input"
              />
              {nameError && <div className="create-form-error">{nameError}</div>}
            </div>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onCancel}>Cancel</button>
              <button className="annotation-modal-btn annotation-modal-confirm" onClick={handleConfirm} disabled={!canSave}>Rename</button>
            </div>
          </>
        )}
        {phase === 'saving' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div className="nb-delete-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
              Renaming...
            </p>
          </div>
        )}
        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              Renamed!
            </p>
          </div>
        )}
        {phase === 'error' && (
          <>
            <div className="annotation-modal-title" style={{ color: 'var(--color-error)' }}>Rename Failed</div>
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

/** Mobile create modal - replaces browser prompt() for better mobile compatibility */
function MobileCreateModal({ label, onCancel, onConfirm, onDone }: {
  label: string;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void>;
  onDone?: () => void;
}) {
  const [phase, setPhase] = useState<'editing' | 'creating' | 'done' | 'error'>('editing');
  const [errorMsg, setErrorMsg] = useState('');
  const [name, setName] = useState('');

  const nameError = useMemo(() => validateTitle(name), [name]);
  const canCreate = name.trim().length > 0 && !nameError;

  const handleConfirm = async () => {
    if (!canCreate || phase === 'creating') return;
    setPhase('creating');
    try {
      await onConfirm(name.trim());
      setPhase('done');
      setTimeout(() => onDone?.(), 600);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Create failed');
      setPhase('error');
    }
  };

  return (
    <div className="annotation-modal-overlay" onClick={phase === 'editing' || phase === 'error' ? onCancel : undefined}>
      <div className="annotation-modal" onClick={e => e.stopPropagation()}>
        {phase === 'editing' && (
          <>
            <div className="annotation-modal-title">New {label}</div>
            <div style={{ margin: '0 0 var(--space-lg)' }}>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && canCreate) handleConfirm(); if (e.key === 'Escape') onCancel(); }}
                placeholder={`${label} name`}
                maxLength={MAX_TITLE_LENGTH}
                className="annotation-modal-input"
              />
              {nameError && <div className="create-form-error">{nameError}</div>}
            </div>
            <div className="annotation-modal-actions">
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onCancel}>Cancel</button>
              <button className="annotation-modal-btn annotation-modal-confirm" onClick={handleConfirm} disabled={!canCreate}>Create</button>
            </div>
          </>
        )}
        {phase === 'creating' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div className="nb-delete-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
              Creating {label}...
            </p>
          </div>
        )}
        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {label} created!
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
              <button className="annotation-modal-btn annotation-modal-cancel" onClick={onCancel}>Close</button>
            </div>
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
  const projects = useStore((s) => s.projects);
  const setMobileView = useStore((s) => s.setMobileView);
  const deleteProjectNotebook = useStore((s) => s.deleteProjectNotebook);

  const [notebooks, setNotebooks] = useState<NotebookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpenPath, setMenuOpenPath] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

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
        credentials: 'same-origin',
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
  }, [activeProjectId]);

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

  const handleNewNotebook = () => {
    if (!activeProjectId) return;
    setShowCreateModal(true);
  };

  const handleMenuClick = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    setMenuOpenPath(menuOpenPath === path ? null : path);
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
                  className="mobile-list-menu-btn"
                  onClick={(e) => handleMenuClick(e, nb.path)}
                  aria-label="Notebook actions"
                >
                  ⋯
                </button>
                {menuOpenPath === nb.path && activeProjectId && (
                  <MobileNotebookMenu
                    projectId={activeProjectId}
                    relPath={nb.path}
                    onClose={() => setMenuOpenPath(null)}
                    onRequestRename={() => setRenameTarget({ path: nb.path, name: nb.name })}
                    onRequestDelete={() => setDeleteTarget({ path: nb.path, name: nb.name })}
                  />
                )}
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
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
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

      {deleteTarget && activeProjectId && (
        <MobileDeleteModal
          name={deleteTarget.name}
          label="Notebook"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteProjectNotebook(activeProjectId, deleteTarget.path)}
          onDone={() => {
            const store = useStore.getState();
            store.closeProjectFileTabs(activeProjectId, deleteTarget.path.endsWith('/') ? deleteTarget.path : deleteTarget.path + '/');
            const projPath = store.activeProjectPath;
            if (projPath) {
              store.closeNotebookTabByPath(`${projPath}/${deleteTarget.path}`);
            }
            setDeleteTarget(null);
            fetchNotebooks();
          }}
        />
      )}

      {showCreateModal && activeProjectId && (
        <MobileCreateModal
          label="Notebook"
          onCancel={() => setShowCreateModal(false)}
          onConfirm={async (name) => {
            await createAndOpenNotebook(activeProjectId, name);
          }}
          onDone={() => {
            setShowCreateModal(false);
            setMobileView('notebook');
          }}
        />
      )}
    </div>
  );
}
