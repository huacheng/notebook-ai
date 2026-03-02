import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { LanguageToggle } from './shared/LanguageToggle';

interface RegisterPageProps {
  onBack: () => void;
}

export function RegisterPage({ onBack }: RegisterPageProps) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const authError = useStore(s => s.authError);
  const authRetryAfter = useStore(s => s.authRetryAfter);
  const authLoading = useStore(s => s.authLoading);
  const register = useStore(s => s.register);

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

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!email.trim() || !password.trim() || !inviteCode.trim() || authLoading || locked) return;

    const ok = await register(email.trim(), password.trim(), inviteCode.trim());
    if (ok) {
      setSuccess(true);
    }
  }

  if (success) {
    return (
      <div className="login-page">
        <LanguageToggle variant="pill" className="login-lang-toggle" />
        <div className="login-card">
          <div className="login-logo">NB</div>
          <h1 className="login-title">{t('register.title')}</h1>
          <p className="login-subtitle register-success">{t('register.success')}</p>
          <button className="login-btn" onClick={onBack}>
            {t('register.login')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <LanguageToggle variant="pill" className="login-lang-toggle" />
      <div className="login-card">
        <div className="login-logo">NB</div>
        <h1 className="login-title">{t('register.title')}</h1>
        <p className="login-subtitle">{t('register.subtitle')}</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label" htmlFor="reg-email">
              {t('register.email')}
            </label>
            <input
              ref={inputRef}
              id="reg-email"
              className="login-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('register.emailPlaceholder')}
              disabled={authLoading || locked}
              autoComplete="email"
            />
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="reg-password">
              {t('register.password')}
            </label>
            <div className="login-input-wrap">
              <input
                id="reg-password"
                className="login-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('register.passwordPlaceholder')}
                disabled={authLoading || locked}
                autoComplete="new-password"
                minLength={8}
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

          <div className="login-field">
            <label className="login-label" htmlFor="reg-invite">
              {t('register.inviteCode')}
            </label>
            <input
              id="reg-invite"
              className="login-input"
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={t('register.inviteCodePlaceholder')}
              disabled={authLoading || locked}
              autoComplete="off"
            />
          </div>

          {authError && <div className="login-error">{authError}</div>}

          <button
            className="login-btn"
            type="submit"
            disabled={!email.trim() || !password.trim() || !inviteCode.trim() || authLoading || locked}
          >
            {authLoading ? t('register.creating') : locked ? t('login.wait', String(countdown)) : t('register.submit')}
          </button>
        </form>

        <div className="login-footer">
          <span>{t('register.hasAccount')}</span>
          <button type="button" className="login-link" onClick={onBack}>
            {t('register.login')}
          </button>
        </div>
      </div>
    </div>
  );
}
