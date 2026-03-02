import { useEffect } from 'react';

interface MobileDrawerProps {
  open: boolean;
  side: 'left' | 'right';
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Drawer component for mobile navigation.
 * Slides in from left or right with backdrop overlay.
 * Locks body scroll when open.
 */
export function MobileDrawer({ open, side, onClose, children }: MobileDrawerProps) {
  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`mobile-drawer-backdrop ${open ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer panel */}
      <div
        className={`mobile-drawer mobile-drawer-${side} ${open ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </>
  );
}
