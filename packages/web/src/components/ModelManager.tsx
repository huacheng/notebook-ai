import { useStore } from '../store';
import { useT } from '../i18n';

// ── Model definitions ──────────────────────────────────────────────────────

interface ModelDef {
  id: string;
  label: string;
  tier: string;
  descKey: string;
}

interface ProviderDef {
  engine: 'claude' | 'gemini';
  label: string;
  models: ModelDef[];
}

export const PROVIDERS: ProviderDef[] = [
  {
    engine: 'claude',
    label: 'Claude (Anthropic)',
    models: [
      { id: 'sonnet', label: 'Sonnet', tier: 'balanced', descKey: 'model.balanced' },
      { id: 'opus', label: 'Opus', tier: 'powerful', descKey: 'model.powerful' },
      { id: 'haiku', label: 'Haiku', tier: 'fast', descKey: 'model.fast' },
    ],
  },
  {
    engine: 'gemini',
    label: 'Gemini (Google)',
    models: [
      { id: 'gemini-2.5-pro', label: '2.5 Pro', tier: 'powerful', descKey: 'model.geminiPro' },
    ],
  },
];

const DEFAULT_MODEL = 'sonnet';

/** Look up a ModelDef by id across all providers.
 *  Supports both short IDs (opus, sonnet) and full model IDs (claude-opus-4-5-20250514).
 */
export function findModelById(id: string): ModelDef | undefined {
  for (const p of PROVIDERS) {
    // Exact match first
    const exact = p.models.find((m) => m.id === id);
    if (exact) return exact;
    // Fuzzy match: check if the full model ID contains the short ID
    // e.g., "claude-opus-4-5-20250514" contains "opus"
    const fuzzy = p.models.find((m) => id.toLowerCase().includes(m.id.toLowerCase()));
    if (fuzzy) return fuzzy;
  }
  return undefined;
}

// ── ModelManager component ──────────────────────────────────────────────────

export function ModelManager() {
  const t = useT();
  const closeModelPanel = useStore((s) => s.closeModelPanel);
  const changeModel = useStore((s) => s.changeModel);
  const openNotebooks = useStore((s) => s.openNotebooks);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);

  const activeNb = activeNotebookTabId ? openNotebooks[activeNotebookTabId] : null;
  const currentModel = activeNb?.notebook?.metadata?.model ?? DEFAULT_MODEL;

  const hasNotebook = Object.keys(openNotebooks).length > 0;

  function handleSelect(provider: ProviderDef, modelId: string) {
    if (provider.engine !== 'claude') return;
    if (modelId === currentModel) return;
    changeModel(modelId);
  }

  return (
    <div className="mm-container">
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
                      onClick={() => handleSelect(provider, model.id)}
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
  );
}
