import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';

interface LoginPageProps {
  onLogin: (token: string) => void;
  error: string | null;
  loading: boolean;
  onRegister?: () => void;
}

export function LoginPage({ onLogin, error, loading, onRegister }: LoginPageProps) {
  const t = useT();
  const [token, setToken] = useState('');
  const [countdown, setCountdown] = useState(0);
  const authRetryAfter = useStore(s => s.authRetryAfter);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Start countdown from server-provided retryAfter
  useEffect(() => {
    if (authRetryAfter > 0) {
      setCountdown(authRetryAfter);
    }
  }, [authRetryAfter]);

  // Tick countdown
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
        <h1 className="login-title">{t('login.title')}</h1>
        <p className="login-subtitle">{t('login.subtitle')}</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label" htmlFor="auth-token">
              {t('login.label')}
            </label>
            <input
              ref={inputRef}
              id="auth-token"
              className="login-input"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('login.placeholder')}
              disabled={loading || locked}
              autoComplete="off"
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button
            className="login-btn"
            type="submit"
            disabled={!token.trim() || loading || locked}
          >
            {loading ? t('login.verifying') : locked ? t('login.wait', String(countdown)) : t('login.signIn')}
          </button>
        </form>

        {onRegister && (
          <div className="login-footer">
            <span>{t('login.noAccount')}</span>
            <button type="button" className="login-link" onClick={onRegister}>
              {t('login.register')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
