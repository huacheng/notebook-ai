import { useState, useRef } from 'react';
import * as lz4 from 'lz4js';
import { useStore } from '../store';
import { useT } from '../i18n';

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
  const t = useT();

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
        {busy ? t('welcome.creating') : buttonLabel}
      </button>
    </div>
  );
}

export function WelcomeScreen() {
  const t = useT();
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
      alert(t('welcome.fileAlert'));
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
          let notebook = data.notebook;
          if (data.notebook_compressed && data.compression === 'lz4') {
            const compressed = Uint8Array.from(atob(data.notebook_compressed), c => c.charCodeAt(0));
            const decompressed = lz4.decompress(compressed);
            notebook = JSON.parse(new TextDecoder().decode(decompressed));
          }
          openNotebookTab(data.notebookId, notebook, data.sessionId, data.workspaceDir);
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
      <h1 className="welcome-title">{t('welcome.title')}</h1>
      <p className="welcome-subtitle">
        {t('welcome.subtitle')}
      </p>

      {activeProjectId ? (
        <div className="welcome-create-project">
          <p className="welcome-hint">{t('welcome.createNotebookHint')}</p>
          <CreateForm
            placeholder={t('welcome.notebookName')}
            buttonLabel={t('welcome.createNotebook')}
            onSubmit={handleCreateNotebook}
          />

          <div className="welcome-divider">{t('welcome.or')}</div>

          <button
            className="welcome-import-btn"
            onClick={() => !importing && fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? t('welcome.importing') : t('welcome.importFromFile')}
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
          <p className="welcome-hint">{t('welcome.createProjectHint')}</p>
          <CreateForm
            placeholder={t('welcome.projectName')}
            buttonLabel={t('welcome.createProject')}
            onSubmit={(title) => createProject(title)}
          />
          <p className="welcome-hint-sub">
            {t('welcome.sidebarHint')}
          </p>
        </div>
      )}
    </div>
  );
}
