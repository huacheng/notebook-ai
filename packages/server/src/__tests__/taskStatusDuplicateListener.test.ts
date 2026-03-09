/**
 * Tests that task_status_subscribe does NOT add a ws.on('close') listener
 * inside the case block (it would accumulate on resubscription).
 * Global cleanup at ws close already handles watchSubscriptions cleanup.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsHandlerSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../ws-handler.ts'), 'utf-8');

describe('task_status_subscribe listener cleanup', () => {
  it('should NOT add ws.on close listener inside case block', () => {
    const src = wsHandlerSrc();
    // Extract the task_status_subscribe case block
    const caseBlock = src.match(/case 'task_status_subscribe'[\s\S]*?break;\s*\}/);
    expect(caseBlock).toBeTruthy();
    // Should not contain ws.on('close') — global cleanup handles it
    expect(caseBlock![0]).not.toMatch(/ws\.on\(\s*['"]close['"]/);
  });
});
