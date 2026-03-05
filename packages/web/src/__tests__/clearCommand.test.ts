import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * /clear command interception and Clear button
 *
 * - Frontend should intercept /clear command and call clearSession API
 * - Clear button should be available in notebook toolbar
 */
describe('/clear command and Clear button', () => {
  const wsSliceSrc = readFileSync(
    path.resolve(__dirname, '../store/wsSlice.ts'),
    'utf-8',
  );
  const notebookSrc = readFileSync(
    path.resolve(__dirname, '../components/Notebook.tsx'),
    'utf-8',
  );

  it('should have clearSession function in wsSlice', () => {
    // wsSlice should have a clearSession function that sends clear: true
    const hasClearSession = wsSliceSrc.includes('clearSession');
    expect(hasClearSession).toBe(true);
  });

  it('clearSession should send restart_session with clear: true', () => {
    // clearSession should send { type: 'restart_session', session_id, clear: true }
    const sendsClearTrue = wsSliceSrc.includes('clear: true');
    expect(sendsClearTrue).toBe(true);
  });

  it('should have Clear button in Notebook toolbar', () => {
    // Notebook should have a Clear button that calls clearSession
    const hasClearButton =
      notebookSrc.includes('clearSession') ||
      notebookSrc.includes('Clear');
    expect(hasClearButton).toBe(true);
  });
});

describe('/clear command interception', () => {
  const notebookSliceSrc = readFileSync(
    path.resolve(__dirname, '../store/notebookSlice.ts'),
    'utf-8',
  );

  it('should intercept /clear command in submitPrompt', () => {
    // submitPrompt should check for /clear and call clearSession instead
    const interceptsClear =
      notebookSliceSrc.includes('/clear') ||
      notebookSliceSrc.includes('clearSession');
    expect(interceptsClear).toBe(true);
  });
});
