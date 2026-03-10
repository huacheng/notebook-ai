/**
 * Test: Running cell output should be periodically auto-saved to disk
 * so that server restart doesn't lose accumulated output.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('Running cell auto-save during execution', () => {
  it('should have debounced auto-save triggered during cell output accumulation', () => {
    const src = sessionSrc();
    // In the assistant message handler where cell_output is broadcast,
    // there should be a debounced save mechanism to persist running cell state
    // Look for debounce/throttle save near the cell_output broadcast
    expect(src).toMatch(/debouncedAutoSave|_autoSaveTimer|_scheduleAutoSave/);
  });

  it('debounced auto-save should use 1s interval', () => {
    const src = sessionSrc();
    // The _scheduleAutoSave method should use 1000ms
    const scheduleBlock = src.slice(src.indexOf('_scheduleAutoSave'), src.indexOf('_scheduleAutoSave') + 500);
    expect(scheduleBlock).toContain('1000');
  });
});
