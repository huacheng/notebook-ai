/**
 * Tests appendPrompt resilience — should notify user on WS failure.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsSliceSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../store/wsSlice.ts'), 'utf-8');

describe('appendPrompt resilience', () => {
  it('should set sessionNotice when WS is not connected', () => {
    const src = wsSliceSrc();
    // Find the appendPrompt implementation (the one with ws.send, not the type declaration)
    const method = src.match(/appendPrompt\(cellId[\s\S]*?ws\.send/);
    expect(method).toBeTruthy();
    // When WS is unavailable, should notify user instead of silent return
    expect(method![0]).toContain('sessionNotice');
  });
});
