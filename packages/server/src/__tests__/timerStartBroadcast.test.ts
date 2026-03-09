/**
 * Tests that timer_start broadcasts timer_started to ALL session subscribers,
 * not just the originating client. Multi-device consistency.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsHandlerSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../ws-handler.ts'), 'utf-8');

describe('timer_start broadcasts to all subscribers', () => {
  it('should use broadcastToSession instead of sendToClient for timer_started', () => {
    const src = wsHandlerSrc();
    const timerStartBlock = src.match(/case 'timer_start'[\s\S]*?break;\s*\}/);
    expect(timerStartBlock).toBeTruthy();
    // Should broadcast timer_started, not just sendToClient
    expect(timerStartBlock![0]).toMatch(/broadcastToSession|broadcast.*timer_started/);
    expect(timerStartBlock![0]).not.toMatch(/sendToClient.*timer_started/);
  });
});
