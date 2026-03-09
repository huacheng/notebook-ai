/**
 * Tests for WS handler timer_start / timer_stop message handling.
 * RED: These tests define the expected WS protocol for timer mode.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsHandlerSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../ws-handler.ts'), 'utf-8');

describe('Timer heartbeat WS protocol', () => {
  it('should handle timer_start message', () => {
    const src = wsHandlerSrc();
    expect(src).toContain("'timer_start'");
  });

  it('should handle timer_stop message', () => {
    const src = wsHandlerSrc();
    expect(src).toContain("'timer_stop'");
  });

  it('should NOT have .auto-signal file watcher code', () => {
    const src = wsHandlerSrc();
    // Old auto-signal watcher should be removed
    expect(src).not.toContain('.auto-signal');
  });
});
