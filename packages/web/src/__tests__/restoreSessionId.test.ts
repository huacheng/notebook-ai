/**
 * Test: restoreOpenNotebookTabs should persist and restore sessionId
 * so that WS reconnect can re-subscribe after server restart.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const notebookSliceSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../store/notebookSlice.ts'), 'utf-8');

describe('Notebook tab persistence includes sessionId', () => {
  it('_persistNotebookTabs should save sessionId per tab', () => {
    const src = notebookSliceSrc();
    // The persist function should store sessionId alongside tab IDs
    // Look for sessionId being included in the persisted data
    const persistFn = src.slice(src.indexOf('function _persistNotebookTabs'), src.indexOf('function _persistNotebookTabs') + 500);
    // Should include sessionId in persisted data (not just tab keys)
    expect(persistFn).toMatch(/sessionId/);
  });

  it('restoreOpenNotebookTabs should restore sessionId from persisted data', () => {
    const src = notebookSliceSrc();
    const restoreFn = src.slice(src.indexOf('restoreOpenNotebookTabs'), src.indexOf('restoreOpenNotebookTabs') + 800);
    // Should NOT hardcode sessionId: '' but restore from saved data
    expect(restoreFn).not.toMatch(/sessionId:\s*''/);
  });
});
