import React, { useState } from 'react';
import { useStore } from '../../store';
import { useT } from '../../i18n';

/**
 * Mobile Notebook Actions Sheet.
 * Bottom sheet menu for notebook operations (Edit, Restart, Rerun, Save, Export, Slide).
 */
export function MobileNotebookActions() {
  const t = useT();
  const notebook = useStore((s) => s.notebook);
  const sessionId = useStore((s) => s.sessionId);
  const wsStatus = useStore((s) => s.wsStatus);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const saveNotebook = useStore((s) => s.saveNotebook);
  const restartSession = useStore((s) => s.restartSession);
  const rerunNotebook = useStore((s) => s.rerunNotebook);
  const interruptCell = useStore((s) => s.interruptCell);
  const restartPhase = useStore((s) => s.restartPhase);
  const editMode = useStore((s) => s.editMode);
  const pendingDeletes = useStore((s) => s.pendingDeletes);
  const setEditMode = useStore((s) => s.setEditMode);
  const openPluginPanel = useStore((s) => s.openPluginPanel);
  const openModelPanel = useStore((s) => s.openModelPanel);
  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);

  const [open, setOpen] = useState(false);
  const [showRerunModal, setShowRerunModal] = useState(false);
  const [showCommitModal, setShowCommitModal] = useState(false);

  const connected = wsStatus === 'connected';
  const isRestarting = restartPhase === 'restarting' || restartPhase === 'done';
  const isRunning = notebook?.cells.some((c) => c.status === 'running') ?? false;
  const inSlide = activeTab === 'slide';

  function handleExport() {
    if (!sessionId) return;
    const url = `/api/notebooks/${encodeURIComponent(sessionId)}/export-zip`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setOpen(false);
  }

  function handleEditToggle() {
    if (editMode) {
      if (pendingDeletes.size === 0) {
        setEditMode(false);
      } else {
        setShowCommitModal(true);
      }
    } else {
      setEditMode(true);
    }
    setOpen(false);
  }

  function handleRestart() {
    restartSession();
    setOpen(false);
  }

  function handleSave() {
    saveNotebook();
    setOpen(false);
  }

  function handleSlideToggle() {
    setActiveTab(inSlide ? 'notebook' : 'slide');
    setOpen(false);
  }

  const actions = [
    {
      label: t('toolbar.plugins'),
      icon: '🧩',
      onClick: () => { setOpen(false); openPluginPanel(); },
      disabled: false,
      group: 'settings',
    },
    {
      label: t('model.title'),
      icon: '⚙️',
      onClick: () => { setOpen(false); openModelPanel(); },
      disabled: false,
      group: 'settings',
    },
    {
      label: language === 'en' ? '切换到中文' : 'Switch to English',
      icon: '🌐',
      onClick: () => { setLanguage(language === 'en' ? 'zh' : 'en'); setOpen(false); },
      disabled: false,
      group: 'settings',
    },
    {
      label: editMode ? t('status.done') + (pendingDeletes.size > 0 ? ` (${pendingDeletes.size})` : '') : t('status.edit'),
      icon: editMode ? '✓' : '✏️',
      onClick: handleEditToggle,
      disabled: !connected || isRunning || inSlide,
      group: 'actions',
    },
    {
      label: isRestarting ? '...' : t('status.restart'),
      icon: '🔄',
      onClick: handleRestart,
      disabled: !connected || isRestarting || editMode,
      group: 'actions',
    },
    {
      label: t('status.rerun'),
      icon: '▶️',
      onClick: () => { setShowRerunModal(true); setOpen(false); },
      disabled: !connected || isRunning || isRestarting || editMode,
      group: 'actions',
    },
    {
      label: t('status.save'),
      icon: '💾',
      onClick: handleSave,
      disabled: !connected || editMode,
      group: 'actions',
    },
    {
      label: t('status.export'),
      icon: '📦',
      onClick: handleExport,
      disabled: !sessionId || editMode,
      group: 'actions',
    },
    {
      label: inSlide ? t('status.slideBack') : t('status.slideOpen'),
      icon: '📄',
      onClick: handleSlideToggle,
      disabled: editMode,
      group: 'actions',
    },
  ];

  return (
    <>
      {/* Trigger button - shows in header */}
      <button
        className="mobile-header-btn mobile-actions-btn"
        onClick={() => setOpen(true)}
        aria-label={t('status.actions')}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {/* Interrupt button - shows when running */}
      {isRunning && (
        <button
          className="mobile-header-btn mobile-interrupt-btn"
          onClick={interruptCell}
          aria-label={t('status.escTitle')}
        >
          ■
        </button>
      )}

      {/* Actions sheet */}
      {open && (
        <div className="annotation-modal-overlay" onClick={() => setOpen(false)}>
          <div className="mobile-actions-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-actions-header">
              <span>{t('status.actions')}</span>
              <button onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="mobile-actions-list">
              {actions.map((action, i) => (
                <React.Fragment key={i}>
                  {/* Add divider between settings and actions groups */}
                  {i > 0 && actions[i - 1].group !== action.group && (
                    <div className="mobile-actions-divider" />
                  )}
                  <button
                    className="mobile-action-item"
                    onClick={action.onClick}
                    disabled={action.disabled}
                  >
                    <span className="mobile-action-icon">{action.icon}</span>
                    <span className="mobile-action-label">{action.label}</span>
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Rerun confirmation modal */}
      {showRerunModal && (
        <div className="annotation-modal-overlay" onClick={() => setShowRerunModal(false)}>
          <div className="annotation-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-lg)' }}>
              {t('modal.rerunAll')}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-xl) 0' }}>
              {t('modal.rerunAllDesc')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
              <button className="annotation-modal-btn" onClick={() => setShowRerunModal(false)}>{t('modal.cancel')}</button>
              <button className="annotation-modal-btn annotation-modal-btn--danger" onClick={() => { setShowRerunModal(false); rerunNotebook(); }}>{t('modal.rerun')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit commit modal */}
      {showCommitModal && (
        <div className="annotation-modal-overlay" onClick={() => setShowCommitModal(false)}>
          <div className="annotation-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-lg)' }}>
              {t('modal.deleteCells', String(pendingDeletes.size))}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-xl) 0' }}>
              {t('modal.deleteCellsDesc')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
              <button className="annotation-modal-btn" onClick={() => setShowCommitModal(false)}>{t('modal.cancel')}</button>
              <button className="annotation-modal-btn annotation-modal-btn--danger" onClick={() => { setShowCommitModal(false); useStore.getState().commitEdits(); setEditMode(false); }}>{t('modal.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
