import { useEffect } from 'react';
import { useStore } from '../../store';

/**
 * Mobile Plugin Management Sheet.
 * Shows installed plugins and allows basic management.
 */
export function MobilePluginSheet() {
  const pluginPanelOpen = useStore((s) => s.pluginPanelOpen);
  const closePluginPanel = useStore((s) => s.closePluginPanel);
  const pluginStatus = useStore((s) => s.pluginStatus);
  const pluginLoading = useStore((s) => s.pluginLoading);
  const checkPluginStatus = useStore((s) => s.checkPluginStatus);

  // Load plugin status when opened
  useEffect(() => {
    if (pluginPanelOpen && !pluginStatus && !pluginLoading) {
      checkPluginStatus();
    }
  }, [pluginPanelOpen, pluginStatus, pluginLoading, checkPluginStatus]);

  // Lock body scroll when open
  useEffect(() => {
    if (pluginPanelOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [pluginPanelOpen]);

  if (!pluginPanelOpen) return null;

  // Get installed plugins by checking the installed map
  const installedMap = pluginStatus?.installed ?? {};
  const installedPlugins = pluginStatus?.plugins.filter((p) => installedMap[p.key]) ?? [];

  return (
    <>
      {/* Backdrop */}
      <div className="mobile-sheet-backdrop" onClick={closePluginPanel} />

      {/* Sheet */}
      <div className="mobile-sheet">
        <div className="mobile-sheet-handle" />
        <h2 className="mobile-sheet-title">Plugins</h2>

        <div className="mobile-sheet-content">
          {pluginLoading ? (
            <div className="mobile-sheet-loading">Loading...</div>
          ) : installedPlugins.length === 0 ? (
            <div className="mobile-sheet-empty">
              <p>No plugins installed</p>
              <p className="mobile-sheet-hint">
                Use desktop to manage plugins
              </p>
            </div>
          ) : (
            <div className="mobile-sheet-options">
              {installedPlugins.map((plugin) => {
                const installedInfo = installedMap[plugin.key];
                const installedVersion = installedInfo?.version || plugin.version;
                return (
                  <div key={plugin.key} className="mobile-sheet-plugin">
                    <span className="mobile-sheet-plugin-name">
                      {plugin.name || plugin.key.split('@')[0]}
                    </span>
                    {installedVersion && (
                      <span className="mobile-sheet-plugin-version">
                        v{installedVersion}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button className="mobile-sheet-cancel" onClick={closePluginPanel}>
          Close
        </button>
      </div>
    </>
  );
}
