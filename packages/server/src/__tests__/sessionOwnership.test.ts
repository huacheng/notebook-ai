import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../ws-handler.ts'),
  'utf-8',
);

/**
 * Session-mutating WS commands must verify the sending WS client
 * is the session owner before proceeding.
 */
describe('WS session ownership enforcement (P1-1)', () => {
  const mutatingCommands = [
    'execute_request',
    'restart_session',
    'rerun_notebook',
    'interrupt_cell',
    'change_model',
    'tool_result_response',
    'remove_cells',
    'update_cell_source',
    'slice_update',
    'load_notebook',
    'file-save',
    'file-open',
    'url_capture',
    'annotation-load',
    'annotation-sync',
  ];

  for (const cmd of mutatingCommands) {
    it(`"${cmd}" should check session ownership`, () => {
      const caseStart = src.indexOf(`case '${cmd}'`);
      expect(caseStart).toBeGreaterThan(-1);
      // Find the next case or default to bound the block
      const nextCase = src.indexOf('\n        case ', caseStart + 1);
      const block = src.slice(caseStart, nextCase > 0 ? nextCase : caseStart + 1500);

      // Must contain an ownership check — either direct sessionOwners.get
      // or the helper function checkOwnership / verifyOwner
      const hasOwnerCheck =
        block.includes('sessionOwners.get') ||
        block.includes('checkSessionOwner') ||
        block.includes('verifySessionOwner');
      expect(hasOwnerCheck).toBe(true);
    });
  }
});
