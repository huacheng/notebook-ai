import { useStore } from '../store';

// ── Connection status badge ─────────────────────────────────────────────────

const SIGNAL_HEIGHTS = [4, 6, 9, 12];

function SignalBars({ latency }: { latency: number | null }) {
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

  const title = latency === null ? 'Measuring latency…' : `Latency: ${latency}ms`;

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
  const wsStatus = useStore((s) => s.wsStatus);
  const sessionId = useStore((s) => s.sessionId);
  const notebook = useStore((s) => s.notebook);
  const latency = useStore((s) => s.latency);

  const initializing = wsStatus === 'connected' && notebook !== null && !sessionId;
  const display = initializing ? 'initializing' : wsStatus;

  const label: Record<string, string> = {
    connected: 'Connected',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    initializing: 'Initializing…',
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
  const authRequired = useStore((s) => s.authRequired);
  const logout = useStore((s) => s.logout);

  if (!authRequired) return null;

  return (
    <button className="toolbar-btn" onClick={logout} title="Sign out">
      Logout
    </button>
  );
}

// ── Main Toolbar ────────────────────────────────────────────────────────────

export function Toolbar() {
  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <span className="toolbar-logo" aria-label="Notebook AI">NoteBook AI</span>
        <span className="toolbar-version">v{__APP_VERSION__}</span>
      </div>

      <div className="toolbar-right">
        <ConnectionStatus />
        <LogoutButton />
      </div>
    </header>
  );
}
