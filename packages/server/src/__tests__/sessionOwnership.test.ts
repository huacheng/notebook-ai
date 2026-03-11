import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../ws-handler.ts'),
  'utf-8',
);

/**
 * Session-mutating WS commands must verify the sending WS client
 * has permission to access the session (user ownership check).
 */
describe('WS session permission enforcement (P1-1)', () => {
  const mutatingCommands = [
    'execute_request',
    'restart_session',
    'rerun_notebook',
    'interrupt_cell',
    'change_model',
    'tool_result_response',
    'remove_cells',
    'update_cell_source',
    'slide_update',
    'load_notebook',
    'file-save',
    'file-open',
    'url_capture',
    'annotation-load',
    'annotation-sync',
  ];

  for (const cmd of mutatingCommands) {
    it(`"${cmd}" should check session permission`, () => {
      const caseStart = src.indexOf(`case '${cmd}'`);
      expect(caseStart).toBeGreaterThan(-1);
      // Find the next case or default to bound the block
      const nextCase = src.indexOf('\n        case ', caseStart + 1);
      const block = src.slice(caseStart, nextCase > 0 ? nextCase : caseStart + 1500);

      // Must contain a permission check — either direct sessionOwningUser/sessionSubscribers
      // or the helper functions checkSessionPermission/checkSessionOwnership
      // Note: checkSessionOwnership is used for operations that may run during WS reconnect
      // race conditions when subscription isn't yet established but user owns the session
      const hasPermissionCheck =
        block.includes('sessionOwningUser') ||
        block.includes('sessionSubscribers') ||
        block.includes('checkSessionPermission') ||
        block.includes('checkSessionOwnership');
      expect(hasPermissionCheck).toBe(true);
    });
  }
});
