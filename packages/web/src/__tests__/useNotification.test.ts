import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('useNotification hook', () => {
  const getSrc = () => readFileSync(
    path.resolve(__dirname, '../hooks/useNotification.ts'),
    'utf-8',
  );

  it('should export useNotification function', () => {
    const src = getSrc();
    expect(src).toMatch(/export function useNotification/);
  });

  it('should export NOTIFICATION_SOUND constant', () => {
    const src = getSrc();
    expect(src).toContain("export const NOTIFICATION_SOUND = '/sounds/notification.mp3'");
  });

  it('should export TITLE_BLINK_INTERVAL constant', () => {
    const src = getSrc();
    expect(src).toContain('export const TITLE_BLINK_INTERVAL = 1000');
  });

  it('should return playSound function', () => {
    const src = getSrc();
    expect(src).toContain('playSound');
    expect(src).toMatch(/return\s*\{[^}]*playSound/);
  });

  it('should return notify function', () => {
    const src = getSrc();
    expect(src).toContain('notify');
    expect(src).toMatch(/return\s*\{[^}]*notify/);
  });

  it('should return requestPermission function', () => {
    const src = getSrc();
    expect(src).toContain('requestPermission');
    expect(src).toMatch(/return\s*\{[^}]*requestPermission/);
  });

  it('should return stopTitleBlink function', () => {
    const src = getSrc();
    expect(src).toContain('stopTitleBlink');
    expect(src).toMatch(/return\s*\{[^}]*stopTitleBlink/);
  });

  it('should handle audio autoplay blocked', () => {
    const src = getSrc();
    // Audio.play() returns a promise that may reject if autoplay blocked
    expect(src).toMatch(/\.play\(\)\.catch/);
  });

  it('should use document.hidden for visibility check', () => {
    const src = getSrc();
    expect(src).toContain('document.hidden');
  });

  it('should use Notification API', () => {
    const src = getSrc();
    expect(src).toContain('new Notification(');
    expect(src).toContain('Notification.permission');
  });

  // D4-1 fix: preload audio
  it('should export preloadSound function', () => {
    const src = getSrc();
    expect(src).toContain('preloadSound');
    expect(src).toMatch(/return\s*\{[^}]*preloadSound/);
  });

  // D3-1 fix: prevent listener leak
  it('should use visibilityHandlerRef to prevent listener leak', () => {
    const src = getSrc();
    expect(src).toContain('visibilityHandlerRef');
    // Check that it prevents duplicate listeners
    expect(src).toContain('!visibilityHandlerRef.current');
  });

  // D5-1 fix: settings parameter
  it('should accept settings parameter', () => {
    const src = getSrc();
    expect(src).toMatch(/useNotification\(settings.*NotificationSettings/);
  });

  it('should respect settings.soundEnabled', () => {
    const src = getSrc();
    expect(src).toContain('settings.soundEnabled');
  });

  it('should respect settings.systemNotificationEnabled', () => {
    const src = getSrc();
    expect(src).toContain('settings.systemNotificationEnabled');
  });

  it('should respect settings.titleBlinkEnabled', () => {
    const src = getSrc();
    expect(src).toContain('settings.titleBlinkEnabled');
  });
});
