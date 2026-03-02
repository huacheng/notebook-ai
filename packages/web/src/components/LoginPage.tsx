import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { LanguageToggle } from './shared/LanguageToggle';

interface LoginPageProps {
  onLogin: (email: string, password: string) => void;
  error: string | null;
  loading: boolean;
  onRegister?: () => void;
}

export function LoginPage({ onLogin, error, loading, onRegister }: LoginPageProps) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const authRetryAfter = useStore(s => s.authRetryAfter);
  const clearAuthError = useStore(s => s.clearAuthError);
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
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdown]);

  // Track if countdown was active (to detect when it finishes)
  const wasCountingRef = useRef(false);

  // Clear auth error when countdown finishes
  useEffect(() => {
    if (countdown > 0) {
      wasCountingRef.current = true;
    } else if (wasCountingRef.current) {
      // Countdown just finished (was > 0, now 0)
      wasCountingRef.current = false;
      clearAuthError();
    }
  }, [countdown, clearAuthError]);

  const locked = countdown > 0;

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!email.trim() || !password.trim() || loading || locked) return;
    onLogin(email.trim(), password.trim());
  }

  return (
    <div className="login-page">
      {/* Language toggle in top-right corner */}
      <LanguageToggle variant="pill" className="login-lang-toggle" />
      <div className="login-card">
        <div className="login-logo">NB</div>
        <h1 className="login-title">{t('login.title')}</h1>
        <p className="login-subtitle">{t('login.subtitle')}</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label" htmlFor="login-email">
              {t('login.email')}
            </label>
            <input
              ref={inputRef}
              id="login-email"
              className="login-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder')}
              disabled={loading || locked}
              autoComplete="email"
            />
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="login-password">
              {t('login.password')}
            </label>
            <div className="login-input-wrap">
              <input
                id="login-password"
                className="login-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('login.passwordPlaceholder')}
                disabled={loading || locked}
                autoComplete="current-password"
              />
              <button
                type="button"
                className={`login-pwd-toggle ${showPassword ? 'visible' : ''}`}
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                  {!showPassword && <line x1="2" y1="2" x2="22" y2="22" strokeLinecap="round"/>}
                </svg>
              </button>
            </div>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button
            className="login-btn"
            type="submit"
            disabled={!email.trim() || !password.trim() || loading || locked}
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
