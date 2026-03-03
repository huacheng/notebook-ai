import { useCallback, useRef } from 'react';

/** Audio notification sound path */
export const NOTIFICATION_SOUND = '/sounds/notification.mp3';

/** Title blink interval in ms */
export const TITLE_BLINK_INTERVAL = 1000;

export function useNotification() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blinkIntervalRef = useRef<number | null>(null);
  const originalTitleRef = useRef<string>(document.title);

  /** Play notification sound */
  const playSound = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(NOTIFICATION_SOUND);
    }
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {
      // Autoplay blocked - ignore silently
    });
  }, []);

  /** Request notification permission (must be called from user gesture) */
  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!('Notification' in window)) return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    return Notification.requestPermission();
  }, []);

  /** Show system notification */
  const showSystemNotification = useCallback((title: string, body?: string) => {
    if (Notification.permission !== 'granted') return;
    new Notification(title, { body, icon: '/logo.png' });
  }, []);

  /** Start title blinking (for background tabs) */
  const startTitleBlink = useCallback((message: string) => {
    if (blinkIntervalRef.current) return; // Already blinking
    originalTitleRef.current = document.title;
    blinkIntervalRef.current = window.setInterval(() => {
      document.title = document.title === message ? originalTitleRef.current : message;
    }, TITLE_BLINK_INTERVAL);
  }, []);

  /** Stop title blinking */
  const stopTitleBlink = useCallback(() => {
    if (blinkIntervalRef.current) {
      clearInterval(blinkIntervalRef.current);
      blinkIntervalRef.current = null;
      document.title = originalTitleRef.current;
    }
  }, []);

  /** Combined notify: sound + system notification + title blink if hidden */
  const notify = useCallback((title: string, body?: string) => {
    playSound();
    showSystemNotification(title, body);
    if (document.hidden) {
      startTitleBlink(`✅ ${title}`);
      const handleVisible = () => {
        if (!document.hidden) {
          stopTitleBlink();
          document.removeEventListener('visibilitychange', handleVisible);
        }
      };
      document.addEventListener('visibilitychange', handleVisible);
    }
  }, [playSound, showSystemNotification, startTitleBlink, stopTitleBlink]);

  return { playSound, notify, requestPermission, stopTitleBlink };
}
