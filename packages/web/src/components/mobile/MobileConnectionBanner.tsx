import { useStore } from '../../store';

/**
 * Mobile connection status banner.
 * Shows when WebSocket is disconnected.
 */
export function MobileConnectionBanner() {
  const wsStatus = useStore((s) => s.wsStatus);

  if (wsStatus === 'connected') {
    return null;
  }

  const message = wsStatus === 'connecting'
    ? 'Connecting...'
    : 'Connection lost. Reconnecting...';

  return (
    <div className={`mobile-conn-banner ${wsStatus}`}>
      {wsStatus === 'connecting' && (
        <span className="mobile-conn-spinner" />
      )}
      <span>{message}</span>
    </div>
  );
}
