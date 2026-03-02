import { useEffect } from 'react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { PROVIDERS } from '../ModelManager';

const DEFAULT_MODEL = 'sonnet';

/**
 * Mobile Model Selection Sheet.
 * Uses the same PROVIDERS data as desktop ModelManager for consistency.
 */
export function MobileModelSheet() {
  const t = useT();
  const modelPanelOpen = useStore((s) => s.modelPanelOpen);
  const closeModelPanel = useStore((s) => s.closeModelPanel);
  const changeModel = useStore((s) => s.changeModel);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  const openNotebooks = useStore((s) => s.openNotebooks);

  const activeNb = activeNotebookTabId ? openNotebooks[activeNotebookTabId] : null;
  const currentModel = activeNb?.notebook?.metadata?.model ?? DEFAULT_MODEL;
  const hasNotebook = Object.keys(openNotebooks).length > 0;

  // Lock body scroll when open
  useEffect(() => {
    if (modelPanelOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [modelPanelOpen]);

  if (!modelPanelOpen) return null;

  function handleSelect(engine: string, modelId: string) {
    if (engine !== 'claude') return;
    if (modelId === currentModel) return;
    changeModel(modelId);
    closeModelPanel();
  }

  return (
    <div className="annotation-modal-overlay" onClick={closeModelPanel}>
      <div className="mm-container mm-container--mobile" onClick={(e) => e.stopPropagation()}>
        <div className="mm-header">
          <h2 className="mm-title">{t('model.title')}</h2>
          <button className="mm-close" onClick={closeModelPanel} aria-label={t('model.close')}>×</button>
        </div>

        {!hasNotebook ? (
          <p className="mm-empty">{t('model.emptyHint')}</p>
        ) : (
          <div className="mm-body">
            {PROVIDERS.map((provider) => {
              const isDisabled = provider.engine !== 'claude';
              return (
                <div key={provider.engine} className={`mm-provider-group${isDisabled ? ' mm-provider-group--disabled' : ''}`}>
                  <div className="mm-provider-header">
                    {provider.label}
                    {isDisabled && <span className="mm-coming-soon">{t('model.comingSoon')}</span>}
                  </div>
                  {provider.models.map((model) => {
                    const isCurrent = model.id === currentModel;
                    return (
                      <button
                        key={model.id}
                        className={`mm-model-row${isCurrent ? ' mm-model-row--active' : ''}${isDisabled ? ' mm-model-row--disabled' : ''}`}
                        onClick={() => handleSelect(provider.engine, model.id)}
                        disabled={isDisabled}
                      >
                        <span className="mm-model-label">{model.label}</span>
                        <span className={`mm-tier mm-tier--${model.tier}`}>{model.tier}</span>
                        <span className="mm-model-desc">{t(model.descKey)}</span>
                        {isCurrent && <span className="mm-current-badge">{t('model.current')}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
