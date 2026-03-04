import { useStore } from '../../store';
import { useT } from '../../i18n';
import { LanguageToggle } from '../shared/LanguageToggle';

// Signal bar heights for connection status
const SIGNAL_HEIGHTS = [4, 6, 9, 12];

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  showLeftMenu?: boolean;
  showRightMenu?: boolean;
  rightContent?: React.ReactNode;
  showPluginBtn?: boolean;
  showLangToggle?: boolean;
}

/**
 * Mobile Signal Bars component.
 * Shows connection quality with 4 bars + latency in ms.
 */
function MobileSignalBars({ latency }: { latency: number | null }) {
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
    <span className="mobile-signal-bars" title={title} aria-label={title}>
      {SIGNAL_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="mobile-signal-bar"
          style={{
            height: `${h}px`,
            background: i < bars ? color : 'rgba(250,250,249,0.18)',
          }}
        />
      ))}
      <span className="mobile-signal-ms" style={{ color: bars > 0 ? color : 'rgba(250,250,249,0.4)' }}>
        {latency === null ? '--' : latency}ms
      </span>
    </span>
  );
}

/**
 * Mobile header with navigation controls.
 * Supports back button, hamburger menus, and custom right content.
 */
export function MobileHeader({
  title,
  showBack,
  onBack,
  showLeftMenu,
  showRightMenu,
  rightContent,
  showPluginBtn,
  showLangToggle = true,
}: MobileHeaderProps) {
  const t = useT();
  const toggleLeftDrawer = useStore((s) => s.toggleLeftDrawer);
  const toggleRightDrawer = useStore((s) => s.toggleRightDrawer);
  const openPluginPanel = useStore((s) => s.openPluginPanel);
  const wsStatus = useStore((s) => s.wsStatus);
  const latency = useStore((s) => s.latency);

  // Show signal bars only when connected or connecting
  const effectiveLatency = wsStatus === 'connected' ? latency : null;

  return (
    <header className="mobile-header">
      <div className="mobile-header-left">
        {showBack && (
          <button
            className="mobile-back-btn"
            onClick={onBack}
            aria-label="Go back"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
        {showLeftMenu && (
          <button
            className="mobile-menu-btn"
            onClick={toggleLeftDrawer}
            aria-label="Open workspace menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>

      <h1 className="mobile-header-title">{title}</h1>

      <div className="mobile-header-right">
        {/* Connection status with signal bars */}
        <MobileSignalBars latency={effectiveLatency} />

        {/* Plugin button */}
        {showPluginBtn && (
          <button
            className="mobile-plugin-btn"
            onClick={openPluginPanel}
            aria-label={t('toolbar.plugins')}
            title={t('toolbar.pluginManage')}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z" />
            </svg>
          </button>
        )}

        {/* Language toggle */}
        {showLangToggle && <LanguageToggle variant="compact" className="mobile-lang-btn" />}

        {rightContent}

        {showRightMenu && (
          <button
            className="mobile-menu-btn"
            onClick={toggleRightDrawer}
            aria-label="Open deliverables menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
