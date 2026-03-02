import { useStore } from '../../store';

interface LanguageToggleProps {
  /** Visual variant: 'compact' for header buttons, 'pill' for login pages */
  variant?: 'compact' | 'pill';
  className?: string;
}

/**
 * Shared language toggle button.
 * Used in Toolbar, MobileHeader, and LoginPage.
 */
export function LanguageToggle({ variant = 'compact', className = '' }: LanguageToggleProps) {
  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);

  const toggle = () => setLanguage(language === 'en' ? 'zh' : 'en');
  const title = language === 'en' ? 'Switch to Chinese' : '切换到英文';
  const label = language === 'en' ? '中' : 'EN';

  return (
    <button
      className={`lang-toggle lang-toggle--${variant} ${className}`.trim()}
      onClick={toggle}
      title={title}
      aria-label={title}
    >
      {label}
    </button>
  );
}
