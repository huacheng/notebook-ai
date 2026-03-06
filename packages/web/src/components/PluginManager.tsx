import { useState, useCallback } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';

const DEFAULT_MARKETPLACES: { name: string; repo: string }[] = [
  { name: 'moonview', repo: 'huacheng/moonview' },
  { name: 'anthropic-agent-skills', repo: 'anthropics/skills' },
  { name: 'claude-code-plugins', repo: 'anthropics/claude-code' },
  { name: 'claude-plugins-official', repo: 'anthropics/claude-plugins-official' },
];

export function PluginManager() {
  const t = useT();
  const pluginStatus = useStore((s) => s.pluginStatus);
  const pluginActionKey = useStore((s) => s.pluginActionKey);
  const pluginOverlay = useStore((s) => s.pluginOverlay);
  const closePluginPanel = useStore((s) => s.closePluginPanel);
  const installPlugin = useStore((s) => s.installPlugin);
  const uninstallPlugin = useStore((s) => s.uninstallPlugin);
  const addMarketplace = useStore((s) => s.addMarketplace);
  const removeMarketplace = useStore((s) => s.removeMarketplace);
  const updateMarketplace = useStore((s) => s.updateMarketplace);
  const updatePlugin = useStore((s) => s.updatePlugin);

  const [customRepo, setCustomRepo] = useState('');

  const existingNames = new Set(pluginStatus?.marketplaces.map((m) => m.name) ?? []);

  // Decode pluginOverlay: "key|arg" -> t(key, arg)
  const overlayText = pluginOverlay ? (() => {
    const [key, ...args] = pluginOverlay.split('|');
    return t(key, ...args);
  })() : null;

  const handleAddCustom = useCallback(() => {
    const repo = customRepo.trim();
    if (!repo) return;
    if (!window.confirm(t('plugin.confirmAdd', repo))) return;
    addMarketplace(repo);
    setCustomRepo('');
  }, [customRepo, addMarketplace, t]);

  const handleTogglePlugin = useCallback(
    (key: string, isInstalled: boolean) => {
      const name = key.split('@')[0];
      const confirmKey = isInstalled ? 'plugin.confirmUninstall' : 'plugin.confirmInstall';
      if (!window.confirm(t(confirmKey, name))) return;
      if (isInstalled) {
        uninstallPlugin(key);
      } else {
        installPlugin(key);
      }
    },
    [installPlugin, uninstallPlugin, t],
  );

  // Extra marketplaces (not in the default list)
  const extraMarketplaces = pluginStatus?.marketplaces.filter(
    (m) => !DEFAULT_MARKETPLACES.some((d) => d.name === m.name),
  ) ?? [];

  // Group plugins by marketplace, moonview first, task-ai first within each group
  const pluginsByMarketplace = new Map<string, typeof pluginStatus extends null ? never : NonNullable<typeof pluginStatus>['plugins']>();
  for (const p of pluginStatus?.plugins ?? []) {
    const list = pluginsByMarketplace.get(p.marketplace) ?? [];
    if (p.name === 'task-ai') {
      list.unshift(p);
    } else {
      list.push(p);
    }
    pluginsByMarketplace.set(p.marketplace, list);
  }
  // Sort marketplace groups: moonview first
  const sortedEntries = [...pluginsByMarketplace.entries()].sort(([a], [b]) => {
    if (a === 'moonview') return -1;
    if (b === 'moonview') return 1;
    return 0;
  });

  return (
    <div className="pm-container">
      {overlayText && (
        <div className="pm-overlay">
          <div className="pm-overlay-spinner" />
          <p className="pm-overlay-text">{overlayText}</p>
        </div>
      )}

      <div className="pm-header">
        <h2 className="pm-title">{t('plugin.title')}</h2>
        <button className="pm-close" onClick={closePluginPanel} aria-label={t('plugin.close')}>×</button>
      </div>

      {/* Marketplaces section */}
      <div className="pm-section">
        <div className="pm-section-header">
          <h3 className="pm-section-title">{t('plugin.marketplaces')}</h3>
          <button
            className="pm-btn pm-btn--secondary"
            onClick={() => updateMarketplace()}
            disabled={!!pluginOverlay}
          >
            {t('plugin.updateAll')}
          </button>
        </div>
        <div className="pm-marketplace-list">
          {DEFAULT_MARKETPLACES.map((dm) => {
            const added = existingNames.has(dm.name);
            return (
              <div key={dm.name} className="pm-marketplace-row">
                <span className={`pm-dot ${added ? 'pm-dot--active' : ''}`} />
                <span className="pm-marketplace-name">{dm.repo}</span>
                {added ? (
                  <>
                    <button
                      className="pm-btn pm-btn--secondary"
                      onClick={() => updateMarketplace(dm.name)}
                      disabled={!!pluginOverlay}
                    >
                      {t('plugin.update')}
                    </button>
                    <button
                      className="pm-btn pm-btn--danger"
                      onClick={() => {
                        if (!window.confirm(t('plugin.confirmRemove', dm.name))) return;
                        removeMarketplace(dm.name);
                      }}
                      disabled={!!pluginOverlay}
                    >
                      {t('plugin.remove')}
                    </button>
                  </>
                ) : (
                  <button
                    className="pm-btn pm-btn--primary"
                    onClick={() => {
                      if (!window.confirm(t('plugin.confirmAdd', dm.repo))) return;
                      addMarketplace(dm.repo);
                    }}
                    disabled={!!pluginOverlay}
                  >
                    {t('plugin.add')}
                  </button>
                )}
              </div>
            );
          })}
          {extraMarketplaces.map((m) => (
            <div key={m.name} className="pm-marketplace-row">
              <span className="pm-dot pm-dot--active" />
              <span className="pm-marketplace-name">{m.name}</span>
              <button
                className="pm-btn pm-btn--secondary"
                onClick={() => updateMarketplace(m.name)}
                disabled={!!pluginOverlay}
              >
                {t('plugin.update')}
              </button>
              <button
                className="pm-btn pm-btn--danger"
                onClick={() => {
                  if (!window.confirm(t('plugin.confirmRemove', m.name))) return;
                  removeMarketplace(m.name);
                }}
                disabled={!!pluginOverlay}
              >
                {t('plugin.remove')}
              </button>
            </div>
          ))}
        </div>
        <div className="pm-custom-add">
          <input
            className="pm-input"
            type="text"
            placeholder="github-user/repo"
            value={customRepo}
            onChange={(e) => setCustomRepo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
          />
          <button
            className="pm-btn pm-btn--primary"
            onClick={handleAddCustom}
            disabled={!customRepo.trim() || !!pluginOverlay}
          >
            {t('plugin.add')}
          </button>
        </div>
      </div>

      {/* Plugins section */}
      <div className="pm-section">
        <h3 className="pm-section-title">{t('plugin.availablePlugins')}</h3>
        {pluginsByMarketplace.size === 0 && (
          <p className="pm-empty">{t('plugin.noPlugins')}</p>
        )}
        {sortedEntries.map(([marketplace, plugins]) => (
          <div key={marketplace} className="pm-plugin-group">
            <div className="pm-plugin-group-header">{marketplace}</div>
            {plugins.map((p) => {
              const isInstalled = !!(pluginStatus?.installed[p.key]);
              const isBusy = pluginActionKey === p.key;
              return (
                <label key={p.key} className="pm-plugin-row">
                  <input
                    type="checkbox"
                    checked={isInstalled}
                    disabled={isBusy || !!pluginOverlay}
                    onChange={() => handleTogglePlugin(p.key, isInstalled)}
                  />
                  <span className="pm-plugin-name">{p.name}</span>
                  {p.version && <span className="pm-plugin-version">v{p.version}</span>}
                  {p.description && <span className="pm-plugin-desc">{p.description}</span>}
                  {isInstalled && (
                    <button
                      className="pm-btn pm-btn--secondary pm-btn--sm"
                      onClick={(e) => {
                        e.preventDefault();
                        if (!window.confirm(t('plugin.confirmUpdate', p.name))) return;
                        updatePlugin(p.key);
                      }}
                      disabled={isBusy || !!pluginOverlay}
                    >
                      {t('plugin.update')}
                    </button>
                  )}
                  {isBusy && <span className="pm-plugin-spinner" />}
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
