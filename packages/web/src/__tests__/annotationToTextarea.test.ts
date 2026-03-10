/**
 * Test: Annotation send should dispatch nb:appendPrompt event (fill textarea)
 * instead of directly calling submitPrompt (execute cell).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Annotation send targets prompt textarea', () => {
  const fileViewerSrc = () =>
    fs.readFileSync(path.resolve(__dirname, '../components/FileViewer.tsx'), 'utf-8');

  it('should NOT pass submitPrompt as onSendToPrompt', () => {
    const src = fileViewerSrc();
    // onSendToPrompt should NOT be wired to submitPrompt (which executes immediately)
    expect(src).not.toMatch(/onSendToPrompt=\{submitPrompt\}/);
  });

  it('should dispatch nb:appendPrompt event to fill textarea', () => {
    const src = fileViewerSrc();
    // Should use the nb:appendPrompt custom event to append text to InputBar
    expect(src).toMatch(/nb:appendPrompt/);
  });
});
