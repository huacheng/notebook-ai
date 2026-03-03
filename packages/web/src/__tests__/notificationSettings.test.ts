import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('notification settings', () => {
  const getNotificationHook = () => readFileSync(
    path.resolve(__dirname, '../hooks/useNotification.ts'),
    'utf-8'
  );

  it('should export defaultNotificationSettings', () => {
    const src = getNotificationHook();
    expect(src).toContain('defaultNotificationSettings');
  });

  it('should have NotificationSettings interface', () => {
    const src = getNotificationHook();
    expect(src).toContain('interface NotificationSettings');
  });

  it('should have soundEnabled setting', () => {
    const src = getNotificationHook();
    expect(src).toContain('soundEnabled');
  });

  it('should have systemNotificationEnabled setting', () => {
    const src = getNotificationHook();
    expect(src).toContain('systemNotificationEnabled');
  });

  it('should have titleBlinkEnabled setting', () => {
    const src = getNotificationHook();
    expect(src).toContain('titleBlinkEnabled');
  });
});
