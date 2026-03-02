import { useEffect } from 'react';
import { useStore } from '../../store';
import { MobileProjectsList } from './MobileProjectsList';
import { MobileNotebooksList } from './MobileNotebooksList';
import { MobileNotebookView } from './MobileNotebookView';
import { MobileModelSheet } from './MobileModelSheet';
import { MobilePluginSheet } from './MobilePluginSheet';
import { MobileConnectionBanner } from './MobileConnectionBanner';
import { MobileDrawer } from './MobileDrawer';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useMobileRouter } from '../../hooks/useMobileRouter';

/**
 * Main mobile application component.
 * Handles navigation between Projects, Notebooks, and Notebook views.
 */
export function MobileApp() {
  const mobileView = useStore((s) => s.mobileView);
  const sessionId = useStore((s) => s.sessionId);
  const fetchProjects = useStore((s) => s.fetchProjects);
  const checkPluginStatus = useStore((s) => s.checkPluginStatus);
  const leftDrawerOpen = useStore((s) => s.leftDrawerOpen);
  const rightDrawerOpen = useStore((s) => s.rightDrawerOpen);
  const closeDrawers = useStore((s) => s.closeDrawers);

  // Initialize WebSocket
  useWebSocket(sessionId);

  // Initialize URL routing
  useMobileRouter();

  // Fetch initial data
  useEffect(() => {
    fetchProjects();
    checkPluginStatus();
  }, [fetchProjects, checkPluginStatus]);

  // Render current view based on navigation state
  const renderView = () => {
    switch (mobileView) {
      case 'projects':
        return <MobileProjectsList />;
      case 'notebooks':
        return <MobileNotebooksList />;
      case 'notebook':
        return <MobileNotebookView />;
      default:
        return <MobileProjectsList />;
    }
  };

  return (
    <div className="mobile-app">
      {/* Connection status banner */}
      <MobileConnectionBanner />

      {/* Main content */}
      {renderView()}

      {/* Model selection sheet */}
      <MobileModelSheet />

      {/* Plugin management sheet */}
      <MobilePluginSheet />

      {/* Drawer overlays for non-notebook views */}
      {mobileView !== 'notebook' && (
        <>
          <MobileDrawer open={leftDrawerOpen} side="left" onClose={closeDrawers}>
            <div className="mobile-drawer-content">
              <div className="mobile-drawer-header">
                <h2>Files</h2>
              </div>
              <div className="mobile-drawer-section">
                <p className="mobile-drawer-placeholder">
                  Select a project first
                </p>
              </div>
            </div>
          </MobileDrawer>

          <MobileDrawer open={rightDrawerOpen} side="right" onClose={closeDrawers}>
            <div className="mobile-drawer-content">
              <div className="mobile-drawer-header">
                <h2>Deliverables</h2>
                <button className="mobile-drawer-close" onClick={closeDrawers}>
                  ×
                </button>
              </div>
              <div className="mobile-drawer-section">
                <p className="mobile-drawer-placeholder">
                  Select a notebook first
                </p>
              </div>
            </div>
          </MobileDrawer>
        </>
      )}
    </div>
  );
}
