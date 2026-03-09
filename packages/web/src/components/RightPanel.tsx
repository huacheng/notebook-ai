import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { FileSection } from './FileSection';
import { getDeliverablesPath } from '../utils/deliverablesPath';
import { useWatcher } from '../hooks/useWatcher';

/**
 * Compute parent directory path for watcher fallback.
 * e.g. ".worktrees/task-x/.deliverables" → ".worktrees/task-x"
 *      ".deliverables" → "."
 */
function parentDir(p: string): string {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '.';
}

export function RightPanel() {
  const t = useT();
  const rightPanelOpen = useStore(s => s.rightPanelOpen);
  const toggleRightPanel = useStore(s => s.toggleRightPanel);
  const activeProjectId = useStore(s => s.activeProjectId);
  const activeProjectPath = useStore(s => s.activeProjectPath);
  const workspaceDir = useStore(s => s.workspaceDir);
  const authToken = useStore(s => s.authToken);
  const sessionId = useStore(s => s.sessionId);
  const openFileTab = useStore(s => s.openFileTab);
  const rightPanelWidth = useStore(s => s.rightPanelWidth);

  const delivPath = getDeliverablesPath(workspaceDir, activeProjectPath);
  const [refreshKey, setRefreshKey] = useState(0);
  // null = unknown (first load), true/false = API confirmed
  const [delivExists, setDelivExists] = useState<boolean | null>(null);

  // Reset existence state when deliverables path changes (tab switch)
  useEffect(() => {
    setDelivExists(null);
  }, [delivPath]);

  const handleExists = useCallback((exists: boolean) => {
    setDelivExists(exists);
  }, []);

  // Watch deliverables dir if it exists; otherwise watch parent dir
  // to detect when .deliverables is created.
  const watchPath = delivExists === false ? parentDir(delivPath) : delivPath;
  useWatcher('files', { projectId: activeProjectId, dirPath: watchPath });

  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1);
    window.addEventListener('nb:files-changed', handler);
    return () => window.removeEventListener('nb:files-changed', handler);
  }, []);

  if (!rightPanelOpen) {
    return (
      <div className="right-panel right-panel--collapsed">
        <button className="right-panel-expand-btn" onClick={toggleRightPanel}>&#9776;</button>
      </div>
    );
  }

  return (
    <div className="right-panel" style={{ width: rightPanelWidth }}>
      <div className="right-panel-toolbar">
        <span className="right-panel-title">{t('deliverables.title')}</span>
        <button className="right-panel-collapse-btn" onClick={toggleRightPanel}>&#9776;</button>
      </div>
      {activeProjectId ? (
        <FileSection
          key={delivPath}
          baseUrl={`/api/projects/${activeProjectId}`}
          authToken={authToken}
          showDownloadAll
          initialPath={delivPath}
          refreshKey={refreshKey}
          onExists={handleExists}
          onFileClick={(subPath, name) => {
            const relPath = subPath === '.' ? name : `${subPath}/${name}`;
            openFileTab({ path: relPath, source: 'deliverables', sessionId: sessionId ?? '', projectId: activeProjectId ?? undefined });
          }}
        />
      ) : (
        <div className="fp-section-body"><div className="fp-empty">{t('deliverables.noProject')}</div></div>
      )}
    </div>
  );
}
