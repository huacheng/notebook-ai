import { useStore } from '../store';
import { FileSection } from './FileSection';
import { getDeliverablesPath } from '../utils/deliverablesPath';

export function RightPanel() {
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

  if (!rightPanelOpen) {
    return (
      <div className="right-panel right-panel--collapsed">
        <button className="right-panel-expand-btn" onClick={toggleRightPanel}>&lsaquo;</button>
      </div>
    );
  }

  return (
    <div className="right-panel" style={{ width: rightPanelWidth }}>
      <div className="right-panel-toolbar">
        <span className="right-panel-title">Deliverables</span>
        <button className="right-panel-collapse-btn" onClick={toggleRightPanel}>&rsaquo;</button>
      </div>
      {activeProjectId ? (
        <FileSection
          key={delivPath}
          baseUrl={`/api/projects/${activeProjectId}`}
          authToken={authToken}
          showDownloadAll
          initialPath={delivPath}
          onFileClick={(subPath, name) => {
            const relPath = subPath === '.' ? name : `${subPath}/${name}`;
            openFileTab({ path: relPath, source: 'deliverables', sessionId: sessionId ?? '', projectId: activeProjectId ?? undefined });
          }}
        />
      ) : (
        <div className="fp-section-body"><div className="fp-empty">No active project</div></div>
      )}
    </div>
  );
}
