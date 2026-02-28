import { useState, useRef } from 'react';
import { useStore } from '../store';

function CreateForm({
  placeholder,
  buttonLabel,
  onSubmit,
}: {
  placeholder: string;
  buttonLabel: string;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(title.trim());
      setTitle('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome-create-form">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        placeholder={placeholder}
        disabled={busy}
        autoFocus
      />
      <button onClick={handleSubmit} disabled={busy || !title.trim()}>
        {busy ? 'Creating...' : buttonLabel}
      </button>
    </div>
  );
}

export function WelcomeScreen() {
  const sessionNotice = useStore((s) => s.sessionNotice);
  const clearSessionNotice = useStore((s) => s.clearSessionNotice);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const createProject = useStore((s) => s.createProject);
  const createNotebook = useStore((s) => s.createNotebook);
  const importNotebookFile = useStore((s) => s.importNotebookFile);
  const openNotebookTab = useStore((s) => s.openNotebookTab);
  const subscribeToSession = useStore((s) => s.subscribeToSession);

  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.endsWith('.json') && !file.name.endsWith('.zip')) {
      alert('Please select a .notebook.json file or an exported .zip bundle.');
      return;
    }
    setImporting(true);
    await importNotebookFile(file);
    setImporting(false);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const handleCreateNotebook = async (title: string) => {
    if (!activeProjectId) return;
    const result = await createNotebook(activeProjectId, title);
    if (result.sessionId) {
      // Open the notebook after creation — fetch the notebook data
      try {
        const authToken = useStore.getState().authToken;
        const res = await fetch(`/api/notebooks/open-by-path`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ path: result.notebookPath }),
        });
        if (res.ok) {
          const data = await res.json();
          openNotebookTab(data.notebookId, data.notebook, data.sessionId, data.workspaceDir);
          subscribeToSession(data.sessionId);
        }
      } catch { /* notebook created but couldn't auto-open */ }
    }
  };

  return (
    <div className="welcome-screen">
      {sessionNotice && (
        <div className="session-notice">
          <span>{sessionNotice}</span>
          <button className="session-notice-close" onClick={clearSessionNotice}>✕</button>
        </div>
      )}
      <h1 className="welcome-title">NoteBook AI</h1>
      <p className="welcome-subtitle">
        An interactive notebook for AI-CLI
      </p>

      {activeProjectId ? (
        <div className="welcome-create-project">
          <p className="welcome-hint">Create a notebook in the current project</p>
          <CreateForm
            placeholder="Notebook name..."
            buttonLabel="Create Notebook"
            onSubmit={handleCreateNotebook}
          />

          <div className="welcome-divider">or</div>

          <button
            className="welcome-import-btn"
            onClick={() => !importing && fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? 'Importing...' : 'Import from file'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.notebook.json,.zip"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
        </div>
      ) : (
        <div className="welcome-create-project">
          <p className="welcome-hint">Create a project to get started</p>
          <CreateForm
            placeholder="Project name..."
            buttonLabel="Create Project"
            onSubmit={(title) => createProject(title)}
          />
          <p className="welcome-hint-sub">
            Or use the sidebar on the left to create and select a project
          </p>
        </div>
      )}
    </div>
  );
}
