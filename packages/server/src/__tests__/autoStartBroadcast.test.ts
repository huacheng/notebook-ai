/**
 * Tests that auto_start broadcasts auto_started to ALL session subscribers,
 * not just the originating client. Multi-device consistency.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsHandlerSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../ws-handler.ts'), 'utf-8');

describe('auto_start broadcasts to all subscribers', () => {
  it('should use broadcastToSession instead of sendToClient for auto_started', () => {
    const src = wsHandlerSrc();
    const autoStartBlock = src.match(/case 'auto_start'[\s\S]*?break;\s*\}/);
    expect(autoStartBlock).toBeTruthy();
    // Should broadcast auto_started, not just sendToClient
    expect(autoStartBlock![0]).toMatch(/broadcastToSession|broadcast.*auto_started/);
    expect(autoStartBlock![0]).not.toMatch(/sendToClient.*auto_started/);
  });
});
