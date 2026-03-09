/**
 * Tests that task_status_subscribe has checkSessionPermission guard,
 * consistent with all other session-scoped WS message handlers.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsHandlerSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../ws-handler.ts'), 'utf-8');

describe('task_status_subscribe permission', () => {
  it('should call checkSessionPermission before processing', () => {
    const src = wsHandlerSrc();
    // Find the task_status_subscribe case block
    const caseMatch = src.match(/case 'task_status_subscribe'[\s\S]*?(?=case '|default:)/);
    expect(caseMatch).toBeTruthy();
    // Must contain checkSessionPermission call
    expect(caseMatch![0]).toContain('checkSessionPermission');
  });
});
