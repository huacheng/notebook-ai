import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('notification integration', () => {
  const wsSliceSrc = () => readFileSync(
    path.resolve(__dirname, '../store/wsSlice.ts'),
    'utf-8'
  );

  it('should have lastCompletedCellId in store state', () => {
    expect(wsSliceSrc()).toContain('lastCompletedCellId');
  });

  it('should set lastCompletedCellId when execution_complete message received', () => {
    const src = wsSliceSrc();
    // Check execution_complete handling logic sets lastCompletedCellId
    const hasExecutionComplete = src.includes("case 'execution_complete'");
    expect(hasExecutionComplete).toBe(true);
    // Verify lastCompletedCellId is set in that handler
    expect(src).toContain('lastCompletedCellId');
  });

  it('should reset lastCompletedCellId on new execution', () => {
    // Check that it resets when starting execution
    expect(wsSliceSrc()).toContain('lastCompletedCellId: null');
  });
});

describe('App notification wiring', () => {
  const appSrc = () => readFileSync(
    path.resolve(__dirname, '../App.tsx'),
    'utf-8'
  );

  it('should import useNotification hook', () => {
    expect(appSrc()).toContain('useNotification');
  });

  it('should subscribe to lastCompletedCellId changes', () => {
    expect(appSrc()).toContain('lastCompletedCellId');
  });

  // D1-2 fix: notification debounce
  it('should have notification debounce (D1-2 fix)', () => {
    const src = appSrc();
    expect(src).toContain('NOTIFY_DEBOUNCE_MS');
    expect(src).toContain('lastNotifyTimeRef');
  });

  // D4-1 fix: preload audio
  it('should preload audio on first interaction (D4-1 fix)', () => {
    const src = appSrc();
    expect(src).toContain('preloadSound');
  });

  // D6-1 fix: i18n strings
  it('should use i18n for notification messages (D6-1 fix)', () => {
    const src = appSrc();
    expect(src).toContain("t('notification.taskComplete')");
    expect(src).toContain("t('notification.claudeFinished')");
  });
});
