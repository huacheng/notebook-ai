import { useEffect } from 'react';
import { useStore } from '../../store';

const MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Best balance of speed and capability' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most capable, best for complex tasks' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest, good for simple tasks' },
];

/**
 * Mobile Model Selection Sheet.
 * Bottom sheet style for selecting AI model.
 */
export function MobileModelSheet() {
  const modelPanelOpen = useStore((s) => s.modelPanelOpen);
  const closeModelPanel = useStore((s) => s.closeModelPanel);
  const changeModel = useStore((s) => s.changeModel);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  const openNotebooks = useStore((s) => s.openNotebooks);

  const activeTab = activeNotebookTabId ? openNotebooks[activeNotebookTabId] : null;
  const currentModel = activeTab?.notebook?.metadata?.model || MODELS[0].id;

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

  const handleSelect = (modelId: string) => {
    changeModel(modelId);
    closeModelPanel();
  };

  return (
    <>
      {/* Backdrop */}
      <div className="mobile-sheet-backdrop" onClick={closeModelPanel} />

      {/* Sheet */}
      <div className="mobile-sheet">
        <div className="mobile-sheet-handle" />
        <h2 className="mobile-sheet-title">Select Model</h2>

        <div className="mobile-sheet-options">
          {MODELS.map((model) => (
            <button
              key={model.id}
              className={`mobile-sheet-option ${currentModel === model.id ? 'selected' : ''}`}
              onClick={() => handleSelect(model.id)}
            >
              <span className="mobile-sheet-option-name">{model.name}</span>
              <span className="mobile-sheet-option-desc">{model.description}</span>
              {currentModel === model.id && (
                <span className="mobile-sheet-option-check">✓</span>
              )}
            </button>
          ))}
        </div>

        <button className="mobile-sheet-cancel" onClick={closeModelPanel}>
          Cancel
        </button>
      </div>
    </>
  );
}
