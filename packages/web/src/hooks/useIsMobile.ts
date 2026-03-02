import { useState, useEffect } from 'react';

/**
 * Detects if the viewport width is at or below a breakpoint (mobile).
 * Uses matchMedia for efficient change detection.
 *
 * @param breakpoint - Max width in pixels (default: 768)
 * @returns true if viewport width <= breakpoint
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= breakpoint;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);

    // Set initial value
    setIsMobile(mq.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);

    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);

  return isMobile;
}
