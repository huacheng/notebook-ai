import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';

interface TokenLoginPageProps {
  onLogin: (token: string) => void;
  error: string | null;
  loading: boolean;
}

export function TokenLoginPage({ onLogin, error, loading }: TokenLoginPageProps) {
  const [token, setToken] = useState('');
  const [countdown, setCountdown] = useState(0);
  const authRetryAfter = useStore(s => s.authRetryAfter);
  const clearAuthError = useStore(s => s.clearAuthError);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (authRetryAfter > 0) setCountdown(authRetryAfter);
  }, [authRetryAfter]);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(id); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdown]);

  const wasCountingRef = useRef(false);
  useEffect(() => {
    if (countdown > 0) {
      wasCountingRef.current = true;
    } else if (wasCountingRef.current) {
      wasCountingRef.current = false;
      clearAuthError();
    }
  }, [countdown, clearAuthError]);

  const locked = countdown > 0;

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!token.trim() || loading || locked) return;
    onLogin(token.trim());
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">NB</div>
        <h1 className="login-title">Notebook AI</h1>
        <p className="login-subtitle">Enter your access token to continue</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label" htmlFor="login-token">
              Access Token
            </label>
            <div className="login-input-wrap">
              <input
                ref={inputRef}
                id="login-token"
                className="login-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your NB_AUTH_TOKEN"
                disabled={loading || locked}
                autoComplete="off"
              />
            </div>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button
            className="login-btn"
            type="submit"
            disabled={!token.trim() || loading || locked}
          >
            {loading ? 'Verifying...' : locked ? `Wait ${countdown}s` : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
