import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('AskUserQuestion notification', () => {
  const wsSliceSrc = () => readFileSync(
    path.resolve(__dirname, '../store/wsSlice.ts'),
    'utf-8'
  );

  it('should have lastAskQuestionCellId in store state', () => {
    expect(wsSliceSrc()).toContain('lastAskQuestionCellId');
  });

  it('should set lastAskQuestionCellId when AskUserQuestion tool_use received', () => {
    const src = wsSliceSrc();
    // Check AskUserQuestion detection in cell_output handler
    expect(src).toContain("name === 'AskUserQuestion'");
    expect(src).toContain('lastAskQuestionCellId');
  });

  it('should reset lastAskQuestionCellId on new execution', () => {
    expect(wsSliceSrc()).toContain('lastAskQuestionCellId: null');
  });
});

describe('App AskUserQuestion notification wiring', () => {
  const appSrc = () => readFileSync(
    path.resolve(__dirname, '../App.tsx'),
    'utf-8'
  );

  it('should subscribe to lastAskQuestionCellId changes', () => {
    expect(appSrc()).toContain('lastAskQuestionCellId');
  });

  it('should use i18n for AskUserQuestion notification messages', () => {
    const src = appSrc();
    expect(src).toContain("t('notification.inputRequired')");
  });
});

describe('i18n AskUserQuestion notification strings', () => {
  const i18nSrc = () => readFileSync(
    path.resolve(__dirname, '../i18n/locales.ts'),
    'utf-8'
  );

  it('should have notification.inputRequired key in EN', () => {
    expect(i18nSrc()).toContain("'notification.inputRequired'");
  });

  it('should have notification.claudeNeedsInput key in EN', () => {
    expect(i18nSrc()).toContain("'notification.claudeNeedsInput'");
  });
});
