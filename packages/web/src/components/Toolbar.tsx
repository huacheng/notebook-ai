import { useStore } from '../store';
import { useT } from '../i18n';
import { findModelById } from './ModelManager';
import { LanguageToggle } from './shared/LanguageToggle';

// ── Connection status badge ─────────────────────────────────────────────────

const SIGNAL_HEIGHTS = [4, 6, 9, 12];

function SignalBars({ latency }: { latency: number | null }) {
  const t = useT();
  let bars: number;
  let color: string;

  if (latency === null) {
    bars = 0;
    color = 'rgba(250,250,249,0.25)';
  } else if (latency < 50) {
    bars = 4; color = '#4ade80';
  } else if (latency < 150) {
    bars = 3; color = '#facc15';
  } else if (latency < 300) {
    bars = 2; color = '#fb923c';
  } else {
    bars = 1; color = '#f87171';
  }

  const title = latency === null ? t('conn.measuringLatency') : t('conn.latency', String(latency));

  return (
    <span className="signal-bars" title={title} aria-label={title}>
      {SIGNAL_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="signal-bar"
          style={{
            height: `${h}px`,
            background: i < bars ? color : 'rgba(250,250,249,0.18)',
          }}
        />
      ))}
      <span className="signal-ms" style={{ color: bars > 0 ? color : 'rgba(250,250,249,0.4)' }}>
        {latency === null ? '--' : latency}ms
      </span>
    </span>
  );
}

function ConnectionStatus() {
  const t = useT();
  const wsStatus = useStore((s) => s.wsStatus);
  const sessionId = useStore((s) => s.sessionId);
  const notebook = useStore((s) => s.notebook);
  const latency = useStore((s) => s.latency);

  const initializing = wsStatus === 'connected' && notebook !== null && !sessionId;
  const display = initializing ? 'initializing' : wsStatus;

  const label: Record<string, string> = {
    connected: t('conn.connected'),
    connecting: t('conn.connecting'),
    disconnected: t('conn.disconnected'),
    initializing: t('conn.initializing'),
  };

  // Signal bars reflect connection state via color; show even when not yet connected
  // so the latency area is always visible (0 bars + dim color = not connected).
  const effectiveLatency = wsStatus === 'connected' ? latency : null;

  return (
    <div
      className={`connection-status connection-status-${display}`}
      title={label[display]}
      aria-label={label[display]}
    >
      <SignalBars latency={effectiveLatency} />
    </div>
  );
}

// ── Logout ──────────────────────────────────────────────────────────────────

function LogoutButton() {
  const t = useT();
  const authRequired = useStore((s) => s.authRequired);
  const logout = useStore((s) => s.logout);

  if (!authRequired) return null;

  return (
    <button className="toolbar-btn" onClick={logout} title={t('toolbar.signOut')}>
      {t('toolbar.logout')}
    </button>
  );
}

// ── Plugin button ────────────────────────────────────────────────────────────

function PluginButton() {
  const t = useT();
  const openPluginPanel = useStore((s) => s.openPluginPanel);
  const pluginPanelOpen = useStore((s) => s.pluginPanelOpen);

  return (
    <button
      className={`toolbar-btn${pluginPanelOpen ? ' toolbar-btn--active' : ''}`}
      onClick={openPluginPanel}
      title={t('toolbar.pluginManage')}
    >
      {t('toolbar.plugins')}
    </button>
  );
}

// ── Model button ──────────────────────────────────────────────────────────────

function ModelButton() {
  const t = useT();
  const openModelPanel = useStore((s) => s.openModelPanel);
  const modelPanelOpen = useStore((s) => s.modelPanelOpen);
  const openNotebooks = useStore((s) => s.openNotebooks);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);

  const hasNotebook = Object.keys(openNotebooks).length > 0;
  const activeNb = activeNotebookTabId ? openNotebooks[activeNotebookTabId] : null;
  const currentModelId = activeNb?.notebook?.metadata?.model ?? 'sonnet';
  const modelDef = findModelById(currentModelId);
  const label = modelDef?.label ?? 'Model';

  return (
    <button
      className={`toolbar-btn${modelPanelOpen ? ' toolbar-btn--active' : ''}${!hasNotebook ? ' toolbar-btn--disabled' : ''}`}
      onClick={hasNotebook ? openModelPanel : undefined}
      disabled={!hasNotebook}
      title={hasNotebook ? t('toolbar.modelManage') : t('toolbar.openNotebookFirst')}
    >
      {label}
    </button>
  );
}

// ── Language toggle (uses shared component) ─────────────────────────────────

function LangToggle() {
  return <LanguageToggle variant="compact" className="toolbar-btn toolbar-lang-btn" />;
}

// ── Main Toolbar ────────────────────────────────────────────────────────────

export function Toolbar() {
  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <span className="toolbar-brand">
          <span className="toolbar-logo" aria-label="Notebook AI">NoteBook AI</span>
          <span className="toolbar-version">v{__APP_VERSION__}</span>
        </span>
      </div>

      <div className="toolbar-right">
        <ModelButton />
        <PluginButton />
        <LangToggle />
        <ConnectionStatus />
        <LogoutButton />
      </div>
    </header>
  );
}
