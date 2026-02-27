import { useStore } from '../store';

// ── Model definitions ──────────────────────────────────────────────────────

interface ModelDef {
  id: string;
  label: string;
  tier: string;
  description: string;
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
      { id: 'sonnet', label: 'Sonnet', tier: 'balanced', description: '均衡性能与速度' },
      { id: 'opus', label: 'Opus', tier: 'powerful', description: '最强推理能力' },
      { id: 'haiku', label: 'Haiku', tier: 'fast', description: '最快速度，低成本' },
    ],
  },
  {
    engine: 'gemini',
    label: 'Gemini (Google)',
    models: [
      { id: 'gemini-2.5-pro', label: '2.5 Pro', tier: 'powerful', description: '最强 Gemini 模型' },
    ],
  },
];

const DEFAULT_MODEL = 'sonnet';

/** Look up a ModelDef by id across all providers. */
export function findModelById(id: string): ModelDef | undefined {
  for (const p of PROVIDERS) {
    const m = p.models.find((m) => m.id === id);
    if (m) return m;
  }
  return undefined;
}

// ── ModelManager component ──────────────────────────────────────────────────

export function ModelManager() {
  const closeModelPanel = useStore((s) => s.closeModelPanel);
  const changeModel = useStore((s) => s.changeModel);
  const openNotebooks = useStore((s) => s.openNotebooks);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);

  // Determine current model from the active notebook's metadata
  const activeNb = activeNotebookTabId ? openNotebooks[activeNotebookTabId] : null;
  const currentModel = activeNb?.notebook?.metadata?.model ?? DEFAULT_MODEL;

  const hasNotebook = Object.keys(openNotebooks).length > 0;

  function handleSelect(provider: ProviderDef, modelId: string) {
    if (provider.engine !== 'claude') return; // Gemini not yet supported
    if (modelId === currentModel) return;
    const def = findModelById(modelId);
    const label = def?.label ?? modelId;
    if (!window.confirm(`切换到 ${label}？当前 notebook session 将重启。`)) return;
    changeModel(modelId);
  }

  return (
    <div className="mm-container">
      <div className="mm-header">
        <h2 className="mm-title">模型管理</h2>
        <button className="mm-close" onClick={closeModelPanel} aria-label="关闭">×</button>
      </div>

      {!hasNotebook ? (
        <p className="mm-empty">请先打开一个 notebook，然后选择模型。</p>
      ) : (
        <div className="mm-body">
          {PROVIDERS.map((provider) => {
            const isDisabled = provider.engine !== 'claude';
            return (
              <div key={provider.engine} className={`mm-provider-group${isDisabled ? ' mm-provider-group--disabled' : ''}`}>
                <div className="mm-provider-header">
                  {provider.label}
                  {isDisabled && <span className="mm-coming-soon">即将支持</span>}
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
                      <span className="mm-model-desc">{model.description}</span>
                      {isCurrent && <span className="mm-current-badge">当前</span>}
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
