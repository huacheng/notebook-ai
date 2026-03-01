import { useState, useRef } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';

export function NotebookCreationPanel() {
  const t = useT();
  const createNewNotebook = useStore((s) => s.createNewNotebook);
  const importNotebookFile = useStore((s) => s.importNotebookFile);
  const setCreatingNotebook = useStore((s) => s.setCreatingNotebook);
  const sessionNotice = useStore((s) => s.sessionNotice);
  const clearSessionNotice = useStore((s) => s.clearSessionNotice);

  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCreate() {
    const t = title.trim() || 'Untitled Notebook';
    if (creating) return;
    setCreating(true);
    await createNewNotebook(t);
    setCreating(false);
    setCreatingNotebook(false);
  }

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

  return (
    <div className="welcome-screen">
      {sessionNotice && (
        <div className="session-notice">
          <span>{sessionNotice}</span>
          <button className="session-notice-close" onClick={clearSessionNotice}>✕</button>
        </div>
      )}

      <h1 className="welcome-title">{t('nbCreate.title')}</h1>
      <p className="welcome-subtitle">
        {t('nbCreate.subtitle')}
      </p>

      <div className="welcome-create-project">
        <p className="welcome-hint">{t('nbCreate.emptyHint')}</p>
        <div className="welcome-create-form">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            placeholder={t('nbCreate.notebookName')}
            disabled={creating}
            autoFocus
          />
          <button onClick={handleCreate} disabled={creating}>
            {creating ? t('nbCreate.creating') : t('nbCreate.create')}
          </button>
        </div>

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

        <button className="welcome-cancel-btn" onClick={() => setCreatingNotebook(false)}>
          {t('nbCreate.cancel')}
        </button>
      </div>
    </div>
  );
}
