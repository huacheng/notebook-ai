import { useRef, useEffect } from 'react';
import { useStore } from '../../store';
import { MobileHeader } from './MobileHeader';
import { MobileDrawer } from './MobileDrawer';
import { MobileInputBar } from './MobileInputBar';
import { MobileFileViewer } from './MobileFileViewer';
import { MobileSplitView } from './MobileSplitView';
import { MobileModelSheet } from './MobileModelSheet';
import { MobilePluginSheet } from './MobilePluginSheet';
import { Cell } from '../Cell';
import { useOrientation } from '../../hooks/useOrientation';

/**
 * Mobile Notebook View (Level 3)
 * The main notebook interaction interface for mobile.
 */
export function MobileNotebookView() {
  const orientation = useOrientation();
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  const openNotebooks = useStore((s) => s.openNotebooks);
  const setMobileView = useStore((s) => s.setMobileView);
  const leftDrawerOpen = useStore((s) => s.leftDrawerOpen);
  const rightDrawerOpen = useStore((s) => s.rightDrawerOpen);
  const closeDrawers = useStore((s) => s.closeDrawers);
  const mobileFileViewerOpen = useStore((s) => s.mobileFileViewerOpen);

  const contentRef = useRef<HTMLDivElement>(null);

  const activeTab = activeNotebookTabId ? openNotebooks[activeNotebookTabId] : null;
  const notebook = activeTab?.notebook;

  // Auto-scroll to bottom when new cells are added
  useEffect(() => {
    if (contentRef.current && notebook?.cells) {
      // Scroll to bottom after new content
      const el = contentRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [notebook?.cells?.length]);

  const handleBack = () => {
    setMobileView('notebooks');
  };

  // If file viewer is open, show appropriate layout based on orientation
  if (mobileFileViewerOpen) {
    if (orientation === 'landscape') {
      return <MobileSplitView />;
    }
    return <MobileFileViewer />;
  }

  if (!notebook) {
    return (
      <div className="mobile-view mobile-notebook-view">
        <MobileHeader title="Notebook" showBack onBack={handleBack} />
        <main className="mobile-content">
          <div className="mobile-loading">Loading notebook...</div>
        </main>
      </div>
    );
  }

  // Get notebook title from metadata or first cell
  const title = notebook.metadata?.title || 'Notebook';

  return (
    <div className="mobile-view mobile-notebook-view">
      <MobileHeader
        title={title}
        showBack
        onBack={handleBack}
        showLeftMenu
        showRightMenu
        rightContent={
          <>
            {/* Plugin button */}
            <button
              className="mobile-header-btn"
              onClick={() => useStore.getState().openPluginPanel()}
              aria-label="Plugins"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z" />
              </svg>
            </button>
            {/* Model button */}
            <button
              className="mobile-header-btn"
              onClick={() => useStore.getState().openModelPanel()}
              aria-label="Model"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </>
        }
      />

      {/* Left Drawer - Workspace + Library */}
      <MobileDrawer open={leftDrawerOpen} side="left" onClose={closeDrawers}>
        <div className="mobile-drawer-content">
          <div className="mobile-drawer-header">
            <h2>Workspace</h2>
          </div>
          <div className="mobile-drawer-section">
            <p className="mobile-drawer-placeholder">
              Files will appear here
            </p>
          </div>
          <div className="mobile-drawer-divider" />
          <div className="mobile-drawer-header">
            <h2>Library</h2>
          </div>
          <div className="mobile-drawer-section">
            <p className="mobile-drawer-placeholder">
              Library items will appear here
            </p>
          </div>
        </div>
      </MobileDrawer>

      {/* Right Drawer - Deliverables */}
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
              Deliverables will appear here
            </p>
          </div>
        </div>
      </MobileDrawer>

      {/* Notebook content */}
      <main className="mobile-content mobile-notebook-content" ref={contentRef}>
        <div className="mobile-cells">
          {notebook.cells.map((cell, index) => (
            <Cell
              key={cell.id}
              cell={cell}
              index={index}
            />
          ))}
        </div>
      </main>

      {/* Input bar */}
      <MobileInputBar />

      {/* Bottom sheets */}
      <MobileModelSheet />
      <MobilePluginSheet />
    </div>
  );
}
