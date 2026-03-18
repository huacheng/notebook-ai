/**
 * Test: Connection-related sessionNotice should be cleared on ws.onopen
 *
 * Bug: When executeCell sets sessionNotice with connection messages
 * and WebSocket reconnects successfully, the notice persists.
 *
 * Fix: Clear sessionNotice on ws.onopen if it contains connection-related text
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('sessionNotice cleared on reconnect', () => {
  const wsSlicePath = path.join(__dirname, '../store/wsSlice.ts');

  it('ws.onopen should clear connection-related sessionNotice', () => {
    const src = fs.readFileSync(wsSlicePath, 'utf-8');

    // Find ws.onopen handler
    const onopenMatch = src.match(/ws\.onopen\s*=\s*\(\)\s*=>\s*\{[\s\S]*?^\s{4}\};/m);
    expect(onopenMatch).not.toBeNull();

    const onopenBlock = onopenMatch![0];

    // Should clear sessionNotice for connection-related messages
    // Code uses notice variable (from sessionNotice) and checks for both patterns
    expect(onopenBlock).toMatch(/Waiting for reconnect/i);
    expect(onopenBlock).toMatch(/Session connecting/i);
    expect(onopenBlock).toMatch(/sessionNotice.*null/i);
  });
});
