import { useState, useCallback } from 'react';
import { useStore } from '../store';

const DEFAULT_MARKETPLACES: { name: string; repo: string }[] = [
  { name: 'anthropic-agent-skills', repo: 'anthropics/skills' },
  { name: 'claude-code-plugins', repo: 'anthropics/claude-code' },
  { name: 'claude-plugins-official', repo: 'anthropics/claude-plugins-official' },
  { name: 'moonview', repo: 'huacheng/moonview' },
];

export function PluginManager() {
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

  const handleAddCustom = useCallback(() => {
    const repo = customRepo.trim();
    if (!repo) return;
    if (!window.confirm(`添加市场 ${repo}？`)) return;
    addMarketplace(repo);
    setCustomRepo('');
  }, [customRepo, addMarketplace]);

  const handleTogglePlugin = useCallback(
    (key: string, isInstalled: boolean) => {
      const action = isInstalled ? '卸载' : '安装';
      const name = key.split('@')[0];
      if (!window.confirm(`${action} ${name}？所有打开的 notebook 将自动重启以加载变更。`)) return;
      if (isInstalled) {
        uninstallPlugin(key);
      } else {
        installPlugin(key);
      }
    },
    [installPlugin, uninstallPlugin],
  );

  // Extra marketplaces (not in the default list)
  const extraMarketplaces = pluginStatus?.marketplaces.filter(
    (m) => !DEFAULT_MARKETPLACES.some((d) => d.name === m.name),
  ) ?? [];

  // Group plugins by marketplace
  const pluginsByMarketplace = new Map<string, typeof pluginStatus extends null ? never : NonNullable<typeof pluginStatus>['plugins']>();
  for (const p of pluginStatus?.plugins ?? []) {
    const list = pluginsByMarketplace.get(p.marketplace) ?? [];
    list.push(p);
    pluginsByMarketplace.set(p.marketplace, list);
  }

  return (
    <div className="pm-container">
      {pluginOverlay && (
        <div className="pm-overlay">
          <div className="pm-overlay-spinner" />
          <p className="pm-overlay-text">{pluginOverlay}</p>
        </div>
      )}

      <div className="pm-header">
        <h2 className="pm-title">插件管理</h2>
        <button className="pm-close" onClick={closePluginPanel} aria-label="关闭">×</button>
      </div>

      {/* Marketplaces section */}
      <div className="pm-section">
        <div className="pm-section-header">
          <h3 className="pm-section-title">插件市场</h3>
          <button
            className="pm-btn pm-btn--secondary"
            onClick={() => updateMarketplace()}
            disabled={!!pluginOverlay}
          >
            全部更新
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
                      更新
                    </button>
                    <button
                      className="pm-btn pm-btn--danger"
                      onClick={() => {
                        if (!window.confirm(`移除市场 ${dm.name}？其下所有插件将不可用。`)) return;
                        removeMarketplace(dm.name);
                      }}
                      disabled={!!pluginOverlay}
                    >
                      移除
                    </button>
                  </>
                ) : (
                  <button
                    className="pm-btn pm-btn--primary"
                    onClick={() => {
                      if (!window.confirm(`添加市场 ${dm.repo}？`)) return;
                      addMarketplace(dm.repo);
                    }}
                    disabled={!!pluginOverlay}
                  >
                    添加
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
                更新
              </button>
              <button
                className="pm-btn pm-btn--danger"
                onClick={() => {
                  if (!window.confirm(`移除市场 ${m.name}？其下所有插件将不可用。`)) return;
                  removeMarketplace(m.name);
                }}
                disabled={!!pluginOverlay}
              >
                移除
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
            添加
          </button>
        </div>
      </div>

      {/* Plugins section */}
      <div className="pm-section">
        <h3 className="pm-section-title">可安装插件</h3>
        {pluginsByMarketplace.size === 0 && (
          <p className="pm-empty">暂无可用插件。请先添加插件市场。</p>
        )}
        {[...pluginsByMarketplace.entries()].map(([marketplace, plugins]) => (
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
                        if (!window.confirm(`更新 ${p.name}？所有打开的 notebook 将自动重启。`)) return;
                        updatePlugin(p.key);
                      }}
                      disabled={isBusy || !!pluginOverlay}
                    >
                      更新
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
