import { useState } from 'react';
import { useStore } from '../store';

export function LoginPanel() {
  const loginPhase = useStore((s) => s.loginPhase);
  const loginUrl = useStore((s) => s.loginUrl);
  const loginError = useStore((s) => s.loginError);
  const loginStatus = useStore((s) => s.loginStatus);
  const closeLoginPanel = useStore((s) => s.closeLoginPanel);
  const claudeLogin = useStore((s) => s.claudeLogin);
  const claudeLoginCancel = useStore((s) => s.claudeLoginCancel);
  const claudeLogout = useStore((s) => s.claudeLogout);

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (loginUrl) {
      navigator.clipboard.writeText(loginUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div className="lp-container">
      <div className="lp-header">
        <h2 className="lp-title">Claude Authentication</h2>
        <button className="lp-close" onClick={closeLoginPanel} aria-label="Close">&times;</button>
      </div>

      {/* Current status */}
      {loginStatus && loginPhase === 'options' && (
        <div className={`lp-status ${loginStatus.loggedIn ? 'lp-status--ok' : 'lp-status--none'}`}>
          {loginStatus.loggedIn ? (
            <>
              <span className="lp-status-icon">&#x2705;</span>
              <span>{loginStatus.email}</span>
              {loginStatus.subscriptionType && (
                <span className="lp-status-plan">{loginStatus.subscriptionType}</span>
              )}
            </>
          ) : (
            <>
              <span className="lp-status-icon">&#x26A0;</span>
              <span>Not logged in</span>
            </>
          )}
        </div>
      )}

      {/* Phase: options (Layer 1) */}
      {loginPhase === 'options' && (
        <div className="lp-body">
          <p className="lp-hint">Select login method:</p>
          <button className="lp-option" onClick={() => claudeLogin('claude')}>
            <span className="lp-option-icon">&#x1F310;</span>
            <div className="lp-option-text">
              <strong>Claude account with subscription</strong>
              <span>Pro, Max, Team, or Enterprise</span>
            </div>
          </button>
          <button className="lp-option" onClick={() => claudeLogin('sso')}>
            <span className="lp-option-icon">&#x1F512;</span>
            <div className="lp-option-text">
              <strong>SSO Login</strong>
              <span>Enterprise single sign-on</span>
            </div>
          </button>
          {loginStatus?.loggedIn && (
            <button className="lp-option lp-option--danger" onClick={claudeLogout}>
              <span className="lp-option-icon">&#x1F6AA;</span>
              <div className="lp-option-text">
                <strong>Logout</strong>
                <span>Sign out of current account</span>
              </div>
            </button>
          )}
        </div>
      )}

      {/* Phase: waiting */}
      {loginPhase === 'waiting' && (
        <div className="lp-body lp-center">
          <div className="lp-spinner" />
          <p>Starting login...</p>
        </div>
      )}

      {/* Phase: code (Layer 2) — URL + auto-polling for PKCE callback */}
      {loginPhase === 'code' && loginUrl && (
        <div className="lp-body">
          <p className="lp-hint">Open this URL in your browser to sign in:</p>
          <div className="lp-url-box">
            <input
              className="lp-url-input"
              value={loginUrl}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className="lp-copy-btn" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="lp-waiting">
            <div className="lp-spinner" />
            <p>Waiting for browser authentication...</p>
            <p className="lp-waiting-hint">Complete the sign-in in your browser. This page will update automatically.</p>
          </div>

          <button className="lp-cancel-link" onClick={claudeLoginCancel}>Cancel</button>
        </div>
      )}

      {/* Phase: success */}
      {loginPhase === 'success' && (
        <div className="lp-body lp-center">
          <div className="lp-success-icon">&#x2705;</div>
          <p className="lp-success-text">Login successful!</p>
          {loginStatus && loginStatus.loggedIn && (
            <p className="lp-success-detail">
              {loginStatus.email}
              {loginStatus.subscriptionType && ` | ${loginStatus.subscriptionType}`}
            </p>
          )}
          <button className="lp-done-btn" onClick={closeLoginPanel}>Done</button>
        </div>
      )}

      {/* Phase: error */}
      {loginPhase === 'error' && (
        <div className="lp-body lp-center">
          <div className="lp-error-icon">&#x274C;</div>
          <p className="lp-error-text">{loginError}</p>
          <button className="lp-done-btn" onClick={() => useStore.setState({ loginPhase: 'options' })}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
