import { useStore } from '../../store';

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  showLeftMenu?: boolean;
  showRightMenu?: boolean;
  rightContent?: React.ReactNode;
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
}: MobileHeaderProps) {
  const toggleLeftDrawer = useStore((s) => s.toggleLeftDrawer);
  const toggleRightDrawer = useStore((s) => s.toggleRightDrawer);
  const wsStatus = useStore((s) => s.wsStatus);

  // Connection status indicator
  const statusColor =
    wsStatus === 'connected'
      ? 'var(--color-completed)'
      : wsStatus === 'connecting'
        ? 'var(--color-running)'
        : 'var(--color-error)';

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
        {/* Connection status indicator */}
        <span
          className="mobile-conn-dot"
          style={{ backgroundColor: statusColor }}
          title={wsStatus}
        />

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
