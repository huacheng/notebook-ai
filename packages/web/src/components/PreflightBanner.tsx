import { useEffect, useState } from 'react';
import { useStore } from '../store';

export function PreflightBanner() {
  const alerts = useStore(s => s.preflightAlerts);
  const dismissed = useStore(s => s.preflightDismissed);
  const fetchPreflight = useStore(s => s.fetchPreflight);
  const dismissPreflightAlert = useStore(s => s.dismissPreflightAlert);
  const installCron = useStore(s => s.installCron);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    fetchPreflight();
  }, [fetchPreflight]);

  const visible = alerts.filter(a => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  async function handleInstallCron() {
    setInstalling(true);
    await installCron();
    setInstalling(false);
    setConfirmId(null);
  }

  return (
    <div className="preflight-banner">
      {visible.map(alert => (
        <div key={alert.id} className={`preflight-alert preflight-${alert.severity}`}>
          <span className="preflight-msg">{alert.message}</span>
          {alert.id === 'cron-task-ai' && !confirmId && (
            <button className="preflight-action" onClick={() => setConfirmId(alert.id)}>
              Set up
            </button>
          )}
          {alert.id === 'cron-task-ai' && confirmId === alert.id && (
            <span className="preflight-confirm">
              <span>Install cron job for daily maintenance at 3 AM?</span>
              <button className="preflight-action" onClick={handleInstallCron} disabled={installing}>
                {installing ? 'Installing...' : 'Confirm'}
              </button>
              <button className="preflight-dismiss" onClick={() => setConfirmId(null)}>Cancel</button>
            </span>
          )}
          <button
            className="preflight-dismiss"
            onClick={() => dismissPreflightAlert(alert.id)}
            title="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
